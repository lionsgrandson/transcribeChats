export type Locale = 'en' | 'he';
export type LanguageMode = 'auto' | 'en' | 'he' | 'mixed';
export type TranscriptionStatus =
  | 'draft'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed';
export type SourceType = 'upload' | 'recording' | 'manual';
export type ItemKind = 'task' | 'event' | 'note' | 'takeaway' | 'summary';
export type ItemStatus = 'needs_review' | 'open' | 'completed' | 'dismissed';
export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export interface Transcription {
  id: string;
  title: string;
  sourceType: SourceType;
  status: TranscriptionStatus;
  languageMode: LanguageMode;
  detectedLanguages: string[];
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
  durationMs?: number;
  context?: string;
  summary?: string;
  progress?: number;
  stage?: string;
  jobId?: string;
  error?: string;
  synced?: boolean;
}

export interface TranscriptSegment {
  id: string;
  transcriptionId: string;
  sequenceNo: number;
  speakerId?: string;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  originalText: string;
  language: string;
  confidence?: number;
  edited: boolean;
}

export interface ExtractedItem {
  id: string;
  transcriptionId: string;
  kind: ItemKind;
  title: string;
  body?: string;
  status: ItemStatus;
  priority: Priority;
  assignee?: string;
  startsAt?: string;
  endsAt?: string;
  dueAt?: string;
  reminderAt?: string;
  tags: string[];
  sourceSegmentIds: string[];
  confidence: number;
  uncertaintyReason?: string;
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptionNote {
  id: string;
  transcriptionId: string;
  body: string;
  sourceStartMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMediaAsset {
  id: string;
  transcriptionId: string;
  filename: string;
  mimeType: string;
  size: number;
  blob: Blob;
  createdAt: string;
}

export interface AppSettings {
  id: 'settings';
  locale: Locale;
  timezone: string;
  languageMode: LanguageMode;
  processingMode: 'local-worker' | 'supabase-worker';
  workerUrl: string;
  remindersEnabled: boolean;
  crmEnabled: boolean;
  crmProvider: 'codecrafter' | 'creativecrm' | 'compatible' | 'custom';
  crmWebhookUrl: string;
  crmApiToken: string;
  lastSyncAt?: string;
}

export interface AnalysisResult {
  summary: string;
  items: Array<Omit<ExtractedItem, 'id' | 'transcriptionId' | 'createdAt' | 'updatedAt'>>;
}

export interface ImportPreview {
  valid: Array<Omit<ExtractedItem, 'id' | 'transcriptionId' | 'createdAt' | 'updatedAt'>>;
  invalid: string[];
  duplicates: string[];
}
