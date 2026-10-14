import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ExtractedItem } from '../domain/types';
import { browserCrmMode, crmTransferMessage, sendTasksToCrm, toCrmTask, type CrmDestination } from '../services/crmTransfer';
import { useAppStore } from '../state/AppStore';
import { CrmDestinationModal } from './CrmDestinationModal';
import { Button } from './ui';

export function CrmTaskTransfer({ tasks }: { tasks: ExtractedItem[] }) {
  const store = useAppStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const eligible = tasks.filter((item) => item.kind === 'task' && !['completed', 'dismissed'].includes(item.status));
  const transfer = async (destination: CrmDestination = {}) => {
    setBusy(true); setMessage('');
    try {
      const payload = eligible.map((item) => toCrmTask(item, store.transcriptions.find((value) => value.id === item.transcriptionId)?.title || 'Transcript'));
      const result = await sendTasksToCrm(payload, store.settings, destination);
      setMessage(crmTransferMessage(result)); setOpen(false);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'CRM transfer failed.'); }
    finally { setBusy(false); }
  };
  return <div><Button variant="secondary" busy={busy} disabled={!eligible.length} onClick={() => {
    if (!store.settings.crmEnabled) return setMessage('Connect your own CRM in Settings first.');
    if (browserCrmMode(store.settings)) void transfer(); else setOpen(true);
  }}><ExternalLink size={16} />{store.settings.locale === 'he' ? 'שליחה ל-CRM' : 'Send to CRM'}</Button>
    {message && <p role="status" className="muted">{message}</p>}
    <CrmDestinationModal open={open} onClose={() => setOpen(false)} settings={store.settings} busy={busy} onSubmit={transfer} />
  </div>;
}
