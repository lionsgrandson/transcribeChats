import { ArrowRight, FileAudio, Mic, Type } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, PageSkeleton, StatusBadge } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';
import { formatDate, formatDuration, relativeDate } from '../lib/format';
import { useAppStore } from '../state/AppStore';

export function HomePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { loading, error, transcriptions } = useAppStore();
  if (loading) return <PageSkeleton />;
  if (error) return <div className="page"><ErrorState title={t('errorLoading')} body={error} action={<Button onClick={() => location.reload()}>{t('tryAgain')}</Button>} /></div>;
  return <div className="page">
    <header className="page-header hero-header"><div><span className="eyebrow">{t('appName')}</span><h1>{t('newTranscript')}</h1><p>{t('newSubtitle')}</p></div></header>
    <div className="creation-grid">
      <button className="creation-card creation-record" onClick={() => navigate('/new?mode=record')}><span className="creation-icon"><Mic /></span><strong>{t('record')}</strong><span>{t('startNewConversation')}</span><ArrowRight size={18} /></button>
      <button className="creation-card" onClick={() => navigate('/new?mode=upload')}><span className="creation-icon"><FileAudio /></span><strong>{t('upload')}</strong><span>{t('supportedFormats')}</span><ArrowRight size={18} /></button>
      <button className="creation-card" onClick={() => navigate('/new?mode=text')}><span className="creation-icon"><Type /></span><strong>{t('addText')}</strong><span>{t('pasteNotesConversation')}</span><ArrowRight size={18} /></button>
    </div>
    <Card>
      <div className="section-heading"><div><h2>{t('recentTranscriptions')}</h2><p>{transcriptions.length} {t('totalTranscripts').toLowerCase()}</p></div>{transcriptions.length > 0 && <Link to="/history">{t('viewAll')} <ArrowRight size={15} /></Link>}</div>
      {transcriptions.length === 0
        ? <EmptyState title={t('noTranscriptions')} body={t('noTranscriptionsBody')} action={<Button onClick={() => navigate('/new')}>{t('newTranscript')}</Button>} />
        : <div className="record-list">{transcriptions.slice(0, 6).map((record) =>
          <Link className="record-row" to={`/transcriptions/${record.id}`} key={record.id}>
            <div className="record-file-icon"><FileAudio /></div>
            <div className="record-main"><strong dir="auto">{record.title}</strong><span>{formatDate(record.recordedAt)} · {formatDuration(record.durationMs)}</span></div>
            <StatusBadge status={record.status} /><span className="record-relative">{relativeDate(record.updatedAt)}</span><ArrowRight size={17} />
          </Link>)}</div>}
    </Card>
  </div>;
}
