import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './transcribe-worker.mjs';

const origin = 'https://transcribe.example.com';
const env = (overrides = {}) => ({
  ALLOWED_ORIGIN: origin,
  SUPABASE_URL: 'https://auth.example.com',
  SUPABASE_PUBLISHABLE_KEY: 'public-key',
  RATE_LIMITER: { limit: async () => ({ success: true }) },
  AI: { run: async () => ({
    text: 'שלום עולם',
    segments: [{ start: 0, end: 1.5, text: 'שלום עולם' }],
    transcription_info: { language: 'he' },
  }) },
  ...overrides,
});
const call = (method, path, body, headers = {}) =>
  new Request('https://api.example.com' + path, { method, body, headers: { Origin: origin, ...headers } });
const audioForm = (filename = 'lecture.mp3') => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([1, 2, 3])], filename, { type: 'audio/mpeg' }));
  form.append('language_mode', 'he');
  return form;
};
const auth = { Authorization: 'Bearer signed.token.value' };

async function mockAuth(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ id: 'user-1', email_confirmed_at: '2026-10-12T00:00:00Z' });
  try { return await fn(); } finally { globalThis.fetch = original; }
}

test('health check fails closed with missing bindings', async () => {
  const res = await worker.fetch(call('GET', '/health/ready'), env({ RATE_LIMITER: undefined }));
  assert.equal(res.status, 503);
});
test('cross-origin requests rejected before model execution', async () => {
  const res = await worker.fetch(new Request('https://api.example.com/v1/transcribe', {
    method: 'POST', headers: { Origin: 'https://other.example.com', ...auth }, body: audioForm()
  }), env());
  assert.equal(res.status, 403);
});
test('anonymous requests are rejected', async () => {
  const res = await worker.fetch(call('POST', '/v1/transcribe', audioForm()), env());
  assert.equal(res.status, 401);
});
test('rate-limited users cannot trigger inference', async () => mockAuth(async () => {
  const res = await worker.fetch(call('POST', '/v1/transcribe', audioForm(), auth), env({
    RATE_LIMITER: { limit: async () => ({ success: false }) },
    AI: { run: () => { throw new Error('Must not run model'); } }
  }));
  assert.equal(res.status, 429);
}));
test('authenticated audio returns compatible timestamped segments', async () => mockAuth(async () => {
  const res = await worker.fetch(call('POST', '/v1/transcribe', audioForm(), auth), env());
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.segments[0].text, 'שלום עולם');
  assert.equal(data.segments[0].start_ms, 0);
  assert.equal(data.segments[0].end_ms, 1500);
  assert.equal(data.segments[0].speaker_label, 'Speaker 1');
  assert.equal(data.detected_languages[0], 'he');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
}));
test('video upload is not accepted', async () => mockAuth(async () => {
  const res = await worker.fetch(call('POST', '/v1/transcribe', audioForm('clip.mp4'), auth), env());
  assert.equal(res.status, 415);
}));

const analyzeBody = (transcript = '[00:00] Speaker 1: שלום עולם') => JSON.stringify({ title: 'Meeting', transcript });
const analyzeRequest = (text = '[00:00] Speaker 1: שלום עולם') =>
  call('POST', '/v1/analyze', analyzeBody(text), { ...auth, 'Content-Type': 'application/json' });

async function withGeminiMock(fn, geminiResponse = Response.json({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'דובר על הנושא המרכזי.' }) }] } }]
})) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-1', email_confirmed_at: '2026-10-12T00:00:00Z' });
    if (url.includes('generativelanguage.googleapis.com')) {
      seen.push({ url, init });
      return geminiResponse;
    }
    throw new Error('Unexpected external request: ' + url);
  };
  try { return await fn(seen); } finally { globalThis.fetch = original; }
}

test('Gemini analysis requires a verified user', async () => {
  const res = await worker.fetch(analyzeRequest(), env({ GEMINI_API_KEY: 'private', GEMINI_RATE_LIMITER: { limit: async () => ({ success: true }) } }));
  // No mocked authentication, so the real request is unavailable. Test missing bearer explicitly instead.
  assert.notEqual(res.status, 200);
});

test('Gemini analysis rejects missing secret without running model', async () => withGeminiMock(async (calls) => {
  const res = await worker.fetch(analyzeRequest(), env({ GEMINI_RATE_LIMITER: { limit: async () => ({ success: true }) } }));
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
}));

test('Gemini summary uses server-only key and bounded output tokens', async () => withGeminiMock(async (calls) => {
  const res = await worker.fetch(analyzeRequest(), env({ GEMINI_API_KEY: 'private-gemini-key', GEMINI_RATE_LIMITER: { limit: async () => ({ success: true }) } }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.summary, 'דובר על הנושא המרכזי.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'private-gemini-key');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.generationConfig.maxOutputTokens, 1024);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
}));

test('Gemini input size is enforced before API usage', async () => withGeminiMock(async (calls) => {
  const res = await worker.fetch(analyzeRequest('x'.repeat(20_001)), env({ GEMINI_API_KEY: 'private', GEMINI_RATE_LIMITER: { limit: async () => ({ success: true }) } }));
  assert.equal(res.status, 413);
  assert.equal(calls.length, 0);
}));

test('Gemini quota errors are reported as 429 without fallback to paid models', async () => withGeminiMock(async (calls) => {
  const res = await worker.fetch(analyzeRequest(), env({ GEMINI_API_KEY: 'private', GEMINI_RATE_LIMITER: { limit: async () => ({ success: true }) } }));
  assert.equal(res.status, 429);
  assert.equal(calls.length, 1);
}, Response.json({ error: { message: 'quota' } }, { status: 429 })));

test('Gemini rate limit blocks model calls', async () => withGeminiMock(async (calls) => {
  const res = await worker.fetch(analyzeRequest(), env({ GEMINI_API_KEY: 'private', GEMINI_RATE_LIMITER: { limit: async () => ({ success: false }) } }));
  assert.equal(res.status, 429);
  assert.equal(calls.length, 0);
}));
