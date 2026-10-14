import type { User } from '@supabase/supabase-js';
import { CheckCircle2, Cloud, Globe2, HardDrive, Shield, User as UserIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, Field, PageSkeleton } from '../components/ui';
import type { LanguageMode, Locale } from '../domain/types';
import { useTranslation } from '../i18n/useTranslation';
import { currentUser, sendMagicLink, signOut, supabase, supabaseConfigured } from '../services/supabase';
import { useAppStore } from '../state/AppStore';
import { CrmSettings } from '../components/CrmSettings';
import { db, recoverLegacyBrowserData } from '../data/db';
import { downloadWorkspaceSnapshot, localWorkspaceSnapshot } from '../services/workspaceSync';
import { AuthChallenge } from '../components/AuthChallenge';

export function SettingsPage() {
  const store = useAppStore();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const cloud = Boolean(import.meta.env.VITE_CLOUD_TRANSCRIBE_URL);
  useEffect(() => {
    void currentUser().then(setUser);
    const listener = supabase?.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => { listener?.data.subscription.unsubscribe(); };
  }, []);
  const doSignIn = async () => {
    if (!email.trim()) return;
    setBusy(true); setMessage('');
    try { await sendMagicLink(email.trim(), captchaToken); setCaptchaToken(''); setMessage('Check your email for a secure sign-in link.'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  };
  if (store.loading) return <PageSkeleton />;
  return <div className="page page-settings">
    <header className="page-header"><div><span className="eyebrow"><Shield size={15} />{t('preferencesPrivacy')}</span><h1>{t('settings')}</h1></div></header>
    {message && <p role="status">{message}</p>}
    <div className="settings-content">
      <Card className="settings-section">
        <div className="settings-heading"><span><Globe2 /></span><div><h2>{t('languageAndDirection')}</h2></div></div>
        <div className="setting-row"><div><strong>{t('interfaceLanguage')}</strong></div>
          <select value={store.settings.locale} onChange={(event) => void store.updateSettings({ locale: event.target.value as Locale })}><option value="en">English</option><option value="he">עברית</option></select></div>
        <div className="setting-row"><div><strong>{t('defaultTranscriptLanguage')}</strong></div>
          <select value={store.settings.languageMode} onChange={(event) => void store.updateSettings({ languageMode: event.target.value as LanguageMode })}><option value="auto">{t('autoDetect')}</option><option value="en">{t('english')}</option><option value="he">{t('hebrew')}</option><option value="mixed">{t('mixed')}</option></select></div>
      </Card>
      <Card className="settings-section">
        <div className="settings-heading"><span><HardDrive /></span><div><h2>Transcription engine</h2><p>{cloud ? 'Hosted Cloudflare Whisper API' : 'Local Python/Whisper engine'}</p></div></div>
        <div className="setting-row"><div><strong>{store.workerReady === true ? 'Engine is reachable' : store.workerReady === null ? 'Checking engine...' : 'Engine is unavailable'}</strong>
          <span>{cloud ? 'Hosted transcription requires a verified account. Limit: 8 MiB audio per request.' : 'Local transcription requires the Python worker or Docker to be running.'}</span></div>
          <Button variant="secondary" onClick={() => void store.refreshWorker()}><CheckCircle2 size={16} />Check</Button></div>
        {!cloud && <Field label="Local worker URL"><input value={store.settings.workerUrl} dir="ltr" onChange={(event) => void store.updateSettings({ workerUrl: event.target.value })} placeholder="http://localhost:8787" /></Field>}
      </Card>
      {supabaseConfigured && <Card className="settings-section">
        <div className="settings-heading"><span><UserIcon /></span><div><h2>Account</h2><p>Cloud transcription requires confirmed-email sign-in.</p></div></div>
        {user ? <><p dir="auto">{user.email} {user.email_confirmed_at ? '(verified)' : '(not yet verified)'}</p>
          <div className="inline-actions"><Button variant="secondary" onClick={() => void signOut().then(() => setUser(null)).catch((reason) => setMessage(String(reason)))}>Sign out</Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setBusy(true); void store.sync().then(() => setMessage('Sync completed.')).catch((reason) => setMessage(String(reason))).finally(() => setBusy(false)); }}><Cloud size={16} />Sync records</Button></div>
        </> : <div><Field label="Email"><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></Field>
          <AuthChallenge onToken={setCaptchaToken} /><Button busy={busy} disabled={!email.trim() || Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY && !captchaToken)} onClick={() => void doSignIn()}>Email sign-in link</Button></div>}
      </Card>}
      {!supabaseConfigured && cloud && <Card className="settings-section"><strong>Sign-in not configured.</strong><p>Set the Supabase public URL and publishable key in the frontend build before enabling the hosted transcription engine.</p></Card>}
      <Card className="settings-section"><div className="settings-heading"><span><Shield /></span><div><h2>Privacy and storage</h2></div></div>
        <p>Original recordings and transcripts are saved in this browser's local IndexedDB. Cloud transcription uploads audio temporarily for model inference; the transcription API does not persist it. Signing in does not automatically synchronize stored records.</p>
        <p>Export your transcript before clearing browser data or uninstalling the app. Full synchronization is an explicit action.</p>
        <label className="checkbox-field"><input type="checkbox" checked={Boolean(store.settings.syncAudio)} onChange={(event) => void store.updateSettings({ syncAudio: event.target.checked })} />Include recordings in manual cloud sync (up to 50 MiB each)</label>
        <div className="workspace-actions"><Button variant="secondary" onClick={() => void localWorkspaceSnapshot('export').then((snapshot) => downloadWorkspaceSnapshot(snapshot)).catch((reason) => setMessage(String(reason)))}>Export workspace JSON</Button><Button variant="secondary" onClick={() => void db.syncBackups.orderBy('createdAt').last().then((backup) => { if (backup) downloadWorkspaceSnapshot(backup.payload, 'transcribechats-recovery.json'); else setMessage('No recovery snapshots are needed yet.'); }).catch((reason) => setMessage(String(reason)))}>Export latest recovery copy</Button></div>
        {db.name !== 'transcribeChats' && <Button variant="secondary" disabled={busy} onClick={() => {
          if (!window.confirm('Copy legacy transcripts, recordings and learning data from this browser into your account workspace? Continue only if these records belong to you. Existing account records and the original data will be preserved. CRM credentials will not be copied.')) return;
          setBusy(true); void recoverLegacyBrowserData().then((count) => { setMessage(`Recovered ${count} legacy transcripts. Reloading workspace…`); window.location.reload(); }).catch((reason) => setMessage(String(reason))).finally(() => setBusy(false));
        }}>Recover existing browser transcripts</Button>}
      </Card>
      <CrmSettings />
    </div>
  </div>;
}
