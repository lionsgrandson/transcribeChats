import { ArrowRight, CalendarClock, CheckCircle2, FileAudio, Mic, Sparkles, Type } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, PageSkeleton, StatusBadge } from '../components/ui';
import { useTranslation } from '../i18n/useTranslation';
import { formatDate, formatDuration, relativeDate } from '../lib/format';
import { useAppStore } from '../state/AppStore';

export function HomePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { loading, error, transcriptions, items, loadDemo } = useAppStore();
  if (loading) return <PageSkeleton />;
  if (error) return <div className="page"><ErrorState title={t('errorLoading')} body={error} action={<Button onClick={() => location.reload()}>{t('tryAgain')}</Button>} /></div>;

  const review = items.filter((item) => item.status === 'needs_review');
  const open = items.filter((item) => item.kind === 'task' && item.status === 'open');
  const dueSoon = open.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < Date.now() + 7 * 86_400_000);
  const recent = transcriptions.slice(0, 5);

  return (
    <div className="page">
      <header className="page-header hero-header"><div><span className="eyebrow"><Sparkles size={15} />{t('homeEyebrow')}</span><h1>{t('home')}</h1><p>{t('homeSubtitle')}</p></div></header>
      <div className="creation-grid">
        <button className="creation-card creation-record" onClick={() => navigate('/new?mode=record')}><span className="creation-icon"><Mic /></span><strong>{t('record')}</strong><span>{t('startNewConversation')}</span><ArrowRight size={18} /></button>
        <button className="creation-card" onClick={() => navigate('/new?mode=upload')}><span className="creation-icon"><FileAudio /></span><strong>{t('upload')}</strong><span>{t('supportedFormats')}</span><ArrowRight size={18} /></button>
        <button className="creation-card" onClick={() => navigate('/new?mode=text')}><span className="creation-icon"><Type /></span><strong>{t('addText')}</strong><span>{t('pasteNotesConversation')}</span><ArrowRight size={18} /></button>
      </div>

      <div className="metric-grid">
        <Card className="metric-card"><div className="metric-icon violet"><FileAudio /></div><div><span>{t('totalTranscripts')}</span><strong>{transcriptions.length}</strong></div></Card>
        <Card className="metric-card"><div className="metric-icon amber"><Sparkles /></div><div><span>{t('needsReview')}</span><strong>{review.length}</strong></div></Card>
        <Card className="metric-card"><div className="metric-icon green"><CheckCircle2 /></div><div><span>{t('open')} {t('tasks').toLowerCase()}</span><strong>{open.length}</strong></div></Card>
        <Card className="metric-card"><div className="metric-icon blue"><CalendarClock /></div><div><span>{t('dueThisWeek')}</span><strong>{dueSoon.length}</strong></div></Card>
      </div>

      <div className="dashboard-columns">
        <Card>
          <div className="section-heading"><div><h2>{t('recentTranscriptions')}</h2><p>{t('latestRecordings')}</p></div>{recent.length > 0 && <Link to="/history">{t('viewAll')} <ArrowRight size={15} /></Link>}</div>
          {recent.length === 0 ? <EmptyState title={t('noTranscriptions')} body={t('noTranscriptionsBody')} action={<div className="inline-actions"><Button onClick={() => navigate('/new')}>{t('newTranscript')}</Button><Button variant="secondary" onClick={() => void loadDemo()}>{t('loadDemo')}</Button></div>} /> :
            <div className="record-list">{recent.map((transcription) => <Link className="record-row" to={`/transcriptions/${transcription.id}`} key={transcription.id}><div className="record-file-icon"><FileAudio /></div><div className="record-main"><strong dir="auto">{transcription.title}</strong><span>{formatDate(transcription.recordedAt)} · {formatDuration(transcription.durationMs)} · {transcription.detectedLanguages.join(' + ') || transcription.languageMode}</span></div><StatusBadge status={transcription.status} /><span className="record-relative">{relativeDate(transcription.updatedAt)}</span><ArrowRight size={17} /></Link>)}</div>}
        </Card>
        <Card>
          <div className="section-heading"><div><h2>{t('needsReview')}</h2><p>{t('confirmBeforeActive')}</p></div>{review.length > 0 && <Link to="/tasks?filter=review">{t('viewAll')}</Link>}</div>
          {review.length === 0 ? <EmptyState title={t('allCaughtUp')} body={t('allCaughtUpBody')} icon={<CheckCircle2 />} /> :
            <div className="review-list">{review.slice(0, 4).map((item) => <Link to={`/transcriptions/${item.transcriptionId}?tab=tasks`} className="review-row" key={item.id}><span className={`kind-dot kind-${item.kind}`} /><div><strong dir="auto">{item.title}</strong><span>{item.kind}{item.assignee ? ` · ${item.assignee}` : ''}</span></div><ArrowRight size={16} /></Link>)}</div>}
        </Card>
      </div>
    </div>
  );
}
