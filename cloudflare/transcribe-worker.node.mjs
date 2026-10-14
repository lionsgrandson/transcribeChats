import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { GeminiSummaryJob } from './transcribe-worker.mjs';

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

const jobId = 'b61d55e4-a34e-4e51-b6c7-93215367477f';
const analyzeBody = (transcript = '[00:00] Speaker 1: שלום עולם') => JSON.stringify({ title: 'Meeting', transcript });
const analyzeRequest = (transcript) => call('POST', '/v1/analyze', analyzeBody(transcript), {
  ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': jobId
});
function fakeStorage() {
  const items = new Map();
  return {
    get: async (key) => items.get(key),
    put: async (key, value) => { items.set(key, value); },
    setAlarm: async (timestamp) => { items.set('alarmAt', timestamp); },
    deleteAll: async () => { items.clear(); }
  };
}
function geminiEnv(overrides = {}) {
  const storage = fakeStorage();
  const context = { storage };
  const configuration = env({
    GEMINI_API_KEY: 'server-private-gemini-key',
    GEMINI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides
  });
  const durable = new GeminiSummaryJob(context, configuration);
  configuration.GEMINI_JOBS = {
    idFromName: (name) => name,
    get: () => ({ fetch: (input, init) => durable.fetch(new Request(input, init)) })
  };
  return { configuration, durable, storage };
}
async function withProvider(fn, providerResponses = []) {
  const original = globalThis.fetch;
  const seen = [];
  let iteration = 0;
  globalThis.fetch = async (request, options) => {
    const url = String(request);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'user-1', email_confirmed_at: '2026-10-12T00:00:00Z' });
    if (!url.includes('generativelanguage.googleapis.com')) throw new Error('Unexpected URL: ' + url);
    seen.push({ url, options });
    return providerResponses[iteration++] || Response.json({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'דובר על הנושא המרכזי.' }) }] } }],
      usageMetadata: { promptTokenCount: 512, candidatesTokenCount: 120 }
    });
  };
  try { return await fn(seen); } finally { globalThis.fetch = original; }
}

test('Gemini queue rejects unverified callers', async () => {
  const { configuration } = geminiEnv();
  const res = await worker.fetch(call('POST', '/v1/analyze', analyzeBody(), { 'Content-Type': 'application/json' }), configuration);
  assert.equal(res.status, 401);
});

test('Gemini queue accepts idempotent requests without calling model in HTTP handler', async () =>
  withProvider(async (seen) => {
    const { configuration, storage } = geminiEnv();
    const first = await worker.fetch(analyzeRequest(), configuration);
    assert.equal(first.status, 202);
    assert.equal((await first.json()).jobId, jobId);
    const second = await worker.fetch(analyzeRequest(), configuration);
    assert.equal(second.status, 202);
    assert.equal(seen.length, 0);
    assert.ok(await storage.get('alarmAt'));
  }));

test('Gemini alarm eventually completes and polling retrieves summary', async () =>
  withProvider(async (seen) => {
    const { configuration, durable, storage } = geminiEnv();
    await worker.fetch(analyzeRequest(), configuration);
    await durable.alarm();
    const res = await worker.fetch(call('GET', '/v1/analyze/' + jobId, undefined, auth), configuration);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ready');
    assert.equal(data.summary, 'דובר על הנושא המרכזי.');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].options.headers['x-goog-api-key'], 'server-private-gemini-key');
    assert.equal(JSON.parse(seen[0].options.body).generationConfig.maxOutputTokens, 3072);
    assert.equal((await storage.get('job')).transcript, '');
  }));

test('Gemini 429 queues a future alarm rather than dropping the transcript', async () =>
  withProvider(async (seen) => {
    const { configuration, durable, storage } = geminiEnv();
    await worker.fetch(analyzeRequest(), configuration);
    await durable.alarm();
    const saved = await storage.get('job');
    assert.equal(saved.status, 'waiting');
    assert.ok(saved.nextRetryAt > Date.now());
    assert.ok(await storage.get('alarmAt'));
    assert.equal(seen.length, 1);
  }, [Response.json({ error: { details: [{ retryDelay: '120s' }] } }, { status: 429 })]));

test('Gemini 429 eventually retries and finishes on the next alarm', async () => withProvider(async () => {
  const { configuration, durable, storage } = geminiEnv();
  await worker.fetch(analyzeRequest(), configuration);
  await durable.alarm();
  const waiting = await storage.get('job');
  await storage.put('job', { ...waiting, nextRetryAt: Date.now() - 1 });
  await durable.alarm();
  assert.equal((await storage.get('job')).status, 'ready');
}, [Response.json({ error: { details: [{ retryDelay: '1s' }] } }, { status: 429 })]));

test('Gemini upload size rejected and no job stored', async () => withProvider(async () => {
  const { configuration, storage } = geminiEnv();
  const res = await worker.fetch(analyzeRequest('x'.repeat(120_001)), configuration);
  assert.equal(res.status, 413);
  assert.equal(await storage.get('job'), undefined);
}));

test('Gemini submission limiter provides retry guidance', async () => withProvider(async (seen) => {
  const { configuration } = geminiEnv({ GEMINI_RATE_LIMITER: { limit: async () => ({ success: false }) } });
  const res = await worker.fetch(analyzeRequest(), configuration);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
  assert.equal(seen.length, 0);
}));
