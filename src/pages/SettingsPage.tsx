import type { User as SupabaseUser } from '@supabase/supabase-js';
import { AlertCircle, Bell, CheckCircle2, Cloud, Database, Download, Globe2, HardDrive, Languages, Link2, LogOut, RefreshCw, Server, Shield, Trash2, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, Field, PageSkeleton, Skeleton, SuccessBanner } from '../components/ui';
import type { LanguageMode, Locale } from '../domain/types';
import { useTranslation } from '../i18n/useTranslation';
import { currentUser, sendMagicLink, signOut, supabaseConfigured } from '../services/supabase';
import { useAppStore } from '../state/AppStore';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function SettingsPage() {
  const { t, locale } = useTranslation();
  const store = useAppStore();
  const [email, setEmail] = useState('');
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent>();
  const [crmTestState, setCrmTestState] = useState<'blank' | 'filled' | 'loading' | 'success' | 'failure'>(store.settings.crmWebhookUrl && store.settings.crmApiToken ? 'filled' : 'blank');
  const [crmTestMessage, setCrmTestMessage] = useState(store.settings.crmWebhookUrl && store.settings.crmApiToken ? 'CRM settings are filled and ready to test.' : 'Choose a CRM, then paste its webhook endpoint and API token.');

  const engineCopy = locale === 'he' ? {
    title: 'מנוע התמלול',
    body: 'המנוע הוא שירות Python שממיר קובצי שמע ווידאו לטקסט. Docker מפעיל אותו במחשב.',
    connection: 'חיבור למנוע התמלול',
    local: 'במחשב הזה: השתמשו ב-http://localhost:8787 כאשר Docker פועל כאן.',
    remote: 'במחשב אחר: הזינו את כתובת הרשת של מחשב שמפעיל את אותו מנוע, למשל http://192.168.1.50:8787.',
    blankTitle: 'לא הוגדרה כתובת',
    blankBody: 'אפשר עדיין להדביק טקסט ולנהל משימות, אך לא לתמלל קובצי מדיה.',
    checkingTitle: 'בודק את החיבור',
    checkingBody: 'מנסה להגיע למנוע התמלול בכתובת שהוגדרה.',
    readyTitle: 'המנוע מוכן',
    readyBody: 'אפשר להקליט או להעלות קובץ לתמלול.',
    failedTitle: 'לא ניתן להגיע למנוע',
    failedBody: 'יש להפעיל את Docker או לתקן את הכתובת, ואז לבדוק שוב.',
    useThisComputer: 'שימוש במחשב הזה',
    checkConnection: 'בדיקת חיבור',
    addressHint: 'כתובת ברירת המחדל למנוע Docker שפועל במחשב הזה היא http://localhost:8787.',
    browserLimit: 'מטעמי אבטחה, כפתור בדיקת החיבור אינו יכול להפעיל את Docker; יש להפעיל את Docker Desktop בנפרד.'
  } : {
    title: 'Transcription engine',
    body: 'The engine is a Python service that converts audio and video into text. Docker runs it on a computer.',
    connection: 'Transcription engine connection',
    local: 'This computer: use http://localhost:8787 when Docker is running here.',
    remote: 'Another computer: enter the network address of a computer running the same engine, for example http://192.168.1.50:8787.',
    blankTitle: 'No engine address',
    blankBody: 'You can still paste text and manage tasks, but media files cannot be transcribed.',
    checkingTitle: 'Checking the connection',
    checkingBody: 'Trying to reach the transcription engine at the configured address.',
    readyTitle: 'Engine is ready',
    readyBody: 'You can record or upload a file for transcription.',
    failedTitle: 'Engine cannot be reached',
    failedBody: 'Start Docker or correct the address, then check again.',
    useThisComputer: 'Use this computer',
    checkConnection: 'Check connection',
    addressHint: 'The default address for the Docker engine running on this computer is http://localhost:8787.',
    browserLimit: 'For security, the connection button cannot start Docker. Start Docker Desktop separately, then check the connection here.'
  };

  useEffect(() => { void currentUser().then(setUser); }, []);
  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (store.loading) return <PageSkeleton />;

  const workerAddress = store.settings.workerUrl.trim();
  const workerState = !workerAddress ? 'blank' : store.workerReady === null ? 'checking' : store.workerReady ? 'ready' : 'failed';
  const workerStatus = {
    blank: { title: engineCopy.blankTitle, body: engineCopy.blankBody, icon: <HardDrive /> },
    checking: { title: engineCopy.checkingTitle, body: engineCopy.checkingBody, icon: <RefreshCw className="spin" /> },
    ready: { title: engineCopy.readyTitle, body: engineCopy.readyBody, icon: <CheckCircle2 /> },
    failed: { title: engineCopy.failedTitle, body: engineCopy.failedBody, icon: <AlertCircle /> }
  }[workerState];

  const magicLink = async () => {
    setBusy(true);
    setMessage('');
    try {
      await sendMagicLink(email);
      setMessage('Check your inbox for the secure sign-in link.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not send the link.');
    } finally {
      setBusy(false);
    }
  };

  const doSync = async () => {
    setBusy(true);
    setMessage('');
    try {
      await store.sync();
      setMessage('Sync completed.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Sync failed.');
    } finally {
      setBusy(false);
    }
  };

  const testCrm = async () => {
    setCrmTestState('loading'); setCrmTestMessage('Testing the selected CRM connection…');
    try {
      const token = store.settings.crmApiToken.trim();
      const response = await fetch(store.settings.crmWebhookUrl.trim(), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}` }, body: JSON.stringify({ schemaVersion: 2, eventType: 'crm.connection.test', occurredAt: new Date().toISOString(), provider: store.settings.crmProvider }) });
      const result = await response.json().catch(() => ({})) as { accepted?: boolean; error?: string };
      if (!response.ok || !result.accepted) throw new Error(result.error || `CRM returned HTTP ${response.status}.`);
      setCrmTestState('success'); setCrmTestMessage('The CRM accepted the test. Future task transfers will use this connection.');
    } catch (reason) { setCrmTestState('failure'); setCrmTestMessage(reason instanceof Error ? reason.message : 'CRM connection failed.'); }
  };

  return (
    <div className="page page-settings">
      <header className="page-header">
        <div><span className="eyebrow"><Shield size={15} />{t('preferencesPrivacy')}</span><h1>{t('settings')}</h1><p>{t('settingsSubtitle')}</p></div>
      </header>
      {message && <SuccessBanner>{message}</SuccessBanner>}
      <div className="settings-layout">
        <nav className="settings-nav">
          <a href="#language"><Languages />{t('languageAndDirection')}</a>
          <a href="#processing"><Server />{engineCopy.title}</a>
          <a href="#sync"><Cloud />{t('cloudSync')}</a>
          <a href="#crm"><Link2 />CRM</a>
          <a href="#notifications"><Bell />{t('notifications')}</a>
          <a href="#storage"><Database />{t('storageData')}</a>
        </nav>
        <div className="settings-content">
          <Card className="settings-section" id="language">
            <div className="settings-heading"><span><Globe2 /></span><div><h2>{t('languageAndDirection')}</h2><p>{t('languageSectionBody')}</p></div></div>
            <div className="setting-row"><div><strong>{t('interfaceLanguage')}</strong><span>{t('interfaceLanguageBody')}</span></div><select value={store.settings.locale} onChange={(event) => void store.updateSettings({ locale: event.target.value as Locale })}><option value="en">English</option><option value="he">עברית</option></select></div>
            <div className="setting-row"><div><strong>{t('defaultTranscriptLanguage')}</strong><span>{t('autoLanguageBody')}</span></div><select value={store.settings.languageMode} onChange={(event) => void store.updateSettings({ languageMode: event.target.value as LanguageMode })}><option value="auto">{t('autoDetect')}</option><option value="en">{t('english')}</option><option value="he">{t('hebrew')}</option><option value="mixed">{t('mixed')}</option></select></div>
          </Card>

          <Card className="settings-section" id="processing">
            <div className="settings-heading"><span><Server /></span><div><h2>{engineCopy.title}</h2><p>{engineCopy.body}</p></div></div>
            <div className={`engine-status engine-status-${workerState}`}>
              <span className="engine-status-icon" aria-hidden="true">{workerStatus.icon}</span>
              <div><strong>{workerStatus.title}</strong>{workerState === 'checking' ? <Skeleton className="engine-status-skeleton" /> : <span>{workerStatus.body}</span>}</div>
              <Button variant="secondary" busy={workerState === 'checking'} disabled={!workerAddress} onClick={() => void store.refreshWorker()}>{engineCopy.checkConnection}</Button>
            </div>
            <Field label={engineCopy.connection} hint={engineCopy.addressHint}>
              <input value={store.settings.workerUrl} onChange={(event) => void store.updateSettings({ workerUrl: event.target.value })} placeholder="http://localhost:8787" dir="ltr" />
            </Field>
            <div className="inline-actions engine-actions">
              <Button variant="secondary" disabled={store.settings.workerUrl === 'http://localhost:8787'} onClick={() => void store.updateSettings({ workerUrl: 'http://localhost:8787' })}>{engineCopy.useThisComputer}</Button>
            </div>
            <div className="engine-explanation"><p><strong>{engineCopy.local.split(':')[0]}:</strong>{engineCopy.local.slice(engineCopy.local.indexOf(':') + 1)}</p><p><strong>{engineCopy.remote.split(':')[0]}:</strong>{engineCopy.remote.slice(engineCopy.remote.indexOf(':') + 1)}</p></div>
            <p className="settings-note"><HardDrive />{t('modelCostNote')}</p>
            <p className="settings-note"><Shield />{engineCopy.browserLimit}</p>
          </Card>

          <Card className="settings-section" id="sync">
            <div className="settings-heading"><span><Cloud /></span><div><h2>{t('cloudSync')}</h2><p>{t('cloudSyncBody')}</p></div></div>
            {supabaseConfigured ? user ? <div className="account-card"><span><User /></span><div><strong>{user.email}</strong><small>{t('signedIn')}</small></div><Button variant="secondary" onClick={() => void signOut().then(() => setUser(null))}><LogOut size={16} />{t('signOut')}</Button></div> : <div className="auth-form"><Field label={t('email')}><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" dir="ltr" /></Field><Button busy={busy} disabled={!email} onClick={() => void magicLink()}>{t('sendMagicLink')}</Button></div> : <div className="banner banner-neutral">{t('supabaseNotConfigured')}</div>}
            <div className="setting-row"><div><strong>{t('crossDeviceSync')}</strong><span>{store.settings.lastSyncAt ? new Date(store.settings.lastSyncAt).toLocaleString() : t('notSynced')}</span></div><Button busy={busy} disabled={!supabaseConfigured || !user} onClick={() => void doSync()}><RefreshCw size={16} />{t('syncNow')}</Button></div>
          </Card>

          <Card className="settings-section" id="crm">
            <div className="settings-heading"><span><Link2 /></span><div><h2>CRM connection</h2><p>Choose the CRM used by this copy of transcribeChats. Credentials stay on this device.</p></div></div>
            <div className={`banner ${crmTestState === 'failure' ? 'banner-error' : crmTestState === 'success' ? 'banner-success' : 'banner-neutral'}`}>{crmTestState === 'loading' ? <RefreshCw className="spin" /> : crmTestState === 'failure' ? <AlertCircle /> : crmTestState === 'success' ? <CheckCircle2 /> : <Link2 />}<div><strong>{crmTestState === 'blank' ? 'Blank connection' : crmTestState === 'filled' ? 'Connection filled' : crmTestState === 'loading' ? 'Testing connection' : crmTestState === 'success' ? 'CRM connected' : 'CRM connection failed'}</strong><span>{crmTestMessage}</span></div></div>
            <div className="setting-row"><div><strong>Enable CRM sync</strong><span>Show and use direct CRM transfer actions.</span></div><label className="switch"><input type="checkbox" checked={store.settings.crmEnabled} onChange={(event) => void store.updateSettings({ crmEnabled: event.target.checked })} /><span /></label></div>
            <Field label="CRM type"><select value={store.settings.crmProvider} onChange={(event) => void store.updateSettings({ crmProvider: event.target.value as typeof store.settings.crmProvider })}><option value="codecrafter">CodeCrafter CRM</option><option value="creativecrm">CreativeCRM</option><option value="compatible">CodeCrafter-compatible CRM</option><option value="custom">Custom compatible webhook</option></select></Field>
            <Field label="Webhook endpoint" hint="Copy this from Security & API in the selected CRM."><input type="url" value={store.settings.crmWebhookUrl} onChange={(event) => { void store.updateSettings({ crmWebhookUrl: event.target.value }); setCrmTestState(event.target.value && store.settings.crmApiToken ? 'filled' : 'blank'); }} placeholder="https://project.supabase.co/functions/v1/crm-ingest" dir="ltr" /></Field>
            <Field label="API token" hint="Generate this in the selected CRM. The token is stored only in this app's local settings."><input type="password" value={store.settings.crmApiToken} onChange={(event) => { void store.updateSettings({ crmApiToken: event.target.value }); setCrmTestState(event.target.value && store.settings.crmWebhookUrl ? 'filled' : 'blank'); }} placeholder="cccrm_…" autoComplete="off" dir="ltr" /></Field>
            <div className="inline-actions"><Button variant="secondary" busy={crmTestState === 'loading'} disabled={!store.settings.crmWebhookUrl || !store.settings.crmApiToken} onClick={() => void testCrm()}><Link2 size={16} />Test CRM connection</Button></div>
          </Card>

          <Card className="settings-section" id="notifications">
            <div className="settings-heading"><span><Bell /></span><div><h2>{t('reminders')}</h2><p>{t('remindersBody')}</p></div></div>
            <div className="setting-row"><div><strong>{t('taskReminders')}</strong><span>{t('taskRemindersBody')}</span></div><label className="switch"><input type="checkbox" checked={store.settings.remindersEnabled} onChange={async (event) => { if (event.target.checked && 'Notification' in window) await Notification.requestPermission(); await store.updateSettings({ remindersEnabled: event.target.checked }); }} /><span /></label></div>
            {installEvent && <div className="setting-row"><div><strong>{t('installApp')}</strong><span>{t('installBody')}</span></div><Button onClick={() => void installEvent.prompt()}><Download size={16} />{t('installApp')}</Button></div>}
          </Card>

          <Card className="settings-section" id="storage">
            <div className="settings-heading"><span><Database /></span><div><h2>{t('storageData')}</h2><p>{t('storageBody')}</p></div></div>
            <div className="setting-row"><div><strong>{t('loadDemo')}</strong><span>{t('demoBody')}</span></div><Button variant="secondary" onClick={() => void store.loadDemo()}>{t('loadDemo')}</Button></div>
            <div className="setting-row danger-setting"><div><strong>{t('clearLocalData')}</strong><span>{t('clearDataBody')}</span></div><Button variant="danger" onClick={() => { if (confirm(t('deleteConfirm'))) void store.clearData(); }}><Trash2 size={16} />{t('clearLocalData')}</Button></div>
          </Card>
        </div>
      </div>
    </div>
  );
}
