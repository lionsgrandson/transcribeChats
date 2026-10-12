import type { TranscriptSegment, Transcription } from '../domain/types';
import { formatTimestamp } from '../lib/format';
import { supabase } from './supabase';

const MAX_TRANSCRIPT_CHARS = 20_000;

export async function summarizeTranscriptWithGemini(transcription: Transcription, segments: TranscriptSegment[]): Promise<string> {
  const base = import.meta.env.VITE_CLOUD_TRANSCRIBE_URL?.trim();
  if (!base) throw new Error('Gemini summaries require the hosted Cloudflare transcription endpoint.');
  if (!supabase) throw new Error('Sign in through Settings before using Gemini.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('Sign in with a verified email before using Gemini.');
  const transcript = [...segments].sort((a, b) => a.sequenceNo - b.sequenceNo)
    .map((segment) => '[' + formatTimestamp(segment.startMs) + '] ' + segment.speakerLabel + ': ' + segment.text).join('\n');
  if (!transcript.trim()) throw new Error('This transcript has no text to summarize.');
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error('This transcript exceeds the Gemini per-request limit of 20,000 characters. Split it first, or export it to ChatGPT.');
  }
  const response = await fetch(base.replace(/\/$/, '') + '/v1/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
    body: JSON.stringify({ title: transcription.title, context: transcription.context || '', transcript }),
    signal: AbortSignal.timeout(35000)
  });
  const payload = await response.json().catch(() => null) as { summary?: string; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || 'Gemini summary failed (HTTP ' + response.status + ').');
  if (typeof payload?.summary !== 'string' || !payload.summary.trim()) throw new Error('Gemini returned an empty summary.');
  return payload.summary.trim();
}
