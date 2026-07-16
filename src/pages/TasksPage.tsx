import { CalendarClock, Check, CheckCheck, Download, Edit3, ExternalLink, Filter, LoaderCircle, Plus, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, Field, PageSkeleton, StatusBadge } from '../components/ui';
import type { ExtractedItem, Priority } from '../domain/types';
import { useTranslation } from '../i18n/useTranslation';
import { sendTasksToCrm, toCrmTask } from '../services/crmTransfer';
import { exportAllTasksCsv } from '../services/exports';
import { useAppStore } from '../state/AppStore';

type ActionState = 'idle' | 'loading' | 'success' | 'failure';

function TaskRow({ item, transcriptionTitle, selected, onSelect, onUpdate, onDelete }: { item: ExtractedItem; transcriptionTitle: string; selected: boolean; onSelect: (selected: boolean) => void; onUpdate: (patch: Partial<ExtractedItem>) => Promise<void>; onDelete: () => Promise<void> }) {
  const { t } = useTranslation();
  const store = useAppStore();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [assignee, setAssignee] = useState(item.assignee || '');
  const [tags, setTags] = useState(item.tags.join(', '));
  const [crmState, setCrmState] = useState<ActionState>('idle');
  const save = async () => {
    if (!title.trim()) return;
    await onUpdate({ title: title.trim(), assignee: assignee.trim() || undefined, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) });
    setEditing(false);
  };
  const cancel = () => { setTitle(item.title); setAssignee(item.assignee || ''); setTags(item.tags.join(', ')); setEditing(false); };
  const sendToCrm = async () => {
    setCrmState('loading');
    try {
      await sendTasksToCrm([toCrmTask(item, transcriptionTitle)], store.settings);
      setCrmState('success');
      window.setTimeout(() => setCrmState('idle'), 3000);
    } catch { setCrmState('failure'); }
  };

  return <div className={`task-row ${item.status === 'completed' ? 'is-completed' : ''}`}>
    <input className="bulk-checkbox" type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select ${item.title}`} />
    <button className={`task-checkbox ${item.status === 'completed' ? 'checked' : ''}`} onClick={() => void onUpdate({ status: item.status === 'completed' ? 'open' : 'completed', confirmed: true })} aria-label={item.status === 'completed' ? t('reopen') : t('complete')}>{item.status === 'completed' && <Check size={15} />}</button>
    <div className="task-content">
      {editing ? <div className="task-edit-grid"><input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Task title" dir="auto" /><input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder={t('assignee')} aria-label={t('assignee')} /><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tag, tag" aria-label={t('tags')} /></div> : <><strong dir="auto">{item.title}</strong><div className="item-meta"><span>{transcriptionTitle}</span>{item.assignee && <span>{item.assignee}</span>}{item.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}{item.status === 'needs_review' && <StatusBadge status="needs_review" />}</div></>}
    </div>
    <select className={`priority-select priority-${item.priority}`} value={item.priority} onChange={(event) => void onUpdate({ priority: event.target.value as Priority })} aria-label={t('priority')}><option value="none">{t('noPriority')}</option><option value="low">{t('low')}</option><option value="medium">{t('medium')}</option><option value="high">{t('high')}</option><option value="urgent">{t('urgent')}</option></select>
    <input className="date-inline" type="datetime-local" value={item.dueAt?.slice(0, 16) || ''} onChange={(event) => void onUpdate({ dueAt: event.target.value ? new Date(event.target.value).toISOString() : undefined })} aria-label="Due date" />
    <div className="task-actions">
      {item.status === 'needs_review' && <Button onClick={() => void onUpdate({ status: 'open', confirmed: true })}>{t('accept')}</Button>}
      <button className={`crm-transfer ${crmState}`} onClick={() => void sendToCrm()} disabled={crmState === 'loading'} aria-label={`Send ${item.title} to the selected CRM`} title={crmState === 'failure' ? 'CRM sync failed. Check Settings and retry.' : 'Send directly to the CRM selected in Settings'}>{crmState === 'loading' ? <LoaderCircle className="spin" size={14} /> : crmState === 'success' ? <Check size={14} /> : <ExternalLink size={14} />}<span>{crmState === 'success' ? 'CRM synced' : crmState === 'failure' ? 'Retry CRM' : 'Send to CRM'}</span></button>
      {editing ? <><button className="icon-button compact" onClick={() => void save()} aria-label={t('save')}><Save size={15} /></button><button className="icon-button compact" onClick={cancel} aria-label={t('cancel')}><X size={15} /></button></> : <button className="icon-button compact" onClick={() => setEditing(true)} aria-label={t('edit')}><Edit3 size={15} /></button>}
      <button className="icon-button compact danger-icon" onClick={() => { if (confirm(`Delete task "${item.title}"?`)) void onDelete(); }} aria-label={t('delete')}><Trash2 size={15} /></button>
    </div>
  </div>;
}

export function TasksPage() {
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const store = useAppStore();
  const [filter, setFilter] = useState(params.get('filter') === 'review' ? 'review' : 'open');
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('all');
  const [transcriptionFilter, setTranscriptionFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTranscription, setNewTranscription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'accept' | 'send' | 'delete' | null>(null);
  const [bulkError, setBulkError] = useState('');
  const [bulkSuccess, setBulkSuccess] = useState('');
  const [exportState, setExportState] = useState<ActionState>('idle');
  const tasks = store.items.filter((item) => item.kind === 'task');
  const transcriptionTitle = (id: string) => store.transcriptions.find((transcription) => transcription.id === id)?.title || 'Transcription';
  const filtered = tasks.filter((item) => {
    if (filter === 'review' && item.status !== 'needs_review') return false;
    if (filter === 'open' && item.status !== 'open') return false;
    if (filter === 'completed' && item.status !== 'completed') return false;
    if (filter !== 'all' && !['review', 'open', 'completed'].includes(filter)) return false;
    if (priority !== 'all' && item.priority !== priority) return false;
    if (transcriptionFilter !== 'all' && item.transcriptionId !== transcriptionFilter) return false;
    const normalizedQuery = query.trim().toLowerCase();
    return !normalizedQuery || [item.title, item.body || '', transcriptionTitle(item.transcriptionId)].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const groups = {
    overdue: filtered.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < Date.now() && item.status !== 'completed'),
    upcoming: filtered.filter((item) => !item.dueAt || new Date(item.dueAt).getTime() >= Date.now() || item.status === 'completed'),
  };
  if (store.loading) return <PageSkeleton />;
  const add = async () => {
    if (!newTitle.trim() || !newTranscription) return;
    await store.addItem(newTranscription, { kind: 'task', title: newTitle, status: 'open', confirmed: true });
    setNewTitle(''); setShowAdd(false);
  };
  const toggleSelected = (id: string, value: boolean) => setSelected((current) => {
    const next = new Set(current); if (value) next.add(id); else next.delete(id); return next;
  });
  const beginBulk = (action: 'accept' | 'send' | 'delete') => { setBulkAction(action); setBulkError(''); setBulkSuccess(''); };
  const deleteSelected = async () => {
    if (!selected.size || !confirm(`Delete ${selected.size} selected tasks?`)) return;
    beginBulk('delete');
    try { await store.deleteItems([...selected]); setSelected(new Set()); setBulkSuccess('Selected tasks deleted.'); }
    catch (reason) { setBulkError(reason instanceof Error ? reason.message : 'Could not delete the selected tasks.'); }
    finally { setBulkAction(null); }
  };
  const selectedReview = tasks.filter((item) => selected.has(item.id) && item.status === 'needs_review');
  const acceptSelected = async () => {
    if (!selectedReview.length) return;
    beginBulk('accept');
    try {
      await Promise.all(selectedReview.map((item) => store.updateItem(item.id, { status: 'open', confirmed: true })));
      setBulkSuccess(`${selectedReview.length} selected task${selectedReview.length === 1 ? '' : 's'} accepted.`);
    } catch (reason) { setBulkError(reason instanceof Error ? reason.message : 'Could not accept the selected tasks.'); }
    finally { setBulkAction(null); }
  };
  const sendSelectedToCrm = async () => {
    const chosen = tasks.filter((item) => selected.has(item.id));
    if (!chosen.length) return;
    beginBulk('send');
    try {
      const payload = chosen.map((item) => toCrmTask(item, transcriptionTitle(item.transcriptionId)));
      const result = await sendTasksToCrm(payload, store.settings);
      setBulkSuccess(`${result.tasksCreated ?? chosen.length} task${chosen.length === 1 ? '' : 's'} sent directly to the selected CRM.`);
    } catch (reason) { setBulkError(reason instanceof Error ? reason.message : 'Could not sync the selected CRM.'); }
    finally { setBulkAction(null); }
  };
  const exportTasks = () => {
    setExportState('loading');
    try { exportAllTasksCsv(tasks, store.transcriptions); setExportState('success'); window.setTimeout(() => setExportState('idle'), 3000); }
    catch { setExportState('failure'); }
  };
  const renderTask = (item: ExtractedItem) => <TaskRow key={item.id} item={item} transcriptionTitle={transcriptionTitle(item.transcriptionId)} selected={selected.has(item.id)} onSelect={(value) => toggleSelected(item.id, value)} onUpdate={(patch) => store.updateItem(item.id, patch)} onDelete={() => store.deleteItem(item.id)} />;

  return <div className="page">
    <header className="page-header"><div><span className="eyebrow"><Check size={14} />{t('actionCenter')}</span><h1>{t('tasks')}</h1><p>{t('tasksSubtitle')}</p></div><div className="header-actions"><Button variant="secondary" disabled={!tasks.length || exportState === 'loading'} onClick={exportTasks}>{exportState === 'loading' ? <LoaderCircle className="spin" size={17} /> : exportState === 'success' ? <Check size={17} /> : <Download size={17} />}{exportState === 'success' ? 'Exported' : exportState === 'failure' ? 'Retry export' : 'Export all tasks'}</Button><Button onClick={() => setShowAdd((value) => !value)}><Plus size={17} />{t('addTask')}</Button></div></header>
    <div className="task-stats"><Card><span>{t('open')}</span><strong>{tasks.filter((item) => item.status === 'open').length}</strong></Card><Card><span>{t('needsReview')}</span><strong>{tasks.filter((item) => item.status === 'needs_review').length}</strong></Card><Card><span>{t('overdue')}</span><strong>{tasks.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < Date.now() && item.status !== 'completed').length}</strong></Card><Card><span>{t('completed')}</span><strong>{tasks.filter((item) => item.status === 'completed').length}</strong></Card></div>
    {showAdd && <Card className="quick-add"><Field label={t('title')}><input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} /></Field><Field label={t('source')}><select value={newTranscription} onChange={(event) => setNewTranscription(event.target.value)}><option value="">{t('selectTranscription')}</option>{store.transcriptions.map((value) => <option value={value.id} key={value.id}>{value.title}</option>)}</select></Field><div className="form-actions"><Button variant="ghost" onClick={() => setShowAdd(false)}>{t('cancel')}</Button><Button disabled={!newTitle.trim() || !newTranscription} onClick={() => void add()}>{t('save')}</Button></div></Card>}
    <Card>
      <div className="filter-bar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search task or transcription" /></div><div className="filter-tabs">{['all', 'review', 'open', 'completed'].map((value) => <button className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{value === 'review' ? t('needsReview') : t(value as 'all' | 'open' | 'completed')}</button>)}</div><label className="select-with-icon"><SlidersHorizontal size={16} /><select value={transcriptionFilter} onChange={(event) => setTranscriptionFilter(event.target.value)} aria-label="Filter by transcription"><option value="all">All transcriptions</option>{store.transcriptions.map((transcription) => <option key={transcription.id} value={transcription.id}>{transcription.title}</option>)}</select></label><label className="select-with-icon"><SlidersHorizontal size={16} /><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">{t('allPriorities')}</option><option value="urgent">{t('urgent')}</option><option value="high">{t('high')}</option><option value="medium">{t('medium')}</option><option value="low">{t('low')}</option></select></label></div>
      {filtered.length > 0 && <div className="bulk-toolbar"><label><input type="checkbox" checked={filtered.every((item) => selected.has(item.id))} onChange={(event) => setSelected((current) => { const next = new Set(current); filtered.forEach((item) => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })} /> Select all shown</label><span>{selected.size} selected</span><Button variant="secondary" disabled={!selectedReview.length || bulkAction !== null} onClick={() => void acceptSelected()}>{bulkAction === 'accept' ? <LoaderCircle className="spin" size={15} /> : <CheckCheck size={15} />}Accept selected{selectedReview.length ? ` (${selectedReview.length})` : ''}</Button><Button disabled={!selected.size || bulkAction !== null} onClick={() => void sendSelectedToCrm()}>{bulkAction === 'send' ? <LoaderCircle className="spin" size={15} /> : <ExternalLink size={15} />}Send selected to CRM</Button><Button variant="danger" disabled={!selected.size || bulkAction !== null} onClick={() => void deleteSelected()}>{bulkAction === 'delete' ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}Delete selected</Button></div>}
      {bulkError && <div className="banner banner-error" role="alert">{bulkError}</div>}
      {bulkSuccess && <div className="banner banner-success" role="status">{bulkSuccess}</div>}
      {filtered.length === 0 ? <EmptyState title={t('noTasks')} body={t('noTasksBody')} icon={<Filter />} /> : <div className="task-groups">{groups.overdue.length > 0 && <section><h2 className="group-title overdue"><CalendarClock size={17} />{t('overdue')} <span>{groups.overdue.length}</span></h2>{groups.overdue.map(renderTask)}</section>}<section><h2 className="group-title">{filter === 'completed' ? t('completed') : t('upcoming')} <span>{groups.upcoming.length}</span></h2>{groups.upcoming.map(renderTask)}</section></div>}
    </Card>
  </div>;
}
