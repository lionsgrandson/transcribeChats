import { CalendarClock, Check, Filter, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, Field, PageSkeleton, StatusBadge } from '../components/ui';
import type { ExtractedItem, Priority } from '../domain/types';
import { useTranslation } from '../i18n/useTranslation';
import { useAppStore } from '../state/AppStore';

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
  const renderTask = (item: ExtractedItem) => <div className={`task-row ${item.status === 'completed' ? 'is-completed' : ''}`} key={item.id}>
    <button className={`task-checkbox ${item.status === 'completed' ? 'checked' : ''}`} onClick={() => void store.updateItem(item.id, { status: item.status === 'completed' ? 'open' : 'completed', confirmed: true })}>{item.status === 'completed' && <Check size={15} />}</button>
    <div className="task-content"><strong dir="auto">{item.title}</strong><div className="item-meta">{item.assignee && <span>{item.assignee}</span>}{item.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}{item.status === 'needs_review' && <StatusBadge status="needs_review" />}</div></div>
    <select className={`priority-select priority-${item.priority}`} value={item.priority} onChange={(event) => void store.updateItem(item.id, { priority: event.target.value as Priority })}><option value="none">{t('noPriority')}</option><option value="low">{t('low')}</option><option value="medium">{t('medium')}</option><option value="high">{t('high')}</option><option value="urgent">{t('urgent')}</option></select>
    <input className="date-inline" type="datetime-local" value={item.dueAt?.slice(0, 16) || ''} onChange={(event) => void store.updateItem(item.id, { dueAt: event.target.value ? new Date(event.target.value).toISOString() : undefined })} aria-label="Due date" />
    {item.status === 'needs_review' && <Button onClick={() => void store.updateItem(item.id, { status: 'open', confirmed: true })}>{t('accept')}</Button>}
  </div>;

  return <div className="page">
    <header className="page-header"><div><span className="eyebrow"><Check size={14} />{t('actionCenter')}</span><h1>{t('tasks')}</h1><p>{t('tasksSubtitle')}</p></div><Button onClick={() => setShowAdd((value) => !value)}><Plus size={17} />{t('addTask')}</Button></header>
    <div className="task-stats"><Card><span>{t('open')}</span><strong>{tasks.filter((item) => item.status === 'open').length}</strong></Card><Card><span>{t('needsReview')}</span><strong>{tasks.filter((item) => item.status === 'needs_review').length}</strong></Card><Card><span>{t('overdue')}</span><strong>{tasks.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < Date.now() && item.status !== 'completed').length}</strong></Card><Card><span>{t('completed')}</span><strong>{tasks.filter((item) => item.status === 'completed').length}</strong></Card></div>
    {showAdd && <Card className="quick-add"><Field label={t('title')}><input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} /></Field><Field label={t('source')}><select value={newTranscription} onChange={(event) => setNewTranscription(event.target.value)}><option value="">{t('selectTranscription')}</option>{store.transcriptions.map((value) => <option value={value.id} key={value.id}>{value.title}</option>)}</select></Field><div className="form-actions"><Button variant="ghost" onClick={() => setShowAdd(false)}>{t('cancel')}</Button><Button disabled={!newTitle.trim() || !newTranscription} onClick={() => void add()}>{t('save')}</Button></div></Card>}
    <Card>
      <div className="filter-bar"><div className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} /></div><div className="filter-tabs">{['all', 'review', 'open', 'completed'].map((value) => <button className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{value === 'review' ? t('needsReview') : t(value as 'all' | 'open' | 'completed')}</button>)}</div><label className="select-with-icon"><SlidersHorizontal size={16} /><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">{t('allPriorities')}</option><option value="urgent">{t('urgent')}</option><option value="high">{t('high')}</option><option value="medium">{t('medium')}</option><option value="low">{t('low')}</option></select></label></div>
      {filtered.length === 0 ? <EmptyState title={t('noTasks')} body={t('noTasksBody')} icon={<Filter />} /> : <div className="task-groups">{groups.overdue.length > 0 && <section><h2 className="group-title overdue"><CalendarClock size={17} />{t('overdue')} <span>{groups.overdue.length}</span></h2>{groups.overdue.map(renderTask)}</section>}<section><h2 className="group-title">{filter === 'completed' ? t('completed') : t('upcoming')} <span>{groups.upcoming.length}</span></h2>{groups.upcoming.map(renderTask)}</section></div>}
    </Card>
  </div>;
}
