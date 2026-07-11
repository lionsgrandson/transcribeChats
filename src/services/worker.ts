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

const jobStatusSchema = z.object({
  job_id: z.string(),
  status: z.enum(['queued', 'processing', 'ready', 'failed']),
  progress: z.number().min(0).max(100),
  stage: z.string(),
  result: workerResponseSchema.nullish(),
  error: z.string().nullish()
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
  onProgress: (progress: number, stage: string) => void | Promise<void>,
  onJobCreated: (jobId: string) => void | Promise<void>,
  existingJobId?: string
): Promise<WorkerResult> {
  const baseUrl = workerUrl.replace(/\/$/, '');
  let jobId = existingJobId;
  if (!jobId) {
    const form = new FormData();
    form.append('file', file, filename);
    form.append('language_mode', languageMode);
    form.append('context', context);
    form.append('recorded_at', recordedAt);
    form.append('analyze', 'true');
    await onProgress(12, 'Uploading to transcription engine');
    const response = await fetch(`${baseUrl}/v1/jobs`, { method: 'POST', body: form });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Worker returned ${response.status}`);
    }
    const accepted = jobStatusSchema.parse(await response.json());
    jobId = accepted.job_id;
    await onJobCreated(jobId);
    await onProgress(accepted.progress, accepted.stage);
  }

  let lastProgress = -1;
  let lastStage = '';
  let parsed: z.infer<typeof workerResponseSchema> | undefined;
  while (!parsed) {
    const response = await fetch(`${baseUrl}/v1/jobs/${jobId}`, { cache: 'no-store' });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Worker returned ${response.status}`);
    }
    const job = jobStatusSchema.parse(await response.json());
    if (job.progress !== lastProgress || job.stage !== lastStage) {
      lastProgress = job.progress;
      lastStage = job.stage;
      await onProgress(job.progress, job.stage);
    }
    if (job.status === 'failed') throw new Error(job.error || 'Transcription failed.');
    if (job.status === 'ready') {
      if (!job.result) throw new Error('The transcription job completed without a result.');
      parsed = job.result;
      break;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }

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
