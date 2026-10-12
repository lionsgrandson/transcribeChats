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
