import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedItem, TranscriptSegment, Transcription } from '../domain/types';
import { printPdf } from './exports';

const transcription: Transcription = {
  id: 't1',
  title: 'PDF export test',
  sourceType: 'manual',
  status: 'ready',
  languageMode: 'mixed',
  detectedLanguages: ['en'],
  recordedAt: '2026-07-11T08:00:00.000Z',
  createdAt: '2026-07-11T08:00:00.000Z',
  updatedAt: '2026-07-11T08:00:00.000Z',
};

const segments: TranscriptSegment[] = [{
  id: 's1', transcriptionId: 't1', sequenceNo: 0, speakerLabel: 'Dana', startMs: 5000, endMs: 9000,
  text: 'The customer will be offline next week.', originalText: 'The customer will be offline next week.',
  language: 'en', edited: false,
}];

const items: ExtractedItem[] = [{
  id: 'i1', transcriptionId: 't1', kind: 'note', title: 'Customer is offline next week', status: 'needs_review',
  priority: 'none', tags: [], sourceSegmentIds: ['s1'], confidence: 0.9, confirmed: false,
  createdAt: '2026-07-11T08:00:00.000Z', updatedAt: '2026-07-11T08:00:00.000Z',
}];

afterEach(() => vi.restoreAllMocks());

describe('printPdf', () => {
  it('opens a printable document without disabling the returned window handle', () => {
    const write = vi.fn();
    const close = vi.fn();
    const popup = { opener: window, document: { write, close } } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);

    printPdf(transcription, segments, items);

    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(write).toHaveBeenCalledWith(expect.stringContaining('Notes and takeaways'));
    expect(write).toHaveBeenCalledWith(expect.stringContaining('Customer is offline next week'));
    expect(close).toHaveBeenCalled();
  });

  it('reports a blocked print window', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => printPdf(transcription, segments, items)).toThrow('Allow pop-ups');
  });
});
