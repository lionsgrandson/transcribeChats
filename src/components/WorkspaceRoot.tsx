import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { configureAccountDatabase } from '../data/db';
import { hostedRuntime } from '../services/runtime';
import { sendMagicLink, supabase } from '../services/supabase';
import { AppStoreProvider } from '../state/AppStore';
import App from '../App';
import { AuthChallenge } from './AuthChallenge';

export function WorkspaceRoot() {
  const [ready, setReady] = useState(!hostedRuntime);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [challengeKey, setChallengeKey] = useState(0);
  useEffect(() => {
    if (!hostedRuntime || !supabase) return;
    let active = true;
    let initialAccount: string | null | undefined;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) { setMessage(error.message); return; }
      initialAccount = data.session?.user.id ?? null;
      if (initialAccount) configureAccountDatabase(initialAccount);
      setUser(data.session?.user ?? null);
      setReady(true);
    }).catch((reason) => setMessage(String(reason)));
    const listener = supabase.auth.onAuthStateChange((_event, session) => {
      if (initialAccount !== undefined && initialAccount !== (session?.user.id ?? null)) window.location.reload();
    });
    return () => { active = false; listener.data.subscription.unsubscribe(); };
  }, []);
  if (!hostedRuntime || (ready && user)) return <AppStoreProvider><App /></AppStoreProvider>;
  return <main className="auth-screen"><section className="card auth-card">
    <span className="brand-mark">T</span><h1>TranscribeChats</h1>
    <p>Transcribe, review and follow through.</p><p dir="rtl" lang="he">תמלול, תובנות ומשימות — בעברית ובאנגלית</p>
    {!supabase ? <p role="alert">Hosted sign-in is unavailable. Public Supabase configuration is required.</p> : <form onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setMessage('');
      void sendMagicLink(email.trim(), captchaToken).then(() => setMessage('Check your email for a secure sign-in link.')).catch((reason) => setMessage(String(reason))).finally(() => { setBusy(false); setCaptchaToken(''); setChallengeKey((key) => key + 1); });
    }}>
      <label>Email / אימייל<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <AuthChallenge key={challengeKey} onToken={setCaptchaToken} />
      <button className="button button-primary" disabled={busy || !ready || Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY && !captchaToken)} type="submit">{busy ? 'Sending…' : 'Email sign-in link / כניסה באימייל'}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <small>Your workspace is private to your account. Existing browser transcripts can be recovered from Settings after sign-in.</small>
  </section></main>;
}
