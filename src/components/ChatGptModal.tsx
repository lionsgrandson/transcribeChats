import { Clipboard, ExternalLink, Import, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ExtractedItem, TranscriptSegment, Transcription } from '../domain/types';
import { useTranslation } from '../i18n/useTranslation';
import { formatTimestamp } from '../lib/format';
import { previewImport } from '../services/importer';
import { Button, Field, Modal } from './ui';

export function ChatGptModal({ open, onClose, transcription, segments, items, onImport }: { open: boolean; onClose: () => void; transcription: Transcription; segments: TranscriptSegment[]; items: ExtractedItem[]; onImport: (values: ReturnType<typeof previewImport>['valid']) => Promise<void> }) {
  const { t } = useTranslation();
  const [view, setView] = useState<'send' | 'import'>('send');
  const [withPrompt, setWithPrompt] = useState(true);
  const [raw, setRaw] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof previewImport>>();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const transcript = useMemo(() => segments.map((segment) => `[segment_id=${segment.id} start=${formatTimestamp(segment.startMs)} end=${formatTimestamp(segment.endMs)} start_ms=${segment.startMs}] ${segment.speakerLabel}: ${segment.text}`).join('\n'), [segments]);
  const taskPrompt = `\n\nAnalyze this transcript into JSON using exactly this shape:\n{"items":[{"kind":"task|event|note|takeaway","title":"...","body":"...","status":"needs_review","priority":"none|low|medium|high|urgent","assignee":null,"startsAt":null,"endsAt":null,"dueAt":null,"reminderAt":null,"tags":[],"sourceSegmentIds":["exact-segment-id"],"confidence":0.0,"uncertaintyReason":null,"confirmed":false}]}\nConversation date: ${transcription.recordedAt}. Return every distinct useful topic, not only calendar events. A task requires an unambiguous first-person commitment such as "I will send it" or a direct request/command such as "please send it". A third-person future statement such as "Dana will be offline" is a note unless the transcript explicitly records an accepted assignment. Facts, family plans, transportation details, anniversaries, birthdays, status updates, availability, blockers, risks, preferences, and useful reminders are notes, not tasks. Preserve the exact segment_id in sourceSegmentIds for every item so the app can jump to and play the source timestamp. Do not invent an assignee or date. Every date field must be either an exact ISO 8601 value or null; never place words such as "tomorrow" or "next weekend" in a date field. Return multiple sourced notes when the transcript covers multiple useful topics. Return only a fenced JSON object.`;
  const payload = `${transcription.title}\n${transcript}${withPrompt ? taskPrompt : ''}`;
  const copyAndOpen = async () => {
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
  };
  const commit = async () => {
    if (!preview?.valid.length) return;
    setBusy(true);
    try { await onImport(preview.valid); onClose(); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title={t('chatGptTitle')} wide>
    <div className="modal-tabs"><button className={view === 'send' ? 'active' : ''} onClick={() => setView('send')}><ExternalLink size={17} />{t('send')}</button><button className={view === 'import' ? 'active' : ''} onClick={() => setView('import')}><Import size={17} />{t('importOutput')}</button></div>
    {view === 'send' ? <div className="chatgpt-flow">
      <div className="privacy-card"><ShieldCheck /><div><strong>{t('privateContentCheck')}</strong><p>{t('privacyNotice')}</p></div></div>
      <div className="segmented-control"><button className={!withPrompt ? 'active' : ''} onClick={() => setWithPrompt(false)}>{t('transcriptOnly')}</button><button className={withPrompt ? 'active' : ''} onClick={() => setWithPrompt(true)}>{t('transcriptAndPrompt')}</button></div>
      <Field label="Payload preview" hint={`${payload.length.toLocaleString()} characters`}><textarea value={payload} readOnly dir="auto" className="payload-preview" /></Field>
      {copied && <div className="banner banner-success">{t('copied')}</div>}
      <div className="form-actions"><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button onClick={() => void copyAndOpen()}><Clipboard size={17} />{t('copyAndOpen')}</Button></div>
    </div> : <div className="import-flow">
      <p className="muted">{t('reviewBeforeAdding')}</p>
      <Field label={t('pasteJson')}><textarea className="payload-preview" value={raw} onChange={(event) => { setRaw(event.target.value); setPreview(undefined); }} placeholder={'```json\n{"items": [...]}\n```'} dir="auto" /></Field>
      <Button variant="secondary" onClick={() => setPreview(previewImport(raw, items))}>{t('previewImport')}</Button>
      {preview && <div className="import-preview">
        <div className="import-counts"><span className="status-badge status-ready">{preview.valid.length} valid</span><span className="status-badge status-failed">{preview.invalid.length} invalid</span><span className="status-badge status-needs-review">{preview.duplicates.length} duplicates</span></div>
        {preview.valid.map((item, index) => <div className="import-row" key={`${item.title}-${index}`}><span className={`kind-dot kind-${item.kind}`} /><div><strong dir="auto">{item.title}</strong><span>{item.kind} · {item.priority}</span></div></div>)}
        {preview.invalid.map((value) => <div className="inline-error" key={value}>{value}</div>)}
        {preview.duplicates.map((value) => <div className="inline-warning" key={value}>{t('duplicateItems')}: {value}</div>)}
      </div>}
      <div className="form-actions"><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button><Button busy={busy} disabled={!preview?.valid.length} onClick={() => void commit()}>{t('importSelected')}</Button></div>
    </div>}
  </Modal>;
}
