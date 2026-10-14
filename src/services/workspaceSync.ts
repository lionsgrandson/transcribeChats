import { db } from '../data/db';
import { currentUser, supabase } from './supabase';
import type { ExtractedItem, LocalMediaAsset, Transcription, TranscriptionNote, TranscriptSegment } from '../domain/types';
import type { SocialAuditEntry, StudyEntry } from '../domain/learning';

export interface WorkspaceSnapshot {
  schemaVersion: 1;
  transcriptions: Transcription[];
  segments: TranscriptSegment[];
  items: ExtractedItem[];
  notes: TranscriptionNote[];
  studyEntries: StudyEntry[];
  socialAudits: SocialAuditEntry[];
  media: Array<Omit<LocalMediaAsset, 'blob'> & { storagePath: string }>;
}

const names = ['transcriptions', 'segments', 'items', 'notes', 'studyEntries', 'socialAudits'] as const;
export function stableSnapshot(value: WorkspaceSnapshot): string {
  const ordered = { ...value, ...Object.fromEntries([...names, 'media' as const].map((key) => [key, [...value[key]].sort((a, b) => a.id.localeCompare(b.id))])) };
  // Postgres JSONB reorders object keys. Hash values, not insertion order.
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonical(nested)])) : item;
  return JSON.stringify(canonical(ordered));
}

export function validateSnapshot(value: unknown): WorkspaceSnapshot {
  const snapshot = value as WorkspaceSnapshot;
  if (!snapshot || snapshot.schemaVersion !== 1 || [...names, 'media'].some((key) => !Array.isArray((snapshot as unknown as Record<string, unknown>)[key]))) throw new Error('Unsupported cloud workspace format. No local data was changed.');
  for (const key of names) for (const record of snapshot[key]) {
    if (!record || typeof record.id !== 'string') throw new Error('Invalid cloud workspace record. No local data was changed.');
  }
  return snapshot;
}

async function digest(snapshot: WorkspaceSnapshot): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableSnapshot(snapshot)));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function localWorkspaceSnapshot(userId: string): Promise<WorkspaceSnapshot> {
  const [transcriptions, segments, items, notes, studyEntries, socialAudits, media, remoteMedia] = await Promise.all([
    db.transcriptions.toArray(), db.segments.toArray(), db.items.toArray(), db.notes.toArray(), db.studyEntries.toArray(), db.socialAudits.toArray(), db.media.toArray(), db.remoteMedia.toArray()
  ]);
  const manifests = new Map(remoteMedia.map((asset) => [asset.id, asset]));
  media.forEach(({ blob, ...asset }) => { void blob; manifests.set(asset.id, { ...asset, storagePath: `${userId}/${asset.transcriptionId}/${asset.id}` }); });
  return { schemaVersion: 1, transcriptions, segments, items, notes, studyEntries, socialAudits,
    media: [...manifests.values()] };
}

async function restoreSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  const previous = await localWorkspaceSnapshot('backup');
  const now = new Date().toISOString();
  // Preserve a recovery snapshot before applying a newer cloud version. Audio is never removed.
  await db.syncBackups.put({ id: crypto.randomUUID(), createdAt: now, payload: previous });
  await db.transaction('rw', names.map((key) => db[key]), async () => {
    for (const key of names) {
      await db[key].clear();
      if (snapshot[key].length) await db.table(key).bulkPut(snapshot[key]);
    }
  });
  if (snapshot.media.length) await db.remoteMedia.bulkPut(snapshot.media);
}

let inFlight: Promise<void> | undefined;
export function syncWorkspace(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = performSync().finally(() => { inFlight = undefined; });
  return inFlight;
}

async function performSync(): Promise<void> {
  const client = supabase;
  const user = await currentUser();
  if (!client || !user) throw new Error('Sign in before syncing.');
  const settings = await db.settings.get('settings');
  if (settings?.syncUserId && settings.syncUserId !== user.id) throw new Error('These local records were synced with another account. Use a separate browser profile for the other account.');
  const local = await localWorkspaceSnapshot(user.id);
  const localDigest = await digest(local);
  const { data: remote, error } = await client.from('transcribe_workspaces').select('payload,revision').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error(`Cloud sync is unavailable: ${error.message}. Local data is preserved.`);
  let next = local;
  let revision = Number(remote?.revision || 0);
  if (remote) {
    const cloud = validateSnapshot(remote.payload);
    const remoteDigest = await digest(cloud);
    if (revision !== settings?.syncRevision && localDigest !== remoteDigest) {
      const localEmpty = names.every((key) => local[key].length === 0);
      if (!localEmpty && (!settings?.syncDigest || localDigest !== settings.syncDigest)) {
        await db.syncBackups.put({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), payload: cloud });
        throw new Error('Both this device and the cloud have changes. Neither was overwritten. Export the local workspace and the saved cloud recovery copy before reconciling them.');
      }
      // Recheck after the network request so edits made during sync are not replaced.
      if (await digest(await localWorkspaceSnapshot(user.id)) !== localDigest) throw new Error('Local data changed during sync. Retry to include your latest changes.');
      await restoreSnapshot(cloud);
      next = cloud;
    }
    if (next === local && localDigest !== remoteDigest) {
      const result = await client.from('transcribe_workspaces').update({ payload: local, revision: revision + 1, updated_at: new Date().toISOString() }).eq('user_id', user.id).eq('revision', revision).select('revision').maybeSingle();
      if (result.error || !result.data) throw new Error('Cloud changed during sync. Retry; your local data is preserved.');
      revision++;
    }
  } else {
    const result = await client.from('transcribe_workspaces').insert({ user_id: user.id, payload: local }).select('revision').single();
    if (result.error) throw new Error(`Cloud sync was not confirmed: ${result.error.message}`);
    revision = Number(result.data.revision);
  }
  if (settings?.syncAudio) {
    for (const media of next.media) {
      const localAsset = await db.media.get(media.id);
      if (localAsset) {
        if (localAsset.size > 50 * 1024 * 1024) throw new Error('Workspace text synced. Audio files above 50 MiB remain local; split or compress them before audio sync.');
        const result = await client.storage.from('transcribe-media').upload(media.storagePath, localAsset.blob, { contentType: localAsset.mimeType, upsert: true });
        if (result.error) throw new Error(`Workspace text synced; audio upload failed: ${result.error.message}`);
      } else {
        const result = await client.storage.from('transcribe-media').download(media.storagePath);
        if (result.error) throw new Error(`Workspace text synced; audio download failed: ${result.error.message}`);
        const { storagePath: _path, ...asset } = media;
        void _path;
        await db.media.put({ ...asset, blob: result.data });
      }
    }
  }
  // Update the checkpoint only after confirmation. Settings and CRM credentials never enter payload.
  await db.settings.update('settings', { syncUserId: user.id, syncRevision: revision, syncDigest: await digest(next), lastSyncAt: new Date().toISOString() });
}

export function downloadWorkspaceSnapshot(snapshot: unknown, name = 'transcribechats-workspace.json'): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
