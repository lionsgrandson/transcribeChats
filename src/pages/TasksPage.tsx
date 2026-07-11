import { CalendarClock, Check, Edit3, Filter, LoaderCircle, Plus, Save, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, Field, PageSkeleton, StatusBadge } from '../components/ui';
import type { ExtractedItem, Priority } from '../domain/types';
import { useTranslation } from '../i18n/useTranslation';
import { useAppStore } from '../state/AppStore';

function TaskRow({ item, selected, onSelect, onUpdate, onDelete }: { item: ExtractedItem; selected: boolean; onSelect: (selected: boolean) => void; onUpdate: (patch: Partial<ExtractedItem>) => Promise<void>; onDelete: () => Promise<void> }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [assignee, setAssignee] = useState(item.assignee || '');
  const [tags, setTags] = useState(item.tags.join(', '));
  const save = async () => {
    if (!title.trim()) return;
    await onUpdate({ title: title.trim(), assignee: assignee.trim() || undefined, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) });
    setEditing(false);
  };
  const cancel = () => { setTitle(item.title); setAssignee(item.assignee || ''); setTags(item.tags.join(', ')); setEditing(false); };

  return <div className={`task-row ${item.status === 'completed' ? 'is-completed' : ''}`}>
    <input className="bulk-checkbox" type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select ${item.title}`} />
    <button className={`task-checkbox ${item.status === 'completed' ? 'checked' : ''}`} onClick={() => void onUpdate({ status: item.status === 'completed' ? 'open' : 'completed', confirmed: true })} aria-label={item.status === 'completed' ? t('reopen') : t('complete')}>{item.status === 'completed' && <Check size={15} />}</button>
    <div className="task-content">
      {editing ? <div className="task-edit-grid"><input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Task title" dir="auto" /><input value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder={t('assignee')} aria-label={t('assignee')} /><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tag, tag" aria-label={t('tags')} /></div> : <><strong dir="auto">{item.title}</strong><div className="item-meta">{item.assignee && <span>{item.assignee}</span>}{item.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}{item.status === 'needs_review' && <StatusBadge status="needs_review" />}</div></>}
    </div>
    <select className={`priority-select priority-${item.priority}`} value={item.priority} onChange={(event) => void onUpdate({ priority: event.target.value as Priority })} aria-label={t('priority')}><option value="none">{t('noPriority')}</option><option value="low">{t('low')}</option><option value="medium">{t('medium')}</option><option value="high">{t('high')}</option><option value="urgent">{t('urgent')}</option></select>
    <input className="date-inline" type="datetime-local" value={item.dueAt?.slice(0, 16) || ''} onChange={(event) => void onUpdate({ dueAt: event.target.value ? new Date(event.target.value).toISOString() : undefined })} aria-label="Due date" />
    <div className="task-actions">
      {item.status === 'needs_review' && <Button onClick={() => void onUpdate({ status: 'open', confirmed: true })}>{t('accept')}</Button>}
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
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTranscription, setNewTranscription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const tasks = store.items.filter((item) => item.kind === 'task');
  const filtered = tasks.filter((item) => {
    if (filter === 'review' && item.status !== 'needs_review') return false;
    if (filter === 'open' && item.status !== 'open') return false;
    if (filter === 'completed' && item.status !== 'completed') return false;
    if (filter !== 'all' && !['review', 'open', 'completed'].includes(filter)) return false;
    if (priority !== 'all' && item.priority !== priority) return false;
    return item.title.toLowerCase().includes(query.toLowerCase());
  });
  const groups = {
    overdue: filtered.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < Date.now() && item.status !== 'completed'),
    upcoming: filtered.filter((item) => !item.dueAt || new Date(item.dueAt).getTime() >= Date.now() || item.status === 'completed')
  };
  if (store.loading) return <PageSkeleton />;
  const add = async () => {
    if (!newTitle.trim() || !newTranscription) return;
    await store.addItem(newTranscription, { kind: 'task', title: newTitle, status: 'open', confirmed: true });
    setNewTitle(''); setShowAdd(false);
  };
  const toggleSelected = (id: string, value: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (value) next.add(id); else next.delete(id);
    return next;
  });
  const deleteSelected = async () => {
    if (!selected.size || !confirm(`Delete ${selected.size} selected tasks?`)) return;
    setBulkBusy(true); setBulkError('');
    try { await store.deleteItems([...selected]); setSelected(new Set()); }
    catch (reason) { setBulkError(reason instanceof Error ? reason.message : 'Could not delete the selected tasks.'); }
    finally { setBulkBusy(false); }
  };
  const renderTask = (item: ExtractedItem) => <TaskRow key={item.id} item={item} selected={selected.has(item.id)} onSelect={(value) => toggleSelected(item.id, value)} onUpdate={(patch) => store.updateItem(item.id, patch)} onDelete={() => store.deleteItem(item.id)} />;

  return <div className="page">
    <header className="page-header"><div><span className="eyebrow"><Check size={14} />{t('actionCenter')}</span><h1>{t('tasks')}</h1><p>{t('tasksSubtitle')}</p></div><Button onClick={() => setShowAdd((value) => !value)}><Plus size={17} />{t('addTask')}</Button></header>
    <div className="task-stats"><Card><span>{t('open')}</span><strong>{tasks.filter((item) => item.status === 'open').length}</strong></Card><Card><span>{t('needsReview')}</span><strong>{tasks.filter((item) => item.status === 'needs_review').length}</strong></Card><Card><span>{t('overdue')}</span><strong>{tasks.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < Date.now() && item.status !== 'completed').length}</strong></Card><Card><span>{t('completed')}</span><strong>{tasks.filter((item) => item.status === 'completed').length}</strong></Card></div>
    {showAdd && <Card className="quick-add"><Field label={t('title')}><input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} /></Field><Field label={t('source')}><select value={newTranscription} onChange={(event) => setNewTranscription(event.target.value)}><option value="">{t('selectTranscription')}</option>{store.transcriptions.map((value) => <option value={value.id} key={value.id}>{value.title}</option>)}</select></Field><div className="form-actions"><Button variant="ghost" onClick={() => setShowAdd(false)}>{t('cancel')}</Button><Button disabled={!newTitle.trim() || !newTranscription} onClick={() => void add()}>{t('save')}</Button></div></Card>}
    <Card>
      <div className="filter-bar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} /></div><div className="filter-tabs">{['all', 'review', 'open', 'completed'].map((value) => <button className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{value === 'review' ? t('needsReview') : t(value as 'all' | 'open' | 'completed')}</button>)}</div><label className="select-with-icon"><SlidersHorizontal size={16} /><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">{t('allPriorities')}</option><option value="urgent">{t('urgent')}</option><option value="high">{t('high')}</option><option value="medium">{t('medium')}</option><option value="low">{t('low')}</option></select></label></div>
      {filtered.length > 0 && <div className="bulk-toolbar"><label><input type="checkbox" checked={filtered.every((item) => selected.has(item.id))} onChange={(event) => setSelected((current) => { const next = new Set(current); filtered.forEach((item) => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })} /> Select all shown</label><span>{selected.size} selected</span><Button variant="danger" disabled={!selected.size || bulkBusy} onClick={() => void deleteSelected()}>{bulkBusy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}Delete selected</Button></div>}
      {bulkError && <div className="banner banner-error" role="alert">{bulkError}</div>}
      {filtered.length === 0 ? <EmptyState title={t('noTasks')} body={t('noTasksBody')} icon={<Filter />} /> : <div className="task-groups">{groups.overdue.length > 0 && <section><h2 className="group-title overdue"><CalendarClock size={17} />{t('overdue')} <span>{groups.overdue.length}</span></h2>{groups.overdue.map(renderTask)}</section>}<section><h2 className="group-title">{filter === 'completed' ? t('completed') : t('upcoming')} <span>{groups.upcoming.length}</span></h2>{groups.upcoming.map(renderTask)}</section></div>}
    </Card>
  </div>;
}
