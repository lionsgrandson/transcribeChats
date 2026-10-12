import type { TranscriptSegment, Transcription } from '../domain/types';
import { formatTimestamp } from '../lib/format';
import { supabase } from './supabase';

export type SummaryJobStatus = 'queued' | 'processing' | 'waiting' | 'ready' | 'failed';
export interface SummaryJob {
  jobId: string;
  status: SummaryJobStatus;
  attempts?: number;
  summary?: string;
  error?: string;
  nextRetryAt?: string | null;
}

export class SummaryRateLimitError extends Error {
  constructor(public retryAt: string) {
    super('Summary queue is busy. Your request will retry automatically while this app is open.');
  }
}

function endpoint(): string {
  const base = import.meta.env.VITE_CLOUD_TRANSCRIBE_URL?.trim();
  if (!base) throw new Error('Gemini summaries require the hosted Cloudflare backend.');
  return base.replace(/\/$/, '') + '/v1/analyze';
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!supabase) throw new Error('Sign in through Settings before using Gemini.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Sign in with a verified email before using Gemini.');
  return { Authorization: 'Bearer ' + data.session.access_token };
}

async function readJob(response: Response, jobId: string): Promise<SummaryJob> {
  const payload = await response.json().catch(() => null) as (Partial<SummaryJob> & { error?: string; retryAfterSeconds?: number }) | null;
  if (response.status === 429) {
    const seconds = Math.min(3600, Math.max(60, Number(response.headers.get('Retry-After')) || payload?.retryAfterSeconds || 60));
    throw new SummaryRateLimitError(new Date(Date.now() + seconds * 1000).toISOString());
  }
  if (!response.ok) {
    const message = payload?.error || 'Gemini job could not be retrieved (HTTP ' + response.status + ').';
    const exception = new Error(message);
    if (response.status === 404) exception.name = 'SummaryNotFound';
    throw exception;
  }
  if (!payload || !['queued', 'processing', 'waiting', 'ready', 'failed'].includes(String(payload.status))) {
    throw new Error('Gemini returned an invalid summary job status.');
  }
  return { ...payload, jobId, status: payload.status as SummaryJobStatus };
}

export async function createGeminiSummaryJob(transcription: Transcription, segments: TranscriptSegment[], jobId: string): Promise<SummaryJob> {
  const transcript = [...segments].sort((a, b) => a.sequenceNo - b.sequenceNo)
    .map((segment) => '[' + formatTimestamp(segment.startMs) + '] ' + segment.speakerLabel + ': ' + segment.text).join('\n');
  if (!transcript.trim()) throw new Error('This transcript has no text to summarize.');
  if (transcript.length > 120_000) {
    throw new Error('This transcript exceeds the current 120,000-character limit. The text has not been truncated. Export to ChatGPT or divide it into separate recordings.');
  }
  const headers = { ...(await authHeaders()), 'Content-Type': 'application/json', 'Idempotency-Key': jobId };
  const response = await fetch(endpoint(), {
    method: 'POST', headers,
    body: JSON.stringify({ title: transcription.title, context: transcription.context || '', transcript }),
    signal: AbortSignal.timeout(35_000)
  });
  return readJob(response, jobId);
}

export async function getGeminiSummaryJob(jobId: string): Promise<SummaryJob> {
  const response = await fetch(endpoint() + '/' + encodeURIComponent(jobId), {
    headers: await authHeaders(),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store'
  });
  return readJob(response, jobId);
}
