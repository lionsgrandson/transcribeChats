import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  AppSettings,
  ExtractedItem,
  LocalMediaAsset,
  Transcription,
  TranscriptionNote,
  TranscriptSegment
} from '../domain/types';
import type { SocialAuditEntry, StudyEntry } from '../domain/learning';

export class TranscribeChatsDatabase extends Dexie {
  transcriptions!: EntityTable<Transcription, 'id'>;
  segments!: EntityTable<TranscriptSegment, 'id'>;
  items!: EntityTable<ExtractedItem, 'id'>;
  notes!: EntityTable<TranscriptionNote, 'id'>;
  media!: EntityTable<LocalMediaAsset, 'id'>;
  settings!: EntityTable<AppSettings, 'id'>;
  studyEntries!: EntityTable<StudyEntry, 'id'>;
  socialAudits!: EntityTable<SocialAuditEntry, 'id'>;
  syncBackups!: EntityTable<{ id: string; createdAt: string; payload: unknown }, 'id'>;
  remoteMedia!: EntityTable<Omit<LocalMediaAsset, 'blob'> & { storagePath: string }, 'id'>;

  constructor(name = 'transcribeChats') {
    super(name);
    this.version(1).stores({
      transcriptions: 'id, status, sourceType, recordedAt, updatedAt',
      segments: 'id, transcriptionId, [transcriptionId+sequenceNo]',
      items: 'id, transcriptionId, kind, status, dueAt, updatedAt, *tags',
      notes: 'id, transcriptionId, updatedAt',
      media: 'id, transcriptionId, createdAt',
      settings: 'id'
    });
    this.version(2).stores({
      transcriptions: 'id, status, sourceType, recordedAt, updatedAt',
      segments: 'id, transcriptionId, [transcriptionId+sequenceNo]',
      items: 'id, transcriptionId, kind, status, dueAt, updatedAt, *tags',
      notes: 'id, transcriptionId, updatedAt',
      media: 'id, transcriptionId, createdAt',
      settings: 'id',
      studyEntries: 'id, title, updatedAt, *path',
      socialAudits: 'id, title, updatedAt'
    });
    this.version(3).stores({ syncBackups: 'id, createdAt', remoteMedia: 'id, transcriptionId' });
  }
}

export let db = new TranscribeChatsDatabase();

// Called once before mounting the store. Account changes reload the application.
export function configureAccountDatabase(userId: string): void {
  db.close();
  db = new TranscribeChatsDatabase(`transcribeChats:user:${userId}`);
}

/** Explicit, additive recovery: never delete or automatically assign legacy data. */
export async function recoverLegacyBrowserData(): Promise<number> {
  if (db.name === 'transcribeChats') return 0;
  const legacy = new TranscribeChatsDatabase();
  try {
    const [transcriptions, segments, items, notes, media, studies, audits] = await Promise.all([
      legacy.transcriptions.toArray(), legacy.segments.toArray(), legacy.items.toArray(),
      legacy.notes.toArray(), legacy.media.toArray(), legacy.studyEntries.toArray(), legacy.socialAudits.toArray()
    ]);
    const tables = [db.transcriptions, db.segments, db.items, db.notes, db.media, db.studyEntries, db.socialAudits];
    await db.transaction('rw', tables, async () => {
      // Existing account records win. Settings/CRM credentials are never imported.
      for (const [index, records] of [transcriptions, segments, items, notes, media, studies, audits].entries()) {
        const table = tables[index] as Table<{ id: string }, string>;
        const existing = new Set(await table.toCollection().primaryKeys());
        const missing = records.filter((record) => !existing.has(record.id));
        // Dexie's heterogeneous tables share the id contract; each array stays paired with its table.
        if (missing.length) await table.bulkPut(missing);
      }
    });
    return transcriptions.length;
  } finally { legacy.close(); }
}

export const defaultSettings: AppSettings = {
  id: 'settings',
  locale: 'en',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  languageMode: 'auto',
  processingMode: 'local-worker',
  workerUrl: import.meta.env.VITE_WORKER_URL || 'http://localhost:8787',
  remindersEnabled: true,
  crmEnabled: false,
  crmProvider: 'codecrafter',
  crmWebhookUrl: '',
  crmApiToken: ''
};
