import { describe, expect, it } from 'vitest';
import { jobStatusSchema } from './worker';

describe('worker job response parsing', () => {
  it('accepts a completed transcription when optional analysis is null', () => {
    const parsed = jobStatusSchema.parse({
      job_id: 'job-1',
      status: 'ready',
      progress: 100,
      stage: 'Ready',
      error: null,
      result: {
        duration_ms: 6130,
        detected_languages: ['en'],
        segments: [{ sequence_no: 0, speaker_label: 'Speaker 1', start_ms: 0, end_ms: 5200, text: 'Hello.', language: 'en' }],
        analysis: null
      }
    });

    expect(parsed.result?.analysis).toBeNull();
    expect(parsed.result?.segments).toHaveLength(1);
  });
});
