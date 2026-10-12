/**
 * Transcription-only API. Private audio is processed in memory and is not logged
 * or stored by this Worker. Requires a verified Supabase user and rate limits.
 * Do not expose SUPABASE_PUBLISHABLE_KEY as a secret: it is a public project key.
 */
import { Buffer } from 'node:buffer';
import { GeminiSummaryJob, MAX_BODY_BYTES } from './gemini-jobs.mjs';
export { GeminiSummaryJob };

const MODEL = '@cf/openai/whisper-large-v3-turbo';
const MAX_BYTES = 8 * 1024 * 1024;
const MIME_EXTENSIONS = /\.(mp3|m4a|wav|webm|ogg|opus|flac|mpeg)$/i;
// Deliberately small Gemini requests to protect the shared free-tier project.
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const MAX_ANALYSIS_BODY_BYTES = 48 * 1024;
const MAX_TRANSCRIPT_CHARS = 20_000;
const MAX_SUMMARY_TOKENS = 1024;

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

function corsHeaders(origin, allowed) {
  return origin === allowed ? {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  } : {};
}

async function authenticate(request, env) {
  const token = /^Bearer ([A-Za-z0-9._-]+)$/.exec(request.headers.get('Authorization') || '')?.[1];
  if (!token) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new Error('Auth provider is not configured.');
  const response = await fetch(new URL('/auth/v1/user', env.SUPABASE_URL), {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const user = await response.json();
  if (!user?.id || !user?.email_confirmed_at) return null;
  return user.id;
}

function normaliseSegments(result) {
  const raw = Array.isArray(result?.segments) ? result.segments : [];
  const mapped = raw
    .map((s, i) => ({
      sequence_no: i,
      speaker_label: 'Speaker 1', // Whisper alone DOES NOT diarize speakers.
      start_ms: Math.max(0, Math.round(Number(s.start ?? s.start_time ?? 0) * 1000)),
      end_ms: Math.max(0, Math.round(Number(s.end ?? s.end_time ?? 0) * 1000)),
      text: String(s.text || '').trim(),
      language: result?.transcription_info?.language || 'auto',
    }))
    .filter((s) => s.text);
  if (mapped.length) return mapped;
  if (typeof result?.text === 'string' && result.text.trim()) {
    return [{ sequence_no: 0, speaker_label: 'Speaker 1', start_ms: 0, end_ms: 0, text: result.text.trim(), language: result?.transcription_info?.language || 'auto' }];
  }
  return [];
}


export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGIN;
    // Fail closed until a single trusted frontend origin is configured.
    if (!allowed || !/^https:\/\//.test(allowed)) return json({ error: 'Frontend origin is not configured.' }, 503);
    const cors = corsHeaders(origin, allowed);
    if (origin && origin !== allowed) return json({ error: 'Origin not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const path = new URL(request.url).pathname;
    if (path === '/health/ready' && request.method === 'GET') {
      return json({
        status: env.AI && env.RATE_LIMITER && env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY ? 'ready' : 'unconfigured',
        gemini: Boolean(env.GEMINI_API_KEY && env.GEMINI_RATE_LIMITER && env.GEMINI_JOBS)
      }, env.AI && env.RATE_LIMITER && env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY ? 200 : 503, cors);
    }
    const isTranscribe = path === '/v1/transcribe' && request.method === 'POST';
    const isAnalyzeCreate = path === '/v1/analyze' && request.method === 'POST';
    const analysisJobId = /^\/v1\/analyze\/([0-9a-f-]{36})$/.exec(path)?.[1];
    const isAnalyzeStatus = analysisJobId && request.method === 'GET';
    if (!isTranscribe && !isAnalyzeCreate && !isAnalyzeStatus) return json({ error: 'Not found.' }, 404, cors);
    if (isTranscribe && (!env.AI || !env.RATE_LIMITER)) return json({ error: 'Transcription provider is not configured.' }, 503, cors);
    if ((isAnalyzeCreate || isAnalyzeStatus) && !env.GEMINI_JOBS) return json({ error: 'Durable summary queue is not configured.' }, 503, cors);
    if (isAnalyzeCreate && (!env.GEMINI_RATE_LIMITER || !env.GEMINI_API_KEY)) return json({ error: 'Gemini is not configured.' }, 503, cors);
    let userId;
    try {
      userId = await authenticate(request, env);
    } catch {
      return json({ error: 'Authentication provider unavailable.' }, 503, cors);
    }
    if (!userId) return json({ error: 'Sign in with a verified email to transcribe.' }, 401, cors);
    // Polling is authenticated and does not consume the submission quota.
    if (isAnalyzeStatus) {
      const stub = env.GEMINI_JOBS.get(env.GEMINI_JOBS.idFromName(userId + ':' + analysisJobId));
      const result = await stub.fetch('https://jobs.internal/status');
      const data = await result.json();
      return json({ jobId: analysisJobId, ...data }, result.status, cors);
    }
    const limiter = isAnalyzeCreate ? env.GEMINI_RATE_LIMITER : env.RATE_LIMITER;
    const limit = await limiter.limit({ key: userId });
    if (!limit.success) return json({ error: 'Request rate limit reached. Retry after 60 seconds.', retryAfterSeconds: 60 }, 429, { ...cors, 'Retry-After': '60' });
    if (isAnalyzeCreate) {
      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > MAX_BODY_BYTES) return json({ error: 'Summary request exceeds the 256 KB size limit.' }, 413, cors);
      if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) return json({ error: 'Expected application/json.' }, 415, cors);
      let raw;
      try { raw = await request.text(); } catch { return json({ error: 'Could not read transcript.' }, 400, cors); }
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: 'Summary request exceeds the 256 KB size limit.' }, 413, cors);
      let input;
      try { input = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON body.' }, 400, cors); }
      const key = request.headers.get('Idempotency-Key') || crypto.randomUUID();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
        return json({ error: 'Invalid summary job identifier.' }, 400, cors);
      }
      const stub = env.GEMINI_JOBS.get(env.GEMINI_JOBS.idFromName(userId + ':' + key));
      const result = await stub.fetch('https://jobs.internal/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const data = await result.json();
      return json({ jobId: key, ...data }, result.status, cors);
    }
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > MAX_BYTES + 16384) return json({ error: 'Maximum upload size is 8 MiB. Split or compress the recording.' }, 413, cors);
    const ct = request.headers.get('Content-Type') || '';
    if (!ct.toLowerCase().startsWith('multipart/form-data')) return json({ error: 'Upload must be multipart form data.' }, 415, cors);

    try {
      const form = await request.formData();
      const audio = form.get('file');
      if (!(audio instanceof File) || audio.size === 0) return json({ error: 'Audio file is required.' }, 400, cors);
      if (audio.size > MAX_BYTES) return json({ error: 'Maximum upload size is 8 MiB.' }, 413, cors);
      if (!MIME_EXTENSIONS.test(audio.name) || (audio.type && !audio.type.startsWith('audio/') && audio.type !== 'application/octet-stream')) {
        return json({ error: 'Audio only. Use MP3, M4A, WAV, WebM, OGG or FLAC. Video is not supported in cloud mode.' }, 415, cors);
      }
      const mode = form.get('language_mode');
      const language = mode === 'he' ? 'he' : mode === 'en' ? 'en' : undefined;
      const context = String(form.get('context') || '').slice(0, 500);
      const audioBytes = Buffer.from(await audio.arrayBuffer());
      const result = await env.AI.run(MODEL, {
        audio: audioBytes.toString('base64'),
        task: 'transcribe',
        ...(language ? { language } : {}),
        ...(context ? { initial_prompt: context } : {}),
      });
      const segments = normaliseSegments(result);
      if (!segments.length) return json({ error: 'No speech detected or transcription failed.' }, 422, cors);
      return json({
        detected_languages: language ? [language] : result?.transcription_info?.language ? [String(result.transcription_info.language)] : [],
        segments,
        analysis: null,
      }, 200, cors);
    } catch {
      return json({ error: 'Transcription provider failed. Your original audio stays in your browser for retry.' }, 502, cors);
    }
  },
};
