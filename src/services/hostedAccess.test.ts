import { beforeEach, expect, test, vi } from 'vitest';
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { auth: { getSession } } }));
import { guestAccessToken, hostedAccessHeaders } from './hostedAccess';

beforeEach(() => { localStorage.clear(); getSession.mockReset(); });

test('guest capability survives reload and replaces malformed stored values', () => {
  localStorage.setItem('transcribeChats:guest-token', 'predictable');
  const token = guestAccessToken();
  expect(token).toMatch(/^[0-9a-f-]{36}$/);
  expect(token).not.toBe('predictable');
  expect(guestAccessToken()).toBe(token);
});

test('no session or optional auth outage still permits guest inference', async () => {
  getSession.mockResolvedValueOnce({ data: { session: null } });
  const first = await hostedAccessHeaders();
  expect(first['X-Guest-Token']).toBeTruthy();
  getSession.mockRejectedValueOnce(new Error('Optional auth unavailable'));
  expect(await hostedAccessHeaders()).toEqual(first);
});

test('existing verified accounts retain their own queued jobs and do not send a guest capability', async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-account-token', user: { email_confirmed_at: '2026-10-14' } } } });
  expect(await hostedAccessHeaders()).toEqual({ Authorization: 'Bearer synthetic-account-token' });
});
