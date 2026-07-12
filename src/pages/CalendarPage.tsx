import { ArrowLeft, ArrowRight, CalendarDays, LoaderCircle, List, Plus, Trash2 } from 'lucide-react';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, PageSkeleton } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';
import { isValidDateValue } from '../lib/format';
import { useAppStore } from '../state/AppStore';

export function CalendarPage() {
  const { t } = useTranslation();
  const store = useAppStore();
  const [cursor, setCursor] = useState(new Date());
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const events = store.items.filter((item) => item.kind === 'event');
  const dated = store.items.filter((item) => item.confirmed && item.status === 'open' && ((item.kind === 'event' && isValidDateValue(item.startsAt)) || (item.kind === 'task' && isValidDateValue(item.dueAt)))).sort((a, b) => new Date(a.startsAt || a.dueAt!).getTime() - new Date(b.startsAt || b.dueAt!).getTime());
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor)), end: endOfWeek(endOfMonth(cursor)) });
  const byDay = new Map(days.map((day) => [format(day, 'yyyy-MM-dd'), dated.filter((item) => isSameDay(new Date(item.startsAt || item.dueAt!), day))]));
  if (store.loading) return <PageSkeleton />;
  const deleteSelectedEvents = async () => {
    if (!selectedEvents.size || !confirm(`Delete ${selectedEvents.size} selected events?`)) return;
    setBulkBusy(true); setBulkError('');
    try { await store.deleteItems([...selectedEvents]); setSelectedEvents(new Set()); }
    catch (reason) { setBulkError(reason instanceof Error ? reason.message : 'Could not delete the selected events.'); }
    finally { setBulkBusy(false); }
  };
  return <div className="page">
    <header className="page-header"><div><span className="eyebrow"><CalendarDays size={15} />{t('calendarEyebrow')}</span><h1>{t('calendar')}</h1><p>{t('calendarSubtitle')}</p></div><Button onClick={() => location.assign('/tasks')}><Plus size={17} />{t('addTask')}</Button></header>
    <Card className="event-manager">
      <div className="section-heading"><div><h2>Event management</h2><p>Select several event suggestions or accepted events and delete them together.</p></div>{events.length > 0 && <Button variant="danger" disabled={!selectedEvents.size || bulkBusy} onClick={() => void deleteSelectedEvents()}>{bulkBusy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}Delete selected ({selectedEvents.size})</Button>}</div>
      {bulkError && <div className="banner banner-error" role="alert">{bulkError}</div>}
      {events.length === 0 ? <EmptyState title="No event records" body="Explicit meeting proposals will appear here for review." /> : <><label className="bulk-select-all"><input type="checkbox" checked={events.every((item) => selectedEvents.has(item.id))} onChange={(event) => setSelectedEvents(event.target.checked ? new Set(events.map((item) => item.id)) : new Set())} /> Select all events</label><div className="event-management-list">{events.map((item) => <label className="event-management-row" key={item.id}><input className="bulk-checkbox" type="checkbox" checked={selectedEvents.has(item.id)} onChange={(event) => setSelectedEvents((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /><span className={`kind-dot kind-${item.kind}`} /><span><strong dir="auto">{item.title}</strong><small>{isValidDateValue(item.startsAt) ? format(new Date(item.startsAt), 'PPp') : 'No date/time'} · {item.status === 'needs_review' ? 'Needs review' : item.status}</small></span></label>)}</div></>}
    </Card>
    <Card className="calendar-card">
      <div className="calendar-toolbar"><div className="calendar-nav"><button className="icon-button" onClick={() => setCursor(addMonths(cursor, -1))}><ArrowLeft /></button><h2>{format(cursor, 'MMMM yyyy')}</h2><button className="icon-button" onClick={() => setCursor(addMonths(cursor, 1))}><ArrowRight /></button><Button variant="ghost" onClick={() => setCursor(new Date())}>{t('today')}</Button></div><div className="segmented-control compact"><button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}><CalendarDays size={15} />{t('month')}</button><button className={view === 'agenda' ? 'active' : ''} onClick={() => setView('agenda')}><List size={15} />{t('agenda')}</button></div></div>
      {dated.length === 0 ? <EmptyState title={t('noEvents')} body={t('noEventsBody')} /> : view === 'month' ? <div className="calendar-grid"><div className="weekday-row">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day) => <span key={day}>{day}</span>)}</div>{days.map((day) => <div className={`calendar-day ${!isSameMonth(day, cursor) ? 'outside' : ''} ${isSameDay(day, new Date()) ? 'today' : ''}`} key={day.toISOString()}><time>{format(day, 'd')}</time><div>{byDay.get(format(day, 'yyyy-MM-dd'))?.slice(0, 3).map((item) => <Link to={`/transcriptions/${item.transcriptionId}?tab=timeline`} className={`calendar-event event-${item.kind}`} key={item.id}><span>{item.startsAt ? format(new Date(item.startsAt), 'HH:mm') : 'Due'}</span><strong dir="auto">{item.title}</strong></Link>)}</div></div>)}</div> : <div className="agenda-list">{dated.map((item) => <Link className="agenda-row" to={`/transcriptions/${item.transcriptionId}?tab=timeline`} key={item.id}><time>{format(new Date(item.startsAt || item.dueAt!), 'MMM')}<strong>{format(new Date(item.startsAt || item.dueAt!), 'd')}</strong></time><span className={`kind-dot kind-${item.kind}`} /><div><strong dir="auto">{item.title}</strong><span>{format(new Date(item.startsAt || item.dueAt!), 'EEEE · HH:mm')} · {item.kind}</span></div><ArrowRight /></Link>)}</div>}
    </Card>
  </div>;
}
