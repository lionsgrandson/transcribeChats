import { describe, expect, it } from 'vitest';
import type { ExtractedItem, TranscriptSegment, Transcription } from '../domain/types';
import { buildTaskChatGptPrompt } from './taskChatGpt';

const transcription: Transcription = {
  id: 'transcription-1',
  title: 'Website discovery',
  sourceType: 'upload',
  status: 'ready',
  languageMode: 'en',
  detectedLanguages: ['en'],
  recordedAt: '2026-09-23T09:00:00.000Z',
  createdAt: '2026-09-23T09:00:00.000Z',
  updatedAt: '2026-09-23T10:00:00.000Z',
  summary: 'The client wants a revised proposal and a cleaner homepage.',
};

const task: ExtractedItem = {
  id: 'task-1',
  transcriptionId: transcription.id,
  kind: 'task',
  title: 'Prepare revised proposal',
  body: 'Update pricing and scope.',
  status: 'open',
  priority: 'high',
  assignee: 'Moshe',
  dueAt: '2026-09-25T12:00:00.000Z',
  tags: ['proposal'],
  sourceSegmentIds: ['segment-2'],
  confidence: 0.96,
  confirmed: true,
  createdAt: transcription.createdAt,
  updatedAt: transcription.updatedAt,
};

const segments: TranscriptSegment[] = [
  { id: 'segment-1', transcriptionId: transcription.id, sequenceNo: 0, speakerLabel: 'Client', startMs: 0, endMs: 10000, text: 'The homepage feels too busy.', originalText: 'The homepage feels too busy.', language: 'en', edited: false },
  { id: 'segment-2', transcriptionId: transcription.id, sequenceNo: 1, speakerLabel: 'Moshe', startMs: 10000, endMs: 20000, text: 'I will send a revised proposal by Friday.', originalText: 'I will send a revised proposal by Friday.', language: 'en', edited: false },
  { id: 'segment-3', transcriptionId: transcription.id, sequenceNo: 2, speakerLabel: 'Client', startMs: 20000, endMs: 30000, text: 'Please include the updated scope.', originalText: 'Please include the updated scope.', language: 'en', edited: false },
  { id: 'segment-4', transcriptionId: transcription.id, sequenceNo: 3, speakerLabel: 'Client', startMs: 30000, endMs: 40000, text: 'Unrelated discussion.', originalText: 'Unrelated discussion.', language: 'en', edited: false },
];

describe('task ChatGPT handoff', () => {
  it('builds a focused prompt with task metadata and nearby evidence', () => {
    const prompt = buildTaskChatGptPrompt(task, transcription, segments);
    expect(prompt).toContain('Task: Prepare revised proposal');
    expect(prompt).toContain('Details: Update pricing and scope.');
    expect(prompt).toContain('Priority: high');
    expect(prompt).toContain('[SOURCE · 0:10 · Moshe] I will send a revised proposal by Friday.');
    expect(prompt).toContain('[CONTEXT · 0:00 · Client] The homepage feels too busy.');
    expect(prompt).toContain('[CONTEXT · 0:20 · Client] Please include the updated scope.');
    expect(prompt).not.toContain('Unrelated discussion.');
  });

  it('still produces a useful prompt when no source segments are linked', () => {
    const prompt = buildTaskChatGptPrompt({ ...task, sourceSegmentIds: [] }, transcription, segments);
    expect(prompt).toContain('No linked source transcript segments are available for this task.');
    expect(prompt).toContain('Summary: The client wants a revised proposal');
  });
});
