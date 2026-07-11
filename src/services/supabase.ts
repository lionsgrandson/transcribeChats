import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { ExtractedItem, LocalMediaAsset, TranscriptionNote, TranscriptSegment, Transcription } from '../domain/types';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabaseConfigured = Boolean(url && key);
export const supabase: SupabaseClient | null = supabaseConfigured ? createClient(url!, key!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

export async function currentUser(): Promise<User | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function sendMagicLink(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function syncToSupabase(
  transcriptions: Transcription[],
  segments: TranscriptSegment[],
  items: ExtractedItem[],
  notes: TranscriptionNote[],
  media: LocalMediaAsset[]
): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const user = await currentUser();
  if (!user) throw new Error('Sign in before syncing.');
  const { data: workspaceId, error: workspaceError } = await supabase.rpc('ensure_personal_workspace');
  if (workspaceError) throw workspaceError;

  const { error: transcriptionError } = await supabase.from('transcriptions').upsert(transcriptions.map((value) => ({
    id: value.id, workspace_id: workspaceId, title: value.title, source_type: value.sourceType,
    status: value.status, language_mode: value.languageMode, detected_languages: value.detectedLanguages,
    recorded_at: value.recordedAt, duration_ms: value.durationMs, full_text_cache: '', summary_cache: value.summary,
    created_by: user.id, updated_by: user.id, updated_at: value.updatedAt
  })));
  if (transcriptionError) throw transcriptionError;
  if (segments.length) {
    const { error } = await supabase.from('transcript_segments').upsert(segments.map((value) => ({
      id: value.id, transcription_id: value.transcriptionId, sequence_no: value.sequenceNo,
      start_ms: value.startMs, end_ms: value.endMs, text: value.text, original_text: value.originalText,
      language: value.language, confidence: value.confidence, speaker_label: value.speakerLabel,
      is_user_edited: value.edited, updated_by: user.id
    })));
    if (error) throw error;
  }
  if (items.length) {
    const { error } = await supabase.from('extracted_items').upsert(items.map((value) => ({
      id: value.id, transcription_id: value.transcriptionId, kind: value.kind, title: value.title,
      body: value.body, status: value.status, priority: value.priority, assignee_text: value.assignee,
      starts_at: value.startsAt, ends_at: value.endsAt, due_at: value.dueAt, reminder_at: value.reminderAt,
      tags_cache: value.tags, source_segment_ids: value.sourceSegmentIds, confidence: value.confidence,
      uncertainty_reason: value.uncertaintyReason, is_user_confirmed: value.confirmed, updated_by: user.id
    })));
    if (error) throw error;
  }
  if (notes.length) {
    const { error } = await supabase.from('transcription_notes').upsert(notes.map((value) => ({
      id: value.id, transcription_id: value.transcriptionId, body: value.body, source_start_ms: value.sourceStartMs,
      created_by: user.id, updated_by: user.id, created_at: value.createdAt, updated_at: value.updatedAt
    })));
    if (error) throw error;
  }
  for (const asset of media) {
    const filename = asset.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${workspaceId}/${user.id}/${asset.transcriptionId}/${asset.id}-${filename}`;
    const { error: uploadError } = await supabase.storage.from('media').upload(path, asset.blob, { contentType: asset.mimeType, upsert: true });
    if (uploadError) throw uploadError;
    const { error: metadataError } = await supabase.from('media_assets').upsert({
      id: asset.id, transcription_id: asset.transcriptionId, storage_path: path, original_filename: asset.filename,
      mime_type: asset.mimeType, byte_size: asset.size, created_at: asset.createdAt
    });
    if (metadataError) throw metadataError;
  }
}

export interface CloudSnapshot {
  transcriptions: Transcription[];
  segments: TranscriptSegment[];
  items: ExtractedItem[];
  notes: TranscriptionNote[];
}

export async function pullFromSupabase(): Promise<CloudSnapshot> {
  if (!supabase) return { transcriptions: [], segments: [], items: [], notes: [] };
  const user = await currentUser();
  if (!user) return { transcriptions: [], segments: [], items: [], notes: [] };
  const [transcriptionsResult, segmentsResult, itemsResult, notesResult] = await Promise.all([
    supabase.from('transcriptions').select('*').is('deleted_at', null),
    supabase.from('transcript_segments').select('*').is('deleted_at', null),
    supabase.from('extracted_items').select('*').is('deleted_at', null),
    supabase.from('transcription_notes').select('*').is('deleted_at', null)
  ]);
  const error = transcriptionsResult.error || segmentsResult.error || itemsResult.error || notesResult.error;
  if (error) throw error;
  return {
    transcriptions: (transcriptionsResult.data || []).map((value) => ({
      id: value.id, title: value.title, sourceType: value.source_type, status: value.status === 'cancelled' ? 'failed' : value.status,
      languageMode: value.language_mode, detectedLanguages: value.detected_languages || [], recordedAt: value.recorded_at,
      createdAt: value.created_at, updatedAt: value.updated_at, durationMs: value.duration_ms || undefined,
      summary: value.summary_cache || undefined, synced: true
    })),
    segments: (segmentsResult.data || []).map((value) => ({
      id: value.id, transcriptionId: value.transcription_id, sequenceNo: value.sequence_no,
      speakerLabel: value.speaker_label, startMs: Number(value.start_ms), endMs: Number(value.end_ms),
      text: value.text, originalText: value.original_text, language: value.language,
      confidence: value.confidence || undefined, edited: value.is_user_edited
    })),
    items: (itemsResult.data || []).map((value) => ({
      id: value.id, transcriptionId: value.transcription_id, kind: value.kind, title: value.title,
      body: value.body || undefined, status: value.status, priority: value.priority,
      assignee: value.assignee_text || undefined, startsAt: value.starts_at || undefined, endsAt: value.ends_at || undefined,
      dueAt: value.due_at || undefined, reminderAt: value.reminder_at || undefined, tags: value.tags_cache || [],
      sourceSegmentIds: value.source_segment_ids || [], confidence: value.confidence,
      uncertaintyReason: value.uncertainty_reason || undefined, confirmed: value.is_user_confirmed,
      createdAt: value.created_at, updatedAt: value.updated_at
    })),
    notes: (notesResult.data || []).map((value) => ({
      id: value.id, transcriptionId: value.transcription_id, body: value.body,
      sourceStartMs: value.source_start_ms || undefined, createdAt: value.created_at, updatedAt: value.updated_at
    }))
  };
}
