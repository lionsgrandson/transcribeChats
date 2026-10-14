import { supabase } from './supabase';

const storageKey = 'transcribeChats:guest-token';
const guestTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// An opaque browser capability, never a shared account or a public API key.
// Keep it across reloads so durable analysis jobs remain accessible to this browser.
export function guestAccessToken(): string {
  const existing = localStorage.getItem(storageKey);
  if (existing && guestTokenPattern.test(existing)) return existing;
  const token = crypto.randomUUID();
  localStorage.setItem(storageKey, token);
  return token;
}

export async function hostedAccessHeaders(): Promise<Record<string, string>> {
  if (supabase) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const session = await Promise.race([
        supabase.auth.getSession(),
        new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 3000); })
      ]);
      if (!session) return { 'X-Guest-Token': guestAccessToken() };
      const { data, error } = session;
      if (!error && data.session?.access_token && data.session.user.email_confirmed_at) {
        return { Authorization: `Bearer ${data.session.access_token}` };
      }
    } catch { /* Optional sync-account availability must not block guest inference. */ }
    finally { if (timeout) clearTimeout(timeout); }
  }
  return { 'X-Guest-Token': guestAccessToken() };
}
