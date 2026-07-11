import { ArrowRight, FileAudio, Filter, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, EmptyState, PageSkeleton, StatusBadge } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';
import { formatDate, formatDuration } from '../lib/format';
import { useAppStore } from '../state/AppStore';

export function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const { t } = useTranslation();
  const store = useAppStore();
  const [status, setStatus] = useState('all');
  const query = params.get('q') || '';
  const filtered = store.transcriptions.filter((value) => {
    if (status !== 'all' && value.status !== status) return false;
    const transcript = store.tSegments(value.id).map((segment) => segment.text).join(' ');
    return `${value.title} ${value.summary || ''} ${transcript}`.toLowerCase().includes(query.toLowerCase());
  });
  if (store.loading) return <PageSkeleton />;
  return <div className="page">
    <header className="page-header"><div><span className="eyebrow"><FileAudio size={15} />{t('historyEyebrow')}</span><h1>{t('history')}</h1><p>{t('historySubtitle')}</p></div><Button onClick={() => location.assign('/new')}>{t('newTranscript')}</Button></header>
    <Card>
      <div className="filter-bar"><div className="search-field"><Search /><input value={query} onChange={(event) => setParams(event.target.value ? { q: event.target.value } : {})} placeholder={t('searchTitles')} /></div><label className="select-with-icon"><Filter size={16} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t('allStatuses')}</option><option value="ready">{t('ready')}</option><option value="processing">{t('processing')}</option><option value="failed">{t('failed')}</option></select></label></div>
      {filtered.length === 0 ? <EmptyState title={query ? t('noMatches') : t('noTranscriptions')} body={query ? t('tryDifferent') : t('noTranscriptionsBody')} /> : <div className="history-table"><div className="history-head"><span>{t('conversation')}</span><span>{t('date')}</span><span>{t('length')}</span><span>{t('status')}</span><span /></div>{filtered.map((value) => <Link to={`/transcriptions/${value.id}`} className="history-row" key={value.id}><span className="history-title"><span className="record-file-icon"><FileAudio /></span><span><strong dir="auto">{value.title}</strong><small>{value.sourceType} · {value.detectedLanguages.join(' + ') || value.languageMode}</small></span></span><span>{formatDate(value.recordedAt)}</span><span>{formatDuration(value.durationMs)}</span><span><StatusBadge status={value.status} /></span><ArrowRight size={17} /></Link>)}</div>}
    </Card>
  </div>;
}
