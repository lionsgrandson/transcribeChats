import { Bell, CheckCircle2, Cloud, Database, Download, Globe2, HardDrive, Languages, LogOut, RefreshCw, Server, Shield, Trash2, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { Button, Card, Field, PageSkeleton, SuccessBanner } from '../components/ui';
import type { LanguageMode, Locale } from '../domain/types';
import { useTranslation } from '../i18n/useTranslation';
import { currentUser, sendMagicLink, signOut, supabaseConfigured } from '../services/supabase';
import { useAppStore } from '../state/AppStore';

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>; }

export function SettingsPage() {
  const { t } = useTranslation();
  const store = useAppStore();
  const [email, setEmail] = useState('');
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent>();
  useEffect(() => { void currentUser().then(setUser); }, []);
  useEffect(() => {
    const handler = (event: Event) => { event.preventDefault(); setInstallEvent(event as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  if (store.loading) return <PageSkeleton />;
  const magicLink = async () => { setBusy(true); setMessage(''); try { await sendMagicLink(email); setMessage('Check your inbox for the secure sign-in link.'); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not send the link.'); } finally { setBusy(false); } };
  const doSync = async () => { setBusy(true); setMessage(''); try { await store.sync(); setMessage('Sync completed.'); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Sync failed.'); } finally { setBusy(false); } };
  return <div className="page page-settings">
    <header className="page-header"><div><span className="eyebrow"><Shield size={15} />{t('preferencesPrivacy')}</span><h1>{t('settings')}</h1><p>{t('settingsSubtitle')}</p></div></header>
    {message && <SuccessBanner>{message}</SuccessBanner>}
    <div className="settings-layout"><nav className="settings-nav"><a href="#language"><Languages />{t('languageAndDirection')}</a><a href="#processing"><Server />{t('processingSettings')}</a><a href="#sync"><Cloud />{t('cloudSync')}</a><a href="#notifications"><Bell />{t('notifications')}</a><a href="#storage"><Database />{t('storageData')}</a></nav><div className="settings-content">
      <Card className="settings-section" id="language"><div className="settings-heading"><span><Globe2 /></span><div><h2>{t('languageAndDirection')}</h2><p>{t('languageSectionBody')}</p></div></div><div className="setting-row"><div><strong>{t('interfaceLanguage')}</strong><span>{t('interfaceLanguageBody')}</span></div><select value={store.settings.locale} onChange={(event) => void store.updateSettings({ locale: event.target.value as Locale })}><option value="en">English</option><option value="he">עברית</option></select></div><div className="setting-row"><div><strong>{t('defaultTranscriptLanguage')}</strong><span>{t('autoLanguageBody')}</span></div><select value={store.settings.languageMode} onChange={(event) => void store.updateSettings({ languageMode: event.target.value as LanguageMode })}><option value="auto">{t('autoDetect')}</option><option value="en">{t('english')}</option><option value="he">{t('hebrew')}</option><option value="mixed">{t('mixed')}</option></select></div></Card>
      <Card className="settings-section" id="processing"><div className="settings-heading"><span><Server /></span><div><h2>{t('processingSettings')}</h2><p>{t('processingBody')}</p></div></div><div className="setting-row"><div><strong>{t('localWorker')}</strong><span className="worker-status">{store.workerReady === null ? t('checking') : store.workerReady ? <><CheckCircle2 />{t('readyLabel')}</> : t('unavailable')}</span></div><Button variant="secondary" onClick={() => void store.refreshWorker()}><RefreshCw size={16} />{t('check')}</Button></div><Field label={t('workerUrl')}><input value={store.settings.workerUrl} onChange={(event) => void store.updateSettings({ workerUrl: event.target.value })} dir="ltr" /></Field><p className="settings-note"><HardDrive />{t('modelCostNote')}</p></Card>
      <Card className="settings-section" id="sync"><div className="settings-heading"><span><Cloud /></span><div><h2>{t('cloudSync')}</h2><p>{t('cloudSyncBody')}</p></div></div>{supabaseConfigured ? user ? <div className="account-card"><span><User /></span><div><strong>{user.email}</strong><small>{t('signedIn')}</small></div><Button variant="secondary" onClick={() => void signOut().then(() => setUser(null))}><LogOut size={16} />{t('signOut')}</Button></div> : <div className="auth-form"><Field label={t('email')}><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" dir="ltr" /></Field><Button busy={busy} disabled={!email} onClick={() => void magicLink()}>{t('sendMagicLink')}</Button></div> : <div className="banner banner-neutral">{t('supabaseNotConfigured')}</div>}<div className="setting-row"><div><strong>{t('crossDeviceSync')}</strong><span>{store.settings.lastSyncAt ? new Date(store.settings.lastSyncAt).toLocaleString() : t('notSynced')}</span></div><Button busy={busy} disabled={!supabaseConfigured || !user} onClick={() => void doSync()}><RefreshCw size={16} />{t('syncNow')}</Button></div></Card>
      <Card className="settings-section" id="notifications"><div className="settings-heading"><span><Bell /></span><div><h2>{t('reminders')}</h2><p>{t('remindersBody')}</p></div></div><div className="setting-row"><div><strong>{t('taskReminders')}</strong><span>{t('taskRemindersBody')}</span></div><label className="switch"><input type="checkbox" checked={store.settings.remindersEnabled} onChange={async (event) => { if (event.target.checked && 'Notification' in window) await Notification.requestPermission(); await store.updateSettings({ remindersEnabled: event.target.checked }); }} /><span /></label></div>{installEvent && <div className="setting-row"><div><strong>{t('installApp')}</strong><span>{t('installBody')}</span></div><Button onClick={() => void installEvent.prompt()}><Download size={16} />{t('installApp')}</Button></div>}</Card>
      <Card className="settings-section" id="storage"><div className="settings-heading"><span><Database /></span><div><h2>{t('storageData')}</h2><p>{t('storageBody')}</p></div></div><div className="setting-row"><div><strong>{t('loadDemo')}</strong><span>{t('demoBody')}</span></div><Button variant="secondary" onClick={() => void store.loadDemo()}>{t('loadDemo')}</Button></div><div className="setting-row danger-setting"><div><strong>{t('clearLocalData')}</strong><span>{t('clearDataBody')}</span></div><Button variant="danger" onClick={() => { if (confirm(t('deleteConfirm'))) void store.clearData(); }}><Trash2 size={16} />{t('clearLocalData')}</Button></div></Card>
    </div></div>
  </div>;
}
