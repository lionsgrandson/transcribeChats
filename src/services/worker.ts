import { z } from 'zod';
import type { AnalysisResult, LanguageMode, TranscriptSegment } from '../domain/types';

const workerResponseSchema = z.object({
  duration_ms: z.number().nonnegative().optional(),
  detected_languages: z.array(z.string()).default([]),
  segments: z.array(z.object({
    id: z.string().optional(), sequence_no: z.number(), speaker_label: z.string().default('Speaker 1'),
    start_ms: z.number(), end_ms: z.number(), text: z.string(), language: z.string().default('auto'),
    confidence: z.number().optional()
  })),
  analysis: z.object({ summary: z.string().default(''), items: z.array(z.record(z.string(), z.unknown())).default([]) }).optional()
});

export interface WorkerResult {
  durationMs?: number;
  detectedLanguages: string[];
  segments: Omit<TranscriptSegment, 'transcriptionId'>[];
  analysis?: AnalysisResult;
}

export async function transcribeWithWorker(
  workerUrl: string,
  file: Blob,
  filename: string,
  languageMode: LanguageMode,
  context: string,
  recordedAt: string,
  onProgress: (progress: number, stage: string) => void
): Promise<WorkerResult> {
  const form = new FormData();
  form.append('file', file, filename);
  form.append('language_mode', languageMode);
  form.append('context', context);
  form.append('recorded_at', recordedAt);
  form.append('analyze', 'true');
  onProgress(15, 'Uploading');
  const response = await fetch(`${workerUrl.replace(/\/$/, '')}/v1/transcribe`, { method: 'POST', body: form });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Worker returned ${response.status}`);
  }
  onProgress(85, 'Finalizing');
  const parsed = workerResponseSchema.parse(await response.json());
  return {
    durationMs: parsed.duration_ms,
    detectedLanguages: parsed.detected_languages,
    segments: parsed.segments.map((segment) => ({
      id: segment.id || crypto.randomUUID(), sequenceNo: segment.sequence_no,
      speakerLabel: segment.speaker_label, startMs: segment.start_ms, endMs: segment.end_ms,
      text: segment.text, originalText: segment.text, language: segment.language,
      confidence: segment.confidence, edited: false
    })),
    analysis: parsed.analysis as AnalysisResult | undefined
  };
}

export async function checkWorker(workerUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${workerUrl.replace(/\/$/, '')}/health/ready`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}
