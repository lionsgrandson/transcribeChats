import Dexie, { type EntityTable } from 'dexie';
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

  constructor() {
    super('transcribeChats');
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
  }
}

export const db = new TranscribeChatsDatabase();

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
