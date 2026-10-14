import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { useAppStore } from '../state/AppStore';
import { fetchCrmDirectory, validateCrmDestination } from '../services/crmTransfer';
import { Button, Card, Field } from './ui';

export function CrmSettings() {
  const store = useAppStore();
  const [mode, setMode] = useState(store.settings.crmConnectionMode || (store.settings.crmApiToken ? 'api' : 'browser'));
  const [url, setUrl] = useState(store.settings.crmBaseUrl || '');
  const [endpoint, setEndpoint] = useState(store.settings.crmWebhookUrl || '');
  const [token, setToken] = useState(store.settings.crmApiToken || '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true); setMessage('');
    try {
      validateCrmDestination(mode === 'api' ? endpoint : url, mode);
      const patch = { crmEnabled: true, crmProvider: 'codecrafter' as const, crmConnectionMode: mode, crmBaseUrl: url.trim(), crmWebhookUrl: mode === 'api' ? endpoint.trim() : '', crmApiToken: mode === 'api' ? token.trim() : '' };
      if (mode === 'api') await fetchCrmDirectory({ ...store.settings, ...patch });
      await store.updateSettings(patch);
      setMessage(mode === 'api' ? 'Authorized workspace connected. Choose a client and project when transferring tasks.' : 'Browser destination saved. Your CRM will ask you to sign in, review the project and save each import.');
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not connect.'); }
    finally { setBusy(false); }
  };
  return <Card className="settings-section" id="crm"><div className="settings-heading"><span><Link2 /></span><div><h2>CRM connection / חיבור CRM</h2><p>{store.settings.crmEnabled ? 'Connected to your configured CodeCrafter CRM' : 'Connect your own CodeCrafter CRM workspace'}</p></div></div>
    <div className="crm-connection-grid">
      <Field label="Connection method"><select value={mode} onChange={(event) => setMode(event.target.value as 'api' | 'browser')}><option value="browser">Browser import — confirm in CRM</option><option value="api">Workspace API — authenticated transfer</option></select></Field>
      {mode === 'browser' ? <Field label="Your CRM application URL" hint="The existing importTasks fragment flow preserves project selection and source-ID deduplication. No CRM token is needed."><input type="url" dir="ltr" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://your-crm.example.com/" /></Field> : <>
        <Field label="CodeCrafter inbound endpoint" hint="Copy the endpoint and generate a workspace token in CodeCrafter CRM Settings → Integrations. Admin or Manager permission is required there."><input type="url" dir="ltr" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://your-project.supabase.co/functions/v1/crm-ingest" /></Field>
        <Field label="Workspace API token"><input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} /></Field>
      </>}
      <p className="muted">The destination and credentials stay in this browser workspace and are excluded from cloud sync. Requests go directly to the verified CodeCrafter endpoint. Additional CRM providers require their own adapter.</p>
      {message && <p role="status">{message}</p>}
      <div className="inline-actions"><Button busy={busy} onClick={() => void connect()}>Connect / reconnect</Button><Button variant="secondary" disabled={busy || !store.settings.crmEnabled} onClick={() => {
        void store.updateSettings({ crmEnabled: false, crmApiToken: '', crmWebhookUrl: '', crmBaseUrl: '' }).then(() => { setToken(''); setEndpoint(''); setUrl(''); setMessage('CRM disconnected. Saved credentials removed from this workspace.'); }).catch((reason) => setMessage(String(reason)));
      }}>Disconnect</Button></div>
    </div>
  </Card>;
}
