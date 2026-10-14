import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './transcribe-worker.mjs';

const origin = 'https://transcribe-chats.pages.dev';
const firstToken = 'b11d55e4-a34e-4e51-b6c7-93215367477f';
const secondToken = 'a11d55e4-a34e-4e51-b6c7-93215367477f';
const jobId = 'd11d55e4-a34e-4e51-b6c7-93215367477f';
function request(path, token = firstToken, init = {}) {
  return new Request('https://api.example' + path, { ...init, headers: { Origin: origin, 'X-Guest-Token': token, 'CF-Connecting-IP': '192.0.2.1', ...init.headers } });
}
function environment(extra = {}) {
  return { ALLOWED_ORIGIN: origin, ALLOW_GUEST_ACCESS: 'true', RATE_LIMITER: { limit: async () => ({ success: true }) }, AI: { run: async () => ({ text: 'Synthetic guest transcript' }) }, ...extra };
}
function audio() {
  const form = new FormData();
  form.set('file', new File(['synthetic'], 'test.wav', { type: 'audio/wav' }));
  return form;
}

test('guest transcription works without a Supabase dependency or Authorization header', async () => {
  const response = await worker.fetch(request('/v1/transcribe', firstToken, { method: 'POST', body: audio() }), environment());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).segments[0].text, 'Synthetic guest transcript');
  const health = await worker.fetch(request('/health/ready'), environment());
  assert.equal(health.status, 200);
  assert.equal((await health.json()).guestAccess, true);
});

test('guest access is explicit, validates capabilities and never downgrades invalid account credentials', async () => {
  for (const [token, extra, headers] of [[firstToken, { ALLOW_GUEST_ACCESS: 'false' }, {}], ['predictable', {}, {}], [firstToken, {}, { Authorization: 'invalid' }]]) {
    const response = await worker.fetch(request('/v1/transcribe', token, { method: 'POST', body: audio(), headers }), environment(extra));
    assert.equal(response.status, 401);
  }
});

test('rotating guest capabilities cannot bypass the IP submission limit', async () => {
  const seen = [];
  const env = environment({ RATE_LIMITER: { limit: async ({ key }) => { seen.push(key); return { success: !key.startsWith('ip:') || seen.filter(value => value.startsWith('ip:')).length === 1 }; } } });
  const first = await worker.fetch(request('/v1/transcribe', firstToken, { method: 'POST', body: audio() }), env);
  const second = await worker.fetch(request('/v1/transcribe', secondToken, { method: 'POST', body: audio() }), env);
  assert.equal(first.status, 200); assert.equal(second.status, 429);
  assert.equal(second.headers.get('Retry-After'), '60');
  assert.equal(seen[0], seen[2]);
  assert.equal(seen.some(key => key.includes('192.0.2.1')), false);
});

test('same job UUID cannot expose one guest analysis to a different browser', async () => {
  const names = [];
  const env = environment({ GEMINI_JOBS: {
    idFromName: (name) => { names.push(name); return name; },
    get: (name) => ({ fetch: async () => name === `guest:${firstToken}:${jobId}` ? Response.json({ status: 'ready', summary: 'Private synthetic result' }) : Response.json({ error: 'Not found' }, { status: 404 }) })
  } });
  const first = await worker.fetch(request('/v1/analyze/' + jobId), env);
  const second = await worker.fetch(request('/v1/analyze/' + jobId, secondToken), env);
  assert.equal(first.status, 200); assert.equal(second.status, 404);
  assert.deepEqual(names, [`guest:${firstToken}:${jobId}`, `guest:${secondToken}:${jobId}`]);
});

test('guest CORS preflight permits its capability header only for the configured frontend', async () => {
  const response = await worker.fetch(request('/v1/transcribe', firstToken, { method: 'OPTIONS' }), environment());
  assert.equal(response.status, 204);
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /X-Guest-Token/);
  const rejected = await worker.fetch(request('/v1/transcribe', firstToken, { method: 'OPTIONS', headers: { Origin: 'https://attacker.example' } }), environment());
  assert.equal(rejected.status, 403);
});
