import { AlertTriangle, ArrowLeft, Bot, CalendarDays, Check, CheckCircle2, Clock, Download, Edit3, FileText, ListChecks, LoaderCircle, MessageSquareText, Play, Plus, RotateCcw, Save, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChatGptModal } from '../components/ChatGptModal';
import { Button, Card, EmptyState, ErrorState, Field, PageSkeleton, StatusBadge } from '../components/ui';
import { db } from '../data/db';
import type { AnalysisResult, ExtractedItem, Transcription, TranscriptSegment } from '../domain/types';
import { useTranslation } from '../i18n/useTranslation';
import { formatDate, formatDuration, formatTimestamp, inferDirection } from '../lib/format';
import { exportCsv, exportText, printPdf } from '../services/exports';
import { useAppStore } from '../state/AppStore';

function EditableSegment({ segment, onSave, onPlay, highlighted }: { segment: TranscriptSegment; onSave: (text: string, speaker: string) => Promise<void>; onPlay: () => void; highlighted: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(segment.text);
  const [speaker, setSpeaker] = useState(segment.speakerLabel);
  return <article className={`segment-row ${highlighted ? 'is-source-highlight' : ''}`} id={`segment-${segment.id}`}>
    <button className="timestamp-button" title="Play from this timestamp" onClick={onPlay}><Play size={13} />{formatTimestamp(segment.startMs)}</button>
    <div className="segment-content">
      {editing ? <><input className="speaker-input" value={speaker} onChange={(event) => setSpeaker(event.target.value)} /><textarea value={text} onChange={(event) => setText(event.target.value)} dir="auto" /><div className="inline-actions"><Button onClick={() => void onSave(text, speaker).then(() => setEditing(false))}><Check size={15} />{t('save')}</Button><Button variant="ghost" onClick={() => { setText(segment.text); setSpeaker(segment.speakerLabel); setEditing(false); }}><X size={15} />{t('cancel')}</Button></div></> : <><div className="speaker-line"><strong>{segment.speakerLabel}</strong>{segment.edited && <span>{t('edited')}</span>}<button className="icon-button compact" onClick={() => setEditing(true)} aria-label={t('editSegment')}><Edit3 size={15} /></button></div><p dir={inferDirection(segment.text)}>{segment.text}</p></>}
    </div>
  </article>;
}

function ItemRow({ item, onUpdate, onDelete, onSource }: { item: ExtractedItem; onUpdate: (patch: Partial<ExtractedItem>) => Promise<void>; onDelete: () => Promise<void>; onSource: (segmentId: string) => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [kind, setKind] = useState(item.kind);
  const [date, setDate] = useState((item.kind === 'event' ? item.startsAt : item.dueAt)?.slice(0, 16) || '');
  const kindLabel = item.kind === 'task' ? t('taskSingular') : item.kind === 'event' ? t('eventSingular') : item.kind === 'note' ? t('noteSingular') : item.kind === 'takeaway' ? t('takeawaySingular') : t('summary');
  const priorityLabel = item.priority === 'low' ? t('low') : item.priority === 'medium' ? t('medium') : item.priority === 'high' ? t('high') : item.priority === 'urgent' ? t('urgent') : '';
  const save = async () => {
    if (!title.trim()) return;
    const timestamp = date ? new Date(date).toISOString() : undefined;
    await onUpdate({ title: title.trim(), kind, startsAt: kind === 'event' ? timestamp : undefined, dueAt: kind === 'task' ? timestamp : undefined });
    setEditing(false);
  };
  return <div className={`item-row ${item.status === 'completed' ? 'is-completed' : ''}`}>
    {item.kind === 'task' ? <button className={`task-checkbox ${item.status === 'completed' ? 'checked' : ''}`} onClick={() => void onUpdate({ status: item.status === 'completed' ? 'open' : 'completed', confirmed: true })} aria-label={item.status === 'completed' ? t('reopen') : t('complete')}>{item.status === 'completed' && <Check size={15} />}</button> : <span className={`kind-dot kind-${item.kind}`} />}
    <div className="item-main">{editing ? <div className="item-edit-grid"><input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Item title" dir="auto" /><select value={kind} onChange={(event) => setKind(event.target.value as 'task' | 'event')} aria-label="Item type"><option value="task">{t('taskSingular')}</option><option value="event">{t('eventSingular')}</option></select><input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} aria-label={kind === 'event' ? 'Event date and time' : 'Due date'} /></div> : <><strong dir="auto">{item.title}</strong><div className="item-meta"><span>{kindLabel}</span>{item.assignee && <span>{item.assignee}</span>}{item.dueAt && <span><Clock size={13} />{formatDate(item.dueAt, 'MMM d, HH:mm')}</span>}{item.startsAt && <span><CalendarDays size={13} />{formatDate(item.startsAt, 'MMM d, HH:mm')}</span>}{item.priority !== 'none' && <span className={`priority priority-${item.priority}`}>{priorityLabel}</span>}</div>{item.uncertaintyReason && <span className="uncertainty"><AlertTriangle size={13} />{item.uncertaintyReason}</span>}</>}</div>
    {item.status === 'needs_review' && <div className="review-actions"><Button onClick={() => void onUpdate({ status: 'open', confirmed: true })}>{t('accept')}</Button><Button variant="ghost" onClick={() => void onUpdate({ status: 'dismissed' })}>{t('dismiss')}</Button></div>}
    <div className="item-actions">{editing ? <><button className="icon-button compact" onClick={() => void save()} aria-label={t('save')}><Save size={15} /></button><button className="icon-button compact" onClick={() => setEditing(false)} aria-label={t('cancel')}><X size={15} /></button></> : <button className="icon-button compact" onClick={() => setEditing(true)} aria-label={t('edit')}><Edit3 size={15} /></button>}<button className="icon-button compact danger-icon" onClick={() => { if (confirm(`Delete “${item.title}”?`)) void onDelete(); }} aria-label={t('delete')}><Trash2 size={15} /></button>{item.sourceSegmentIds[0] && <button className="evidence-link" onClick={() => onSource(item.sourceSegmentIds[0])}>{t('source')}</button>}</div>
  </div>;
}

function ProcessingStatus({ transcription }: { transcription: Transcription }) {
  const { t, locale } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const storedProgress = transcription.progress || 0;
  const elapsedMs = Math.max(0, now - new Date(transcription.updatedAt).getTime());
  const waitingForWorker = transcription.status === 'processing' && storedProgress >= 12 && storedProgress < 85;
  const displayProgress = waitingForWorker ? Math.min(82, Math.max(storedProgress, 18 + Math.floor(elapsedMs / 15_000))) : storedProgress;
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  const elapsedSeconds = Math.floor((elapsedMs % 60_000) / 1_000);
  const elapsedLabel = elapsedMinutes ? `${elapsedMinutes}m ${elapsedSeconds.toString().padStart(2, '0')}s` : `${elapsedSeconds}s`;
  const stage = waitingForWorker
    ? locale === 'he' ? 'תמלול מקומי באמצעות Whisper' : 'Transcribing locally with Whisper'
    : transcription.stage || t('preparation');
  const detail = locale === 'he'
    ? `זמן שחלף: ${elapsedLabel} · האחוז הוא הערכה בזמן שהמנוע המקומי עובד. אפשר לצאת מהעמוד; יש להשאיר את Docker פועל.`
    : `Elapsed ${elapsedLabel} · progress is estimated while the local engine works. You may leave this page; keep Docker running.`;
  const progressLabel = locale === 'he' ? `כ־${displayProgress}%` : `about ${displayProgress}%`;

  return <Card className="processing-card">
    <div className="processing-orbit"><Sparkles /></div>
    <div>
      <h2>{t('processing')}</h2>
      <p>{stage} · {progressLabel}</p>
      <div className={`progress-track ${waitingForWorker ? 'progress-estimated' : ''}`} aria-label={`${stage}, about ${displayProgress}%`}><span style={{ width: `${displayProgress}%` }} /></div>
      <small>{detail}</small>
    </div>
  </Card>;
}

export function TranscriptionDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const store = useAppStore();
  const [chatOpen, setChatOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [note, setNote] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [ollamaError, setOllamaError] = useState('');
  const [ollamaResult, setOllamaResult] = useState<AnalysisResult>();
  const playerRef = useRef<HTMLAudioElement>(null);
  const tab = params.get('tab') || 'transcript';
  const sourceSegmentId = params.get('segment') || '';
  useEffect(() => {
    let objectUrl = '';
    void db.media.where('transcriptionId').equals(id).first().then((media) => {
      if (!media) return;
      objectUrl = URL.createObjectURL(media.blob);
      setMediaUrl(objectUrl);
    });
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id]);
  useEffect(() => {
    if (tab !== 'transcript' || !sourceSegmentId) return;
    const timer = window.setTimeout(() => document.getElementById(`segment-${sourceSegmentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    return () => window.clearTimeout(timer);
  }, [sourceSegmentId, tab]);
  if (store.loading) return <PageSkeleton />;
  const transcription = store.transcriptions.find((value) => value.id === id);
  if (!transcription) return <div className="page"><ErrorState title="Transcription not found" action={<Button onClick={() => navigate('/history')}>{t('history')}</Button>} /></div>;
  const segments = store.tSegments(id);
  const items = store.tItems(id);
  const notes = store.tNotes(id);
  const setTab = (value: string) => setParams({ tab: value });
  const showSource = (segmentId: string) => setParams({ tab: 'transcript', segment: segmentId });
  const playFrom = (startMs: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.currentTime = startMs / 1000;
    void player.play().catch(() => store.showToast('Playback could not start. Use the media controls and try again.'));
  };
  const analyzeWithOllama = async () => {
    setOllamaBusy(true); setOllamaError(''); setOllamaResult(undefined);
    try {
      const result = await store.runOllamaAnalysis(id);
      setOllamaResult(result);
      setTab('summary');
    }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Ollama analysis failed.';
      setOllamaError(message);
      store.showToast(message);
    }
    finally { setOllamaBusy(false); }
  };
  const deleteRecord = async () => { if (confirm(t('deleteConfirm'))) { await store.deleteTranscription(id); navigate('/history'); } };
  const tabs = [{ id: 'transcript', label: t('transcript'), icon: FileText }, { id: 'tasks', label: t('tasks'), icon: ListChecks }, { id: 'timeline', label: t('timeline'), icon: CalendarDays }, { id: 'summary', label: t('summary'), icon: Sparkles }, { id: 'notes', label: t('notes'), icon: MessageSquareText }];

  return <div className="page detail-page">
    <Link className="back-link" to="/history"><ArrowLeft size={16} />{t('back')} {t('history').toLowerCase()}</Link>
    <header className="detail-header">
      <div><div className="title-line"><h1 dir="auto">{transcription.title}</h1><StatusBadge status={transcription.status} /></div><div className="detail-meta"><span>{formatDate(transcription.recordedAt, 'MMM d, yyyy · HH:mm')}</span><span>{formatDuration(transcription.durationMs)}</span><span>{transcription.detectedLanguages.join(' + ') || transcription.languageMode}</span><span>{transcription.synced ? t('synced') : t('savedLocally')}</span></div></div>
      <div className="header-actions"><Button variant="secondary" onClick={() => setChatOpen(true)}><Sparkles size={17} />{t('openInChatGPT')}</Button><Button variant="secondary" busy={ollamaBusy} disabled={!segments.length} onClick={() => void analyzeWithOllama()}><Bot size={17} />{ollamaBusy ? 'Analyzing with Ollama…' : 'Analyze with Ollama'}</Button><div className="menu-wrap"><Button variant="secondary" onClick={() => setExportOpen((value) => !value)}><Download size={17} />{t('export')}</Button>{exportOpen && <div className="action-menu"><button onClick={() => { exportText(transcription, segments, items); setExportOpen(false); }}>{t('exportText')}</button><button onClick={() => { exportCsv(transcription, items); setExportOpen(false); }}>{t('exportCsv')}</button><button onClick={() => { printPdf(transcription, segments, items); setExportOpen(false); }}>{t('exportPdf')}</button></div>}</div><button className="icon-button" title={t('delete')} onClick={() => void deleteRecord()}><Trash2 /></button></div>
    </header>

    {ollamaBusy && <div className="banner banner-neutral ollama-banner" role="status"><LoaderCircle className="spin" /><div><strong>Ollama is analyzing the full transcript</strong><span>Creating the summary, explicit tasks, meeting events, important notes, and dated timeline. Large transcripts can take a few minutes.</span></div></div>}
    {ollamaError && <div className="banner banner-error ollama-banner" role="alert"><AlertTriangle /><div><strong>Ollama analysis failed</strong><span>{ollamaError}</span></div><Button variant="secondary" onClick={() => void analyzeWithOllama()}><RotateCcw size={15} />Retry</Button></div>}
    {ollamaResult && !ollamaBusy && <div className="banner banner-success ollama-banner" role="status"><CheckCircle2 /><div><strong>Ollama analysis is ready</strong><span>{ollamaResult.items.filter((item) => item.kind === 'task').length} tasks · {ollamaResult.items.filter((item) => item.kind === 'event').length} events · {ollamaResult.items.filter((item) => item.kind === 'note' || item.kind === 'takeaway').length} notes/takeaways. Review items before accepting them.</span></div><div className="ollama-result-actions"><Button variant="secondary" onClick={() => setTab('summary')}>Summary</Button><Button variant="secondary" onClick={() => setTab('tasks')}>Tasks & events</Button><Button variant="secondary" onClick={() => setTab('timeline')}>Timeline</Button></div></div>}

    {transcription.status === 'processing' || transcription.status === 'queued' ? <ProcessingStatus transcription={transcription} /> : null}
    {transcription.status === 'failed' && <div className="banner banner-error"><AlertTriangle /><div><strong>{t('failed')}</strong><span>{transcription.error || t('workerUnavailable')}</span></div><Button variant="secondary" onClick={() => void store.retryTranscription(id)}><RotateCcw size={16} />{t('retry')}</Button></div>}

    <div className="detail-tabs" role="tablist">{tabs.map(({ id: value, label, icon: Icon }) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}><Icon size={17} />{label}{value === 'tasks' && items.filter((item) => item.status === 'needs_review').length > 0 && <span className="tab-count">{items.filter((item) => item.status === 'needs_review').length}</span>}</button>)}</div>

    <Card className="detail-content">
      {tab === 'transcript' && (segments.length ? <div className="transcript-view"><div className="transcript-toolbar"><div><strong>{segments.length} segments</strong><span>{new Set(segments.map((segment) => segment.speakerLabel)).size} {t('speakers').toLowerCase()}</span></div>{mediaUrl && <audio className="media-player" ref={playerRef} src={mediaUrl} controls preload="metadata" />}</div>{segments.map((segment) => <EditableSegment key={segment.id} segment={segment} highlighted={segment.id === sourceSegmentId} onPlay={() => playFrom(segment.startMs)} onSave={(text, speaker) => store.updateSegment(segment.id, text, speaker)} />)}</div> : <EmptyState title="Transcript not available yet" body={transcription.status === 'failed' ? 'Retry processing when the local worker is running.' : 'Segments will appear here while processing completes.'} />)}
      {tab === 'tasks' && <div><div className="section-heading"><div><h2>{t('tasks')} & {t('events')}</h2><p>Only explicit commitments and meeting proposals appear here. Nothing reaches the calendar until you accept it and add a date.</p></div><Button variant="secondary" onClick={() => void store.addItem(id, { kind: 'task', title: t('addTask') })}><Plus size={16} />{t('addTask')}</Button></div>{items.filter((item) => item.kind === 'task' || item.kind === 'event').length ? <div className="item-list">{items.filter((item) => item.kind === 'task' || item.kind === 'event').map((item) => <ItemRow key={item.id} item={item} onUpdate={(patch) => store.updateItem(item.id, patch)} onDelete={() => store.deleteItem(item.id)} onSource={showSource} />)}</div> : <EmptyState title={t('noTasks')} body="No explicit commitments or meeting proposals were found. Add one manually or send the transcript to Ollama." />}</div>}
      {tab === 'timeline' && <div><div className="section-heading"><div><h2>{t('timeline')}</h2><p>{t('timelineSubtitle')}</p></div></div>{items.filter((item) => item.startsAt || item.dueAt).length ? <div className="timeline-list">{items.filter((item) => item.startsAt || item.dueAt).sort((a, b) => new Date(a.startsAt || a.dueAt!).getTime() - new Date(b.startsAt || b.dueAt!).getTime()).map((item) => <div className="timeline-row" key={item.id}><time>{formatDate(item.startsAt || item.dueAt!, 'MMM d')}<small>{formatDate(item.startsAt || item.dueAt!, 'HH:mm')}</small></time><span /><div><strong dir="auto">{item.title}</strong><p>{item.kind}{item.assignee ? ` · ${item.assignee}` : ''}</p></div></div>)}</div> : <EmptyState title={t('noEvents')} body={t('noEventsBody')} />}</div>}
      {tab === 'summary' && <div className="summary-view">{transcription.summary ? <><div className="summary-hero"><span><Sparkles /></span><div><h2>{t('summary')}</h2><p dir="auto">{transcription.summary}</p></div></div><h3>{t('keyTakeaways')}</h3><div className="takeaway-grid">{items.filter((item) => item.kind === 'takeaway' || item.kind === 'note').map((item) => <div className="takeaway-card" key={item.id}><CheckCircle2 /><span dir="auto">{item.title}</span></div>)}</div><Button variant="secondary" onClick={() => void store.runAnalysis(id)}><RotateCcw size={16} />{t('rerunAnalysis')}</Button></> : <EmptyState title={t('emptySummary')} body={t('runAnalysisBody')} action={<Button onClick={() => void store.runAnalysis(id)}>{t('runAnalysis')}</Button>} />}</div>}
      {tab === 'notes' && <div><div className="section-heading"><div><h2>{t('notes')}</h2><p>{t('notesSubtitle')}</p></div></div><div className="note-composer"><Field label={t('addNote')}><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('notePlaceholder')} dir="auto" /></Field><Button disabled={!note.trim()} onClick={() => void store.addNote(id, note).then(() => setNote(''))}><Plus size={16} />{t('addNote')}</Button></div>{notes.length ? <div className="notes-list">{notes.map((value) => <article key={value.id}><p dir="auto">{value.body}</p><small>{formatDate(value.createdAt, 'MMM d, HH:mm')}</small></article>)}</div> : <EmptyState title={t('noNotes')} body={t('notesEmptyBody')} />}</div>}
    </Card>
    <ChatGptModal open={chatOpen} onClose={() => setChatOpen(false)} transcription={transcription} segments={segments} items={items} onImport={(values) => store.importItems(id, values)} />
  </div>;
}
