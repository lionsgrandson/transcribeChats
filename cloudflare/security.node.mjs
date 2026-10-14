import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './transcribe-worker.mjs';
import { summarizeJobWithGemini } from './gemini-jobs.mjs';

const origin = 'https://transcribe-chats.pages.dev';
const baseEnv = { ALLOWED_ORIGIN: origin, SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', AI: {}, RATE_LIMITER: {} };

test('local Gemini origins are opt-in and arbitrary origins remain blocked', async () => {
  const local = new Request('https://api.example/v1/analyze', { method: 'OPTIONS', headers: { Origin: 'http://localhost:4173' } });
  assert.equal((await worker.fetch(local, baseEnv)).status, 403);
  const allowed = await worker.fetch(local, { ...baseEnv, ENABLE_LOCAL_ORIGIN: 'true' });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'http://localhost:4173');
  assert.equal((await worker.fetch(new Request('https://api.example/health/ready', { headers: { Origin: 'http://localhost:9999' } }), { ...baseEnv, ENABLE_LOCAL_ORIGIN: 'true' })).status, 403);
});

test('same job identifier is scoped to the verified account', async () => {
  const original = globalThis.fetch;
  const names = [];
  globalThis.fetch = async (_request, options) => Response.json({ id: options.headers.Authorization.endsWith('second') ? 'user-two' : 'user-one', email_confirmed_at: '2026-10-14T00:00:00Z' });
  try {
    const env = { ...baseEnv, GEMINI_JOBS: { idFromName: (name) => { names.push(name); return name; }, get: (name) => ({ fetch: () => Response.json({ status: 'ready', summary: name.startsWith('user-one:') ? 'First account result' : 'Second account result' }) }) } };
    const job = '12345678-1234-4234-8234-123456789abc';
    const first = await worker.fetch(new Request(`https://api.example/v1/analyze/${job}`, { headers: { Authorization: 'Bearer first' } }), env);
    const second = await worker.fetch(new Request(`https://api.example/v1/analyze/${job}`, { headers: { Authorization: 'Bearer second' } }), env);
    assert.equal((await first.json()).summary, 'First account result');
    assert.equal((await second.json()).summary, 'Second account result');
    assert.deepEqual(names, [`user-one:${job}`, `user-two:${job}`]);
  } finally { globalThis.fetch = original; }
});

test('structured meeting schema remains compatible with the live Gemini API contract', async () => {
  const item = { kind: 'task', title: 'Send report', body: 'Explicit commitment', priority: 'medium', confidence: .9, sourceSegmentIds: ['s1'], dueAt: null };
  const result = await summarizeJobWithGemini({ mode: 'meeting', transcript: '[segment_id=s1] I will send the report.' }, { GEMINI_API_KEY: 'test-only' }, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseSchema.properties.items.maxItems, undefined);
    assert.equal(body.generationConfig.temperature, undefined);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'Synthetic meeting', items: [item] }) }] } }] });
  });
  assert.equal(result.ok, true); assert.deepEqual(result.items, [item]);
});

test('malformed model follow-ups cannot be treated as a successful analysis', async () => {
  const result = await summarizeJobWithGemini({ mode: 'meeting', transcript: 'Synthetic' }, { GEMINI_API_KEY: 'test-only' }, async () => Response.json({ candidates: [{ content: { parts: [{ text: '{"summary":"test","items":[{"kind":"delete-account"}]}' }] } }] }));
  assert.equal(result.ok, false); assert.equal(result.retryable, false);
});
