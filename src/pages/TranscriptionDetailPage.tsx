import { AlertTriangle, ArrowLeft, Bot, CalendarDays, Check, CheckCircle2, Clock, Download, Edit3, ExternalLink, FileText, ListChecks, LoaderCircle, MessageSquareText, Play, Plus, RotateCcw, Save, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChatGptModal } from '../components/ChatGptModal';
import { CrmDestinationModal } from '../components/CrmDestinationModal';
import { Button, Card, EmptyState, ErrorState, Field, PageSkeleton, StatusBadge } from '../components/ui';
import { db } from '../data/db';
import type { AnalysisResult, ExtractedItem, Transcription, TranscriptSegment } from '../domain/types';
import { useTranslation } from '../i18n/useTranslation';
import { formatDate, formatDuration, formatTimestamp, inferDirection } from '../lib/format';
import { exportCsv, exportText, printPdf } from '../services/exports';
import { copyTaskToChatGpt, copyTasksToChatGpt } from '../services/taskChatGpt';
import { sendTasksToCrm, sendTranscriptionToCrm, toCrmTask, type CrmDestination } from '../services/crmTransfer';
import { useAppStore } from '../state/AppStore';

function EditableSegment({ segment, onSave, onPlay, highlighted }: { segment: TranscriptSegment; onSave: (text: string, speaker: string) => Promise<void>; onPlay: () => void; highlighted: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(segment.text);
  const [speaker, setSpeaker] = useState(segment.speakerLabel);
  return <article className={`segment-row ${highlighted ? 'is-source-highlight' : ''}`} id={`segment-${segment.id}`}>
    <button type="button" className="timestamp-button" title="Play from this timestamp" aria-label={`Play from ${formatTimestamp(segment.startMs)}`} onClick={onPlay}><Play size={13} />{formatTimestamp(segment.startMs)}</button>
    <div className="segment-content">
      {editing ? <><input className="speaker-input" value={speaker} onChange={(event) => setSpeaker(event.target.value)} aria-label="Speaker name" /><textarea value={text} onChange={(event) => setText(event.target.value)} dir="auto" /><div className="inline-actions"><Button onClick={() => void onSave(text, speaker).then(() => setEditing(false))}><Check size={15} />{t('save')}</Button><Button variant="ghost" onClick={() => { setText(segment.text); setSpeaker(segment.speakerLabel); setEditing(false); }}><X size={15} />{t('cancel')}</Button></div></> : <><div className="speaker-line"><strong>{segment.speakerLabel}</strong>{segment.edited && <span>{t('edited')}</span>}<button className="icon-button compact" onClick={() => setEditing(true)} aria-label={t('editSegment')}><Edit3 size={15} /></button></div><p dir={inferDirection(segment.text)}>{segment.text}</p></>}
    </div>
  </article>;
}

type CrmTransferState = 'idle' | 'loading' | 'success' | 'failure';

function ItemRow({ item, transcriptionTitle, selected, onSelect, onUpdate, onDelete, onSource, onPlaySource, onOpenChatGpt }: { item: ExtractedItem; transcriptionTitle: string; selected: boolean; onSelect: (selected: boolean) => void; onUpdate: (patch: Partial<ExtractedItem>) => Promise<void>; onDelete: () => Promise<void>; onSource: (segmentId: string) => void; onPlaySource: (segmentId: string) => void; onOpenChatGpt: () => Promise<void> }) {
  const { t } = useTranslation();
  const store = useAppStore();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [kind, setKind] = useState(item.kind);
  const [date, setDate] = useState((item.kind === 'event' ? item.startsAt : item.dueAt)?.slice(0, 16) || '');
  const [crmState, setCrmState] = useState<CrmTransferState>('idle');
  const kindLabel = item.kind === 'task' ? t('taskSingular') : item.kind === 'event' ? t('eventSingular') : item.kind === 'note' ? t('noteSingular') : item.kind === 'takeaway' ? t('takeawaySingular') : t('summary');
  const priorityLabel = item.priority === 'low' ? t('low') : item.priority === 'medium' ? t('medium') : item.priority === 'high' ? t('high') : item.priority === 'urgent' ? t('urgent') : '';
  const showBody = Boolean(item.body?.trim() && item.body.trim() !== item.title.trim());
  const save = async () => {
    if (!title.trim()) return;
    const timestamp = date && (kind === 'task' || kind === 'event') ? new Date(date).toISOString() : undefined;
    await onUpdate({ title: title.trim(), kind, startsAt: kind === 'event' ? timestamp : undefined, dueAt: kind === 'task' ? timestamp : undefined });
    setEditing(false);
  };
  const sendToCrm = async () => {
    if (item.status === 'completed' || item.status === 'dismissed') return;
    setCrmState('loading');
    try {
      await sendTasksToCrm([toCrmTask(item, transcriptionTitle)], store.settings);
      setCrmState('success');
      window.setTimeout(() => setCrmState('idle'), 3000);
    } catch {
      setCrmState('failure');
    }
  };
  return <div className={`item-row ${item.status === 'completed' ? 'is-completed' : ''}`}>
    {item.kind === 'task' && <input className="bulk-checkbox" type="checkbox" checked={selected} disabled={item.status === 'completed' || item.status === 'dismissed'} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select ${item.title}`} />}
    {item.kind === 'task' ? <button className={`task-checkbox ${item.status === 'completed' ? 'checked' : ''}`} onClick={() => void onUpdate({ status: item.status === 'completed' ? 'open' : 'completed', confirmed: true })} aria-label={item.status === 'completed' ? t('reopen') : t('complete')}>{item.status === 'completed' && <Check size={15} />}</button> : <span className={`kind-dot kind-${item.kind}`} />}
    <div className="item-main">{editing ? <div className="item-edit-grid"><input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Item title" dir="auto" /><select value={kind} onChange={(event) => setKind(event.target.value as ExtractedItem['kind'])} aria-label="Item type"><option value="task">{t('taskSingular')}</option><option value="event">{t('eventSingular')}</option><option value="note">{t('noteSingular')}</option><option value="takeaway">{t('takeawaySingular')}</option><option value="summary">{t('summary')}</option></select>{(kind === 'task' || kind === 'event') && <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} aria-label={kind === 'event' ? 'Event date and time' : 'Due date'} />}</div> : <><strong dir="auto">{item.title}</strong>{showBody && <p dir="auto" style={{ margin: 0, color: 'var(--muted)', fontSize: 12, lineHeight: 1.55 }}>{item.body}</p>}<div className="item-meta"><span>{kindLabel}</span>{item.assignee && <span>{item.assignee}</span>}{item.dueAt && <span><Clock size={13} />{formatDate(item.dueAt, 'MMM d, HH:mm')}</span>}{item.startsAt && <span><CalendarDays size={13} />{item.tags.includes('date-only') ? formatDate(item.startsAt, 'MMM d') : formatDate(item.startsAt, 'MMM d, HH:mm')}</span>}{item.priority !== 'none' && <span className={`priority priority-${item.priority}`}>{priorityLabel}</span>}</div>{item.uncertaintyReason && <span className="uncertainty"><AlertTriangle size={13} />{item.uncertaintyReason}</span>}</>}</div>
    {item.status === 'needs_review' && <div className="review-actions"><Button onClick={() => void onUpdate({ status: 'open', confirmed: true })}>{t('accept')}</Button><Button variant="ghost" onClick={() => void onUpdate({ status: 'dismissed' })}>{t('dismiss')}</Button></div>}
    <div className="item-actions">{item.kind === 'task' && <><button className="crm-transfer chatgpt-transfer" onClick={() => void onOpenChatGpt()} aria-label={`Open ${item.title} in ChatGPT`} title="Copy this task with its source context and open ChatGPT"><Sparkles size={14} /><span>ChatGPT</span></button><button className={`crm-transfer ${crmState}`} onClick={() => void sendToCrm()} disabled={crmState === 'loading' || item.status === 'completed' || item.status === 'dismissed'} aria-label={`Send ${item.title} to the selected CRM`} title={item.status === 'completed' ? 'Completed tasks are not sent to the CRM.' : item.status === 'dismissed' ? 'Dismissed tasks are not sent to the CRM.' : crmState === 'failure' ? 'CRM sync failed. Check Settings and retry.' : 'Send directly to the CRM selected in Settings'}>{crmState === 'loading' ? <LoaderCircle className="spin" size={14} /> : crmState === 'success' ? <Check size={14} /> : <ExternalLink size={14} />}<span>{crmState === 'success' ? 'CRM synced' : crmState === 'failure' ? 'Retry CRM' : 'Send to CRM'}</span></button></>}{editing ? <><button className="icon-button compact" onClick={() => void save()} aria-label={t('save')}><Save size={15} /></button><button className="icon-button compact" onClick={() => setEditing(false)} aria-label={t('cancel')}><X size={15} /></button></> : <button className="icon-button compact" onClick={() => setEditing(true)} aria-label={t('edit')}><Edit3 size={15} /></button>}<button className="icon-button compact danger-icon" onClick={() => { if (confirm(`Delete “${item.title}”?`)) void onDelete(); }} aria-label={t('delete')}><Trash2 size={15} /></button>{item.sourceSegmentIds[0] && <><button className="evidence-link" onClick={() => onSource(item.sourceSegmentIds[0])}>{t('source')}</button><button className="evidence-link" onClick={() => onPlaySource(item.sourceSegmentIds[0])}><Play size={12} />Play source</button></>}</div>
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
  const [crmPickerOpen, setCrmPickerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [note, setNote] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [playbackRate, setPlaybackRate] = useState(1);
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [ollamaError, setOllamaError] = useState('');
  const [ollamaResult, setOllamaResult] = useState<AnalysisResult>();
  const [salesBusy, setSalesBusy] = useState(false);
  const [salesError, setSalesError] = useState('');
  const [salesResult, setSalesResult] = useState<AnalysisResult>();
  const [crmWorkspaceState, setCrmWorkspaceState] = useState<CrmTransferState>('idle');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [completeBulkBusy, setCompleteBulkBusy] = useState(false);
  const [chatGptBulkBusy, setChatGptBulkBusy] = useState(false);
  const [crmTransferMode, setCrmTransferMode] = useState<'all' | 'selected'>('all');
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
  const salesItems = items.filter((item) => item.tags.includes('sales-intelligence'));
  const extractedNotes = items.filter((item) => (item.kind === 'note' || item.kind === 'takeaway' || item.kind === 'summary') && !item.tags.includes('sales-intelligence'));
  const selectableTasks = items.filter((item) => item.kind === 'task' && item.status !== 'completed' && item.status !== 'dismissed');
  const selectedTasks = selectableTasks.filter((item) => selectedTaskIds.has(item.id));
  const allSelectableTasksSelected = selectableTasks.length > 0 && selectableTasks.every((item) => selectedTaskIds.has(item.id));
  const setTab = (value: string) => setParams({ tab: value });
  const showSource = (segmentId: string) => setParams({ tab: 'transcript', segment: segmentId });
  const toggleSelectedTask = (taskId: string, selected: boolean) => setSelectedTaskIds((current) => {
    const next = new Set(current);
    if (selected) next.add(taskId); else next.delete(taskId);
    return next;
  });
  const updateDetailItem = async (itemId: string, patch: Partial<ExtractedItem>) => {
    if (patch.status === 'completed' || patch.status === 'dismissed') toggleSelectedTask(itemId, false);
    await store.updateItem(itemId, patch);
  };
  const completeSelectedTasks = async () => {
    const currentSelectedTasks = items.filter((item) => item.kind === 'task' && selectedTaskIds.has(item.id) && item.status !== 'completed' && item.status !== 'dismissed');
    if (!currentSelectedTasks.length) return store.showToast('Choose at least one unfinished task to mark as done.');
    setCompleteBulkBusy(true);
    try {
      await Promise.all(currentSelectedTasks.map((item) => store.updateItem(item.id, { status: 'completed', confirmed: true })));
      setSelectedTaskIds(new Set());
      store.showToast(`${currentSelectedTasks.length} task${currentSelectedTasks.length === 1 ? '' : 's'} marked as done.`);
    } catch (reason) {
      store.showToast(reason instanceof Error ? reason.message : 'Could not mark the selected tasks as done.');
    } finally {
      setCompleteBulkBusy(false);
    }
  };
  const openTaskInChatGpt = async (item: ExtractedItem) => {
    try {
      await copyTaskToChatGpt(item, transcription, segments);
      store.showToast('Task copied. Paste it into the ChatGPT tab that just opened.');
    } catch (reason) {
      store.showToast(reason instanceof Error ? reason.message : 'Could not open this task in ChatGPT.');
    }
  };
  const openSelectedTasksInChatGpt = async () => {
    const currentSelectedTasks = items.filter((item) => item.kind === 'task' && selectedTaskIds.has(item.id) && item.status !== 'completed' && item.status !== 'dismissed');
    if (!currentSelectedTasks.length) return store.showToast('Choose at least one unfinished task to send to ChatGPT.');
    setChatGptBulkBusy(true);
    try {
      await copyTasksToChatGpt(currentSelectedTasks.map((item) => ({ item, transcription, segments })));
      store.showToast(`${currentSelectedTasks.length} selected task${currentSelectedTasks.length === 1 ? '' : 's'} copied. Paste them into the ChatGPT tab that just opened.`);
    } catch (reason) {
      store.showToast(reason instanceof Error ? reason.message : 'Could not open the selected tasks in ChatGPT.');
    } finally {
      setChatGptBulkBusy(false);
    }
  };
  const playFrom = (startMs: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.playbackRate = playbackRate;
    player.currentTime = startMs / 1000;
    void player.play().catch(() => store.showToast('Playback could not start. Use the media controls and try again.'));
  };
  const playSource = (segmentId: string) => {
    const segment = segments.find((value) => value.id === segmentId);
    if (!segment) return store.showToast('The source segment is not available in this transcript.');
    showSource(segmentId);
    window.setTimeout(() => playFrom(segment.startMs), 120);
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

  const analyzeSales = async () => {
    setSalesBusy(true); setSalesError(''); setSalesResult(undefined);
    try {
      const result = await store.runSalesAnalysis(id);
      setSalesResult(result);
      setTab('sales');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Sales intelligence analysis failed.';
      setSalesError(message);
      store.showToast(message);
    } finally {
      setSalesBusy(false);
    }
  };
  const sendToCrm = async (destination: CrmDestination) => {
    setCrmWorkspaceState('loading');
    try {
      const currentSelectedTasks = items.filter((item) => item.kind === 'task' && selectedTaskIds.has(item.id) && item.status !== 'completed' && item.status !== 'dismissed');
      if (crmTransferMode === 'selected' && !currentSelectedTasks.length) throw new Error('Choose at least one unfinished task to send to the CRM.');
      const result = crmTransferMode === 'selected'
        ? await sendTasksToCrm(currentSelectedTasks.map((item) => toCrmTask(item, transcription.title)), store.settings, destination)
        : await sendTranscriptionToCrm(id, store.settings, destination);
      setCrmWorkspaceState('success');
      setCrmPickerOpen(false);
      if (crmTransferMode === 'selected') {
        setSelectedTaskIds(new Set());
        if (result.duplicate) store.showToast('These selected tasks were already synced to that CRM destination.');
        else store.showToast(`${result.tasksCreated ?? currentSelectedTasks.length} selected task${currentSelectedTasks.length === 1 ? '' : 's'} sent to the CRM. Completed tasks were excluded.`);
      } else if (result.duplicate) store.showToast('This transcription was already synced to that CRM destination.');
      else store.showToast(`${result.contactCreated ? 'Created client and synced' : 'Synced to client'} · ${result.tasksCreated ?? 0} tasks · ${result.eventsCreated ?? 0} events · summary, notes and timeline added to the client card.`);
      window.setTimeout(() => setCrmWorkspaceState('idle'), 4000);
    } catch (reason) {
      setCrmWorkspaceState('failure');
      const message = reason instanceof Error ? reason.message : 'Could not send the transcription to the CRM.';
      store.showToast(message);
      throw reason;
    }
  };
  const deleteRecord = async () => { if (confirm(t('deleteConfirm'))) { await store.deleteTranscription(id); navigate('/history'); } };
  const exportPdf = () => {
    try {
      printPdf(transcription, segments, items);
      store.showToast('PDF print window opened. Choose “Save as PDF” in the print dialog.');
    } catch (reason) {
      store.showToast(reason instanceof Error ? reason.message : 'Could not open the PDF print window.');
    }
  };
  const tabs = [{ id: 'transcript', label: t('transcript'), icon: FileText }, { id: 'tasks', label: t('tasks'), icon: ListChecks }, { id: 'timeline', label: t('timeline'), icon: CalendarDays }, { id: 'summary', label: t('summary'), icon: Sparkles }, { id: 'sales', label: 'Sales intelligence', icon: Bot }, { id: 'notes', label: t('notes'), icon: MessageSquareText }];

  return <div className="page detail-page">
    <Link className="back-link" to="/history"><ArrowLeft size={16} />{t('back')} {t('history').toLowerCase()}</Link>
    <header className="detail-header">
      <div><div className="title-line"><h1 dir="auto">{transcription.title}</h1><StatusBadge status={transcription.status} /></div><div className="detail-meta"><span>{formatDate(transcription.recordedAt, 'MMM d, yyyy · HH:mm')}</span><span>{formatDuration(transcription.durationMs)}</span><span>{transcription.detectedLanguages.join(' + ') || transcription.languageMode}</span><span>{transcription.synced ? t('synced') : t('savedLocally')}</span></div></div>
      <div className="header-actions"><Button busy={crmWorkspaceState === 'loading'} disabled={transcription.status !== 'ready'} onClick={() => { setCrmTransferMode('all'); setCrmPickerOpen(true); }}><ExternalLink size={17} />{crmWorkspaceState === 'success' && crmTransferMode === 'all' ? 'Sent to CRM' : 'Send all to CRM'}</Button><Button variant="secondary" onClick={() => setChatOpen(true)}><Sparkles size={17} />{t('openInChatGPT')}</Button><Button variant="secondary" busy={ollamaBusy} disabled={!segments.length} onClick={() => void analyzeWithOllama()}><Bot size={17} />{ollamaBusy ? 'Analyzing with Ollama…' : 'Analyze with Ollama'}</Button><Button variant="secondary" busy={salesBusy} disabled={!segments.length} onClick={() => void analyzeSales()}><Sparkles size={17} />{salesBusy ? 'Analyzing deal…' : 'Sales intelligence'}</Button><div className="menu-wrap"><Button variant="secondary" onClick={() => setExportOpen((value) => !value)}><Download size={17} />{t('export')}</Button>{exportOpen && <div className="action-menu"><button onClick={() => { exportText(transcription, segments, items); setExportOpen(false); }}>{t('exportText')}</button><button onClick={() => { exportCsv(transcription, items); setExportOpen(false); }}>{t('exportCsv')}</button><button onClick={() => { exportPdf(); setExportOpen(false); }}>{t('exportPdf')}</button></div>}</div><button className="icon-button" title={t('delete')} onClick={() => void deleteRecord()}><Trash2 /></button></div>
    </header>

    {ollamaBusy && <div className="banner banner-neutral ollama-banner" role="status"><LoaderCircle className="spin" /><div><strong>Ollama is analyzing the full transcript</strong><span>Creating the summary, strict action tasks, timeline events, company/topic notes, and a second evidence-check pass.</span></div></div>}
    {ollamaError && <div className="banner banner-error ollama-banner" role="alert"><AlertTriangle /><div><strong>Ollama analysis failed</strong><span>{ollamaError}</span></div><Button variant="secondary" onClick={() => void analyzeWithOllama()}><RotateCcw size={15} />Retry</Button></div>}
    {ollamaResult && !ollamaBusy && <div className="banner banner-success ollama-banner" role="status"><CheckCircle2 /><div><strong>Ollama analysis is ready</strong><span>{ollamaResult.items.filter((item) => item.kind === 'task').length} tasks · {ollamaResult.items.filter((item) => item.kind === 'event').length} events · {ollamaResult.items.filter((item) => item.kind === 'note' || item.kind === 'takeaway' || item.kind === 'summary').length} notes/takeaways. Review items before accepting them.</span></div><div className="ollama-result-actions"><Button variant="secondary" onClick={() => setTab('summary')}>Summary</Button><Button variant="secondary" onClick={() => setTab('tasks')}>Tasks & events</Button><Button variant="secondary" onClick={() => setTab('notes')}>Notes</Button><Button variant="secondary" onClick={() => setTab('timeline')}>Timeline</Button></div></div>}


    {salesBusy && <div className="banner banner-neutral ollama-banner" role="status"><LoaderCircle className="spin" /><div><strong>Analyzing sales signals</strong><span>Checking project budget evidence, decision authority, urgency, objections, buying signals, communication patterns and next questions, followed by an evidence-verification pass.</span></div></div>}
    {salesError && <div className="banner banner-error ollama-banner" role="alert"><AlertTriangle /><div><strong>Sales intelligence failed</strong><span>{salesError}</span></div><Button variant="secondary" onClick={() => void analyzeSales()}><RotateCcw size={15} />Retry</Button></div>}
    {salesResult && !salesBusy && <div className="banner banner-success ollama-banner" role="status"><CheckCircle2 /><div><strong>Sales intelligence is ready</strong><span>{salesResult.items.length} evidence-backed observations were saved to this meeting.</span></div><Button variant="secondary" onClick={() => setTab('sales')}>Open sales brief</Button></div>}

    {transcription.status === 'processing' || transcription.status === 'queued' ? <ProcessingStatus transcription={transcription} /> : null}
    {transcription.status === 'failed' && <div className="banner banner-error" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>{t('failed')}</strong><span>{transcription.error || t('workerUnavailable')}</span></div><Button variant="secondary" onClick={() => void store.retryTranscription(id)}><RotateCcw size={16} />{t('retry')}</Button></div>}

    <div className="detail-tabs" role="tablist" aria-label="Transcription sections">{tabs.map(({ id: value, label, icon: Icon }) => <button id={`transcription-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls="transcription-tabpanel" key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}><Icon size={17} />{label}{value === 'tasks' && items.filter((item) => (item.kind === 'task' || item.kind === 'event') && item.status === 'needs_review').length > 0 && <span className="tab-count">{items.filter((item) => (item.kind === 'task' || item.kind === 'event') && item.status === 'needs_review').length}</span>}</button>)}</div>

    <Card className="detail-content" id="transcription-tabpanel" role="tabpanel" aria-labelledby={`transcription-tab-${tab}`}>
      {tab === 'transcript' && (segments.length ? <div className="transcript-view"><div className="transcript-toolbar"><div><strong>{segments.length} segments</strong><span>{new Set(segments.map((segment) => segment.speakerLabel)).size} {t('speakers').toLowerCase()}</span></div>{mediaUrl && <div className="media-controls"><audio className="media-player" ref={playerRef} src={mediaUrl} controls preload="metadata" onLoadedMetadata={(event) => { event.currentTarget.playbackRate = playbackRate; }} /><label className="speed-control">Speed<select value={playbackRate} onChange={(event) => { const rate = Number(event.target.value); setPlaybackRate(rate); if (playerRef.current) playerRef.current.playbackRate = rate; }} aria-label="Playback speed"><option value={0.5}>0.5×</option><option value={0.75}>0.75×</option><option value={1}>1×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option><option value={2}>2×</option><option value={3}>3×</option><option value={4}>4×</option></select></label></div>}</div>{segments.map((segment) => <EditableSegment key={segment.id} segment={segment} highlighted={segment.id === sourceSegmentId} onPlay={() => playFrom(segment.startMs)} onSave={(text, speaker) => store.updateSegment(segment.id, text, speaker)} />)}</div> : <EmptyState title="Transcript not available yet" body={transcription.status === 'failed' ? 'Retry processing when the local worker is running.' : 'Segments will appear here while processing completes.'} />)}
      {tab === 'tasks' && <div>
        <div className="section-heading"><div><h2>{t('tasks')} & {t('events')}</h2><p>Tasks are explicit commitments or requests. Planned meetings and dated occurrences are events/timeline items, not tasks.</p></div><Button variant="secondary" onClick={() => void store.addItem(id, { kind: 'task', title: t('addTask') })}><Plus size={16} />{t('addTask')}</Button></div>
        {selectableTasks.length > 0 && <div className="bulk-toolbar">
          <label><input type="checkbox" checked={allSelectableTasksSelected} onChange={(event) => setSelectedTaskIds(event.target.checked ? new Set(selectableTasks.map((item) => item.id)) : new Set())} /> Select all available tasks</label>
          <span>{selectedTasks.length} selected</span>
          <Button variant="secondary" disabled={!selectedTasks.length || completeBulkBusy} onClick={() => void completeSelectedTasks()}>{completeBulkBusy ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}Mark selected done{selectedTasks.length ? ` (${selectedTasks.length})` : ''}</Button>
          <Button variant="secondary" disabled={!selectedTasks.length || chatGptBulkBusy} onClick={() => void openSelectedTasksInChatGpt()}>{chatGptBulkBusy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}Send selected to ChatGPT{selectedTasks.length ? ` (${selectedTasks.length})` : ''}</Button>
          <Button disabled={!selectedTasks.length || crmWorkspaceState === 'loading'} onClick={() => { setCrmTransferMode('selected'); setCrmPickerOpen(true); }}><ExternalLink size={15} />Send selected to CRM{selectedTasks.length ? ` (${selectedTasks.length})` : ''}</Button>
        </div>}
        {items.filter((item) => item.kind === 'task' || item.kind === 'event').length ? <div className="item-list">{items.filter((item) => item.kind === 'task' || item.kind === 'event').map((item) => <ItemRow key={item.id} item={item} transcriptionTitle={transcription.title} selected={selectedTaskIds.has(item.id)} onSelect={(value) => toggleSelectedTask(item.id, value)} onUpdate={(patch) => updateDetailItem(item.id, patch)} onDelete={async () => { toggleSelectedTask(item.id, false); await store.deleteItem(item.id); }} onSource={showSource} onPlaySource={playSource} onOpenChatGpt={() => openTaskInChatGpt(item)} />)}</div> : <EmptyState title={t('noTasks')} body="No explicit commitments, direct requests, or planned timeline events were found." />}
      </div>}
      {tab === 'timeline' && <div><div className="section-heading"><div><h2>{t('timeline')}</h2><p>{t('timelineSubtitle')}</p></div></div>{items.filter((item) => item.startsAt || item.dueAt).length ? <div className="timeline-list">{items.filter((item) => item.startsAt || item.dueAt).sort((a, b) => new Date(a.startsAt || a.dueAt!).getTime() - new Date(b.startsAt || b.dueAt!).getTime()).map((item) => <div className="timeline-row" key={item.id}><time>{formatDate(item.startsAt || item.dueAt!, 'MMM d')}<small>{item.tags.includes('date-only') ? 'Time not set' : formatDate(item.startsAt || item.dueAt!, 'HH:mm')}</small></time><span /><div><strong dir="auto">{item.title}</strong><p>{item.kind}{item.assignee ? ` · ${item.assignee}` : ''}</p></div></div>)}</div> : <EmptyState title={t('noEvents')} body={t('noEventsBody')} />}</div>}
      {tab === 'summary' && <div className="summary-view">{transcription.summary ? <><div className="summary-hero"><span><Sparkles /></span><div><h2>{t('summary')}</h2><p dir="auto">{transcription.summary}</p></div></div><h3>{t('keyTakeaways')}</h3><div className="takeaway-grid">{items.filter((item) => (item.kind === 'takeaway' || item.kind === 'note') && !item.tags.includes('sales-intelligence')).map((item) => <div className="takeaway-card" key={item.id}><CheckCircle2 /><div dir="auto" style={{ flex: 1, minWidth: 0 }}><strong>{item.title}</strong>{item.body?.trim() && item.body.trim() !== item.title.trim() && <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 11, lineHeight: 1.55 }}>{item.body}</p>}</div>{item.sourceSegmentIds[0] && <div className="takeaway-source-actions"><button className="evidence-link" onClick={() => showSource(item.sourceSegmentIds[0])}>{t('source')}</button><button className="evidence-link" onClick={() => playSource(item.sourceSegmentIds[0])}><Play size={12} />Play</button></div>}</div>)}</div><Button variant="secondary" busy={ollamaBusy} onClick={() => void analyzeWithOllama()}><RotateCcw size={16} />{t('rerunAnalysis')}</Button></> : <EmptyState title={t('emptySummary')} body={t('runAnalysisBody')} action={<Button busy={ollamaBusy} onClick={() => void analyzeWithOllama()}>{t('runAnalysis')}</Button>} />}</div>}

      {tab === 'sales' && <div className="sales-intelligence-view"><div className="section-heading"><div><h2>Sales intelligence</h2><p>Deal analysis grounded in what was said. It does not diagnose personality or infer personal wealth; budget conclusions refer only to the project and must show evidence.</p></div><Button variant="secondary" busy={salesBusy} disabled={!segments.length} onClick={() => void analyzeSales()}><RotateCcw size={16} />{salesItems.length ? 'Rerun sales analysis' : 'Run sales analysis'}</Button></div>{salesItems.length ? <><div className="sales-intelligence-disclaimer"><strong>Evidence-first:</strong> FACT, inference and UNKNOWN should remain visibly distinct. Open a source before acting on a high-impact conclusion.</div><div className="sales-intelligence-grid">{salesItems.map((item) => { const category = item.tags.find((tag) => tag.startsWith('sales:'))?.slice(6).replaceAll('-', ' ') || 'analysis'; return <article className="sales-intelligence-card" key={item.id}><div className="sales-intelligence-card-head"><span>{category}</span><span>{Math.round(item.confidence * 100)}% confidence</span></div><h3 dir="auto">{item.title}</h3>{item.body?.trim() && item.body.trim() !== item.title.trim() && <p dir="auto">{item.body}</p>}{item.uncertaintyReason && <div className="sales-intelligence-uncertainty"><AlertTriangle size={14} />{item.uncertaintyReason}</div>}<div className="sales-intelligence-evidence">{item.sourceSegmentIds.length ? item.sourceSegmentIds.map((segmentId, index) => <button className="evidence-link" key={segmentId} onClick={() => showSource(segmentId)}>Source {index + 1}</button>) : <span>No direct source — this should be an explicit unknown or low-confidence recommendation.</span>}</div></article>; })}</div></> : <EmptyState title="No sales brief yet" body="Run Sales intelligence after a transcript is ready. Ollama will create a separate evidence-backed deal brief without replacing your normal summary, tasks or notes." action={<Button busy={salesBusy} disabled={!segments.length} onClick={() => void analyzeSales()}><Sparkles size={16} />Run sales intelligence</Button>} />}</div>}
      {tab === 'notes' && <div><div className="section-heading"><div><h2>{t('notes')}</h2><p>AI-extracted entity/topic context, decisions, dependencies, risks, and your own notes are kept here.</p></div></div><section className="notes-section"><h3>Extracted from transcript</h3>{extractedNotes.length ? <div className="item-list">{extractedNotes.map((item) => <ItemRow key={item.id} item={item} transcriptionTitle={transcription.title} onUpdate={(patch) => store.updateItem(item.id, patch)} onDelete={() => store.deleteItem(item.id)} onSource={showSource} onPlaySource={playSource} />)}</div> : <EmptyState title="No extracted notes" body="Run Ollama analysis to create sourced company, system, project, decision, dependency, risk, and topic notes." />}</section><section className="notes-section"><h3>Your notes</h3><div className="note-composer"><Field label={t('addNote')}><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('notePlaceholder')} dir="auto" /></Field><Button disabled={!note.trim()} onClick={() => void store.addNote(id, note).then(() => setNote(''))}><Plus size={16} />{t('addNote')}</Button></div>{notes.length ? <div className="notes-list">{notes.map((value) => <article key={value.id}><p dir="auto">{value.body}</p><small>{formatDate(value.createdAt, 'MMM d, HH:mm')}</small></article>)}</div> : <p className="muted notes-blank">No personal notes yet.</p>}</section></div>}
    </Card>
    <CrmDestinationModal open={crmPickerOpen} onClose={() => setCrmPickerOpen(false)} settings={store.settings} busy={crmWorkspaceState === 'loading'} onSubmit={sendToCrm} />
    <ChatGptModal open={chatOpen} onClose={() => setChatOpen(false)} transcription={transcription} segments={segments} items={items} onImport={(values) => store.importItems(id, values)} />
  </div>;
}
