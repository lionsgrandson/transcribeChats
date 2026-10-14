import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Check, Plus, Sparkles, X } from 'lucide-react';
import type { ExtractedItem, Transcription } from '../domain/types';
import { useAppStore } from '../state/AppStore';
import { cloudTranscription, hostedRuntime } from '../services/runtime';
import { createGeminiSummaryJob } from '../services/gemini';
import { exportCsv } from '../services/exports';
import { formatDate } from '../lib/format';
import { Button, Card, Field, StatusBadge } from './ui';
import { ChatGptModal } from './ChatGptModal';
import { CrmTaskTransfer } from './CrmTaskTransfer';

function Followup({ item }: { item: ExtractedItem }) {
  const store = useAppStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = async (patch: Partial<ExtractedItem>) => {
    setBusy(true); setError('');
    try { await store.updateItem(item.id, patch); setEditing(false); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const source = store.tSegments(item.transcriptionId).find((value) => item.sourceSegmentIds.includes(value.id));
  return <article className={`followup-card kind-${item.kind} is-${item.status}`}>
    <div className="followup-heading"><div>{editing ? <Field label="Item title"><input value={draft} onChange={(event) => setDraft(event.target.value)} dir="auto" /></Field> : <h3 dir="auto">{item.title}</h3>}
      <div className="item-meta"><span>{item.kind}</span><StatusBadge status={item.status} /><span>{Math.round(item.confidence * 100)}% confidence</span><span>{item.confirmed ? 'Confirmed by you' : 'Review suggestion'}</span>{item.assignee && <span>{item.assignee}</span>}{(item.dueAt || item.startsAt) && <span>{formatDate(item.dueAt || item.startsAt!)}</span>}</div>
    </div>{item.kind === 'task' && <CrmTaskTransfer tasks={[item]} />}</div>
    {item.body && <p dir="auto">{item.body}</p>}{item.uncertaintyReason && <p className="uncertainty" dir="auto">{item.uncertaintyReason}</p>}
    {source && <a className="followup-source" href={`#segment-${source.id}`} onClick={() => document.getElementById(`segment-${source.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{source.speakerLabel}: {source.text}</a>}
    <div className="workspace-actions">
      {editing ? <><Button disabled={!draft.trim() || busy} onClick={() => void update({ title: draft.trim() })}>Save</Button><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></> : <Button variant="ghost" onClick={() => { setDraft(item.title); setEditing(true); }}>Edit</Button>}
      {item.status === 'needs_review' && <Button disabled={busy} onClick={() => void update({ status: 'open', confirmed: true })}><Check size={15} />Accept</Button>}
      {item.kind === 'task' && item.status !== 'dismissed' && <Button variant="secondary" disabled={busy} onClick={() => void update({ status: item.status === 'completed' ? 'open' : 'completed', confirmed: true })}>{item.status === 'completed' ? 'Reopen' : 'Complete'}</Button>}
      {item.status !== 'dismissed' && <Button variant="ghost" disabled={busy} onClick={() => void update({ status: 'dismissed' })}><X size={15} />Dismiss</Button>}
    </div>{error && <p role="alert">{error}</p>}
  </article>;
}

export function MeetingFollowups({ transcription }: { transcription: Transcription }) {
  const store = useAppStore();
  const he = store.settings.locale === 'he';
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ExtractedItem['kind']>('task');
  const [note, setNote] = useState('');
  const items = store.tItems(transcription.id).filter((item) => !item.tags.includes('sales-intelligence'));
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The action failed.'); }
    finally { setBusy(false); }
  };
  const gemini = async () => {
    const jobId = crypto.randomUUID();
    await store.updateTranscription(transcription.id, { summaryJobId: jobId, summaryJobStatus: 'queued', summaryJobMode: 'meeting', summaryJobError: undefined, summaryNextRetryAt: undefined });
    await createGeminiSummaryJob(transcription, store.tSegments(transcription.id), jobId, 'meeting');
  };
  return <Card className="meeting-followups" id="followups"><div className="section-heading"><div><h2>{he ? 'משימות והמשך פגישה' : 'Meeting follow-ups'}</h2><p>{he ? 'בדקו הצעות מול המקור לפני אישור.' : 'Review suggestions against their source before accepting them.'}</p></div><Link to="/tasks">{he ? 'כל המשימות' : 'All tasks'} →</Link></div>
    {error && <p role="alert" className="banner banner-error">{error}</p>}
    <div className="workspace-actions">
      <Button variant="secondary" busy={busy} onClick={() => void run(() => store.runAnalysis(transcription.id))}>{he ? 'חילוץ מפורש ללא AI' : 'Extract explicit follow-ups'}</Button>
      {!hostedRuntime && !cloudTranscription && <Button variant="secondary" disabled={busy} onClick={() => void run(() => store.runOllamaAnalysis(transcription.id))}><Bot size={16} />Analyze with Ollama</Button>}
      {(cloudTranscription || import.meta.env.VITE_AI_API_URL) && <Button disabled={busy || Boolean(transcription.summaryJobId && !['ready', 'failed'].includes(transcription.summaryJobStatus || 'queued'))} onClick={() => void run(gemini)}><Sparkles size={16} />{he ? 'ניתוח פגישה עם Gemini' : 'Analyze meeting with Gemini'}</Button>}
      <Button variant="secondary" onClick={() => setChatOpen(true)}>ChatGPT export / import</Button><Button variant="ghost" onClick={() => exportCsv(transcription, items)}>CSV</Button>
      <Button variant="secondary" onClick={() => setAdding(!adding)}><Plus size={16} />{he ? 'הוספת פריט' : 'Add item'}</Button>
    </div>
    {adding && <form className="workspace-actions" onSubmit={(event) => { event.preventDefault(); void run(async () => { await store.addItem(transcription.id, { kind, title: title.trim(), confirmed: true }); setTitle(''); setAdding(false); }); }}>
      <Field label="Item type"><select value={kind} onChange={(event) => setKind(event.target.value as ExtractedItem['kind'])}><option value="task">Task</option><option value="event">Event</option><option value="note">Note</option><option value="takeaway">Decision / takeaway</option></select></Field>
      <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} dir="auto" required /></Field><Button type="submit" disabled={busy || !title.trim()}>Save item</Button>
    </form>}
    <div className="followup-toolbar"><label>{he ? 'סינון' : 'Filter'} <select aria-label="Follow-up filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All active items</option><option value="task">Tasks</option><option value="event">Events</option><option value="note">Notes</option><option value="takeaway">Decisions & takeaways</option><option value="dismissed">Dismissed</option></select></label></div>
    <div className="followup-list">{items.filter((item) => filter === 'dismissed' ? item.status === 'dismissed' : item.status !== 'dismissed' && (filter === 'all' || item.kind === filter)).map((item) => <Followup key={item.id} item={item} />)}</div>
    {!items.length && <p className="muted">{he ? 'עדיין אין פריטים. הוסיפו פריט או בחרו כלי ניתוח.' : 'No follow-ups yet. Add an item or choose an analysis tool.'}</p>}
    <h3>{he ? 'הערות אישיות' : 'Personal notes'}</h3>{store.tNotes(transcription.id).map((value) => <p key={value.id} dir="auto">{value.body}</p>)}
    <form className="workspace-actions" onSubmit={(event) => { event.preventDefault(); void run(async () => { await store.addNote(transcription.id, note.trim()); setNote(''); }); }}><Field label={he ? 'הערה חדשה' : 'New note'}><textarea value={note} onChange={(event) => setNote(event.target.value)} dir="auto" /></Field><Button type="submit" disabled={!note.trim() || busy}>Save note</Button></form>
    <ChatGptModal open={chatOpen} onClose={() => setChatOpen(false)} transcription={transcription} segments={store.tSegments(transcription.id)} items={items} onImport={(values) => store.importItems(transcription.id, values)} />
  </Card>;
}
