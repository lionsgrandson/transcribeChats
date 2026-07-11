import type { ExtractedItem, TranscriptSegment, Transcription } from '../domain/types';

const now = new Date();
const tomorrow = new Date(now.getTime() + 86_400_000);

export const demoTranscription: Transcription = {
  id: 'demo-transcription',
  title: 'Product launch check-in',
  sourceType: 'recording',
  status: 'ready',
  languageMode: 'mixed',
  detectedLanguages: ['en', 'he'],
  recordedAt: now.toISOString(),
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  durationMs: 485_000,
  summary: 'The team confirmed the launch checklist, assigned the final customer email, and moved the design review to tomorrow.',
  synced: false
};

export const demoSegments: TranscriptSegment[] = [
  {
    id: 'demo-segment-1', transcriptionId: demoTranscription.id, sequenceNo: 0,
    speakerLabel: 'Dana', startMs: 0, endMs: 8400,
    text: 'Good morning. Let’s confirm what is left before the launch.',
    originalText: 'Good morning. Let’s confirm what is left before the launch.',
    language: 'en', confidence: 0.96, edited: false
  },
  {
    id: 'demo-segment-2', transcriptionId: demoTranscription.id, sequenceNo: 1,
    speakerLabel: 'Noam', startMs: 8400, endMs: 17_800,
    text: 'אני אשלח ללקוחות את המייל הסופי עד מחר בעשר.',
    originalText: 'אני אשלח ללקוחות את המייל הסופי עד מחר בעשר.',
    language: 'he', confidence: 0.93, edited: false
  },
  {
    id: 'demo-segment-3', transcriptionId: demoTranscription.id, sequenceNo: 2,
    speakerLabel: 'Dana', startMs: 17_800, endMs: 27_100,
    text: 'Great. The design review is tomorrow at 14:00, and I will own the final checklist.',
    originalText: 'Great. The design review is tomorrow at 14:00, and I will own the final checklist.',
    language: 'en', confidence: 0.95, edited: false
  }
];

export const demoItems: ExtractedItem[] = [
  {
    id: 'demo-task-1', transcriptionId: demoTranscription.id, kind: 'task',
    title: 'Send the final customer email', status: 'needs_review', priority: 'high',
    assignee: 'Noam', dueAt: tomorrow.toISOString(), reminderAt: tomorrow.toISOString(),
    tags: ['Launch'], sourceSegmentIds: ['demo-segment-2'], confidence: 0.91,
    confirmed: false, createdAt: now.toISOString(), updatedAt: now.toISOString()
  },
  {
    id: 'demo-event-1', transcriptionId: demoTranscription.id, kind: 'event',
    title: 'Design review', status: 'needs_review', priority: 'none',
    startsAt: new Date(tomorrow.setHours(14, 0, 0, 0)).toISOString(),
    tags: ['Design'], sourceSegmentIds: ['demo-segment-3'], confidence: 0.94,
    confirmed: false, createdAt: now.toISOString(), updatedAt: now.toISOString()
  },
  {
    id: 'demo-takeaway-1', transcriptionId: demoTranscription.id, kind: 'takeaway',
    title: 'Launch checklist ownership is confirmed', status: 'open', priority: 'none',
    assignee: 'Dana', tags: ['Launch'], sourceSegmentIds: ['demo-segment-3'], confidence: 0.9,
    confirmed: true, createdAt: now.toISOString(), updatedAt: now.toISOString()
  }
];
