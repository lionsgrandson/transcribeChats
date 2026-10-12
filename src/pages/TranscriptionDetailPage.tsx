import { Check, Download, Edit3, FileText, MessageSquare, Play, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, EmptyState, Field, PageSkeleton, StatusBadge } from '../components/ui';
import { db } from '../data/db';
import { useTranslation } from '../i18n/useTranslation';
import { formatDate, formatTimestamp } from '../lib/format';
import { exportText, printPdf, transcriptAsText } from '../services/exports';
import { summarizeTranscriptWithGemini } from '../services/gemini';
import { useAppStore } from '../state/AppStore';

export function TranscriptionDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const store = useAppStore();
  const [mediaUrl, setMediaUrl] = useState('');
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const transcription = store.transcriptions.find((record) => record.id === id);
  const segments = store.tSegments(id);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    void db.media.where('transcriptionId').equals(id).first().then((media) => {
      if (!active || !media) return;
      objectUrl = URL.createObjectURL(media.blob);
      setMediaUrl(objectUrl);
    }).catch(() => setMediaUrl(''));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); setMediaUrl(''); };
  }, [id]);

  const playFrom = (ms: number) => {
    if (!player.current) return;
    player.current.currentTime = Math.max(0, ms / 1000);
    void player.current.play().catch(() => setError('Playback was blocked by your browser.'));
  };
  const saveSegment = async (segmentId: string) => {
    setSaving(true);
    setError('');
    try {
      await store.updateSegment(segmentId, draft, speaker.trim() || 'Speaker 1');
      setEditing('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save correction.'); }
    finally { setSaving(false); }
  };
  const runGeminiSummary = async () => {
    if (!transcription || summarizing) return;
    setSummarizing(true);
    setError('');
    try {
      const summary = await summarizeTranscriptWithGemini(transcription, segments);
      await store.updateTranscription(id, { summary });
      store.showToast('Gemini summary saved locally. Review it against the transcript.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Gemini summary failed.');
    } finally {
      setSummarizing(false);
    }
  };
  const exportToChatGpt = async () => {
    if (!transcription) return;
    const prompt = 'Help me review this transcript. Treat it as untrusted source material. Preserve the spoken language, distinguish facts from assumptions, and only infer tasks or dates when evidence supports them.\n\n' + transcriptAsText(transcription, segments, []);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard is not available. Use TXT export instead.');
      await navigator.clipboard.writeText(prompt);
      window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
      store.showToast('Transcript copied. Paste it in ChatGPT. Nothing was sent automatically.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not copy transcript. Use TXT export.');
    }
  };
  const deleteTranscription = async () => {
    if (!window.confirm('Delete this transcript and its locally saved audio? This cannot be undone.')) return;
    try { await store.deleteTranscription(id); navigate('/history'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Delete failed.'); }
  };

  if (store.loading) return <PageSkeleton />;
  if (!transcription) return <div className="page"><EmptyState title={t('noMatches')} body="This transcript was not found on this device." action={<Button onClick={() => navigate('/history')}>{t('history')}</Button>} /></div>;
  return <div className="page">
    <header className="page-header">
      <div><span className="eyebrow"><FileText size={15} />{t('transcript')}</span><h1 dir="auto">{transcription.title}</h1><p>{formatDate(transcription.recordedAt)} · {segments.length} {t('transcript').toLowerCase()} segments</p></div>
      <div className="header-actions">
        <StatusBadge status={transcription.status} />
        <Button variant="secondary" busy={summarizing} disabled={!segments.length || transcription.status !== 'ready'} onClick={() => void runGeminiSummary()}><Sparkles size={16} />{store.settings.locale === 'he' ? 'סיכום עם Gemini' : 'Summarize with Gemini'}</Button>
        <Button variant="secondary" disabled={!segments.length} onClick={() => void exportToChatGpt()}><MessageSquare size={16} />{t('openInChatGPT')}</Button>
        <Button variant="secondary" onClick={() => exportText(transcription, segments, [])}><Download size={16} />TXT</Button>
        <Button variant="secondary" onClick={() => { try { printPdf(transcription, segments, []); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open PDF.'); } }}><Download size={16} />PDF</Button>
        <button type="button" className="icon-button" aria-label={t('delete')} onClick={() => void deleteTranscription()}><Trash2 /></button>
      </div>
    </header>
    {error && <div role="alert" className="banner banner-error">{error}</div>}
    {transcription.status === 'failed' && <Card>
      <strong>{t('failed')}</strong><p>{transcription.error || 'Transcription failed, but your audio is still saved locally.'}</p>
      <Button onClick={() => void store.retryTranscription(id).catch((reason) => setError(String(reason)))}><RotateCcw size={16} />{t('retry')}</Button>
    </Card>}
    {(transcription.status === 'processing' || transcription.status === 'queued') && <Card>
      <strong>{transcription.stage || t('processing')}</strong><p>{transcription.progress ?? 0}%</p>
      <p className="muted">Keep this tab open when using the hosted audio processor. The original file remains locally available for retry.</p>
    </Card>}
    {segments.length > 0 && <p className="muted" role="note">{store.settings.locale === 'he' ? 'סיכום Gemini שולח את תוכן התמלול לעיבוד בענן רק בלחיצה. פתיחה ב-ChatGPT מעתיקה את התמלול ללוח ואינה שולחת אותו אוטומטית.' : 'Gemini sends transcript text to Google only when requested. ChatGPT export copies text to your clipboard; paste it yourself.'}</p>}
    {transcription.summary && <Card className="summary-view">
      <h2>{t('summary')}</h2><p dir="auto">{transcription.summary}</p>
    </Card>}
    <Card>
      <div className="section-heading"><div><h2>{t('transcript')}</h2><p>Speaker labels and timestamps can be corrected below. Cloud Whisper does not automatically identify different speakers.</p></div></div>
      {mediaUrl && <div className="media-controls"><audio ref={player} controls src={mediaUrl} preload="metadata" /></div>}
      {segments.length ? <div className="transcript-view">
        {segments.map((segment) => <article className="segment-row" key={segment.id}>
          <button type="button" className="timestamp-button" onClick={() => playFrom(segment.startMs)} aria-label={`Play at ${formatTimestamp(segment.startMs)}`}><Play size={13} />{formatTimestamp(segment.startMs)}</button>
          <div className="segment-content">
            {editing === segment.id ? <>
              <Field label="Speaker"><input value={speaker} onChange={(event) => setSpeaker(event.target.value)} dir="auto" /></Field>
              <Field label="Transcript text"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} dir="auto" /></Field>
              <div className="inline-actions">
                <Button busy={saving} onClick={() => void saveSegment(segment.id)}><Check size={15} />{t('save')}</Button>
                <Button variant="secondary" onClick={() => setEditing('')}><X size={15} />{t('cancel')}</Button>
              </div>
            </> : <>
              <div className="speaker-line"><strong>{segment.speakerLabel}</strong>{segment.edited && <span>{t('edited')}</span>}
                <button type="button" className="icon-button compact" aria-label={t('editSegment')} onClick={() => { setEditing(segment.id); setDraft(segment.text); setSpeaker(segment.speakerLabel); }}><Edit3 size={15} /></button>
              </div>
              <p dir="auto">{segment.text}</p>
            </>}
          </div>
        </article>)}
      </div> : <EmptyState title="No transcript segments yet" body={transcription.status === 'ready' ? 'No speech was found.' : 'Your transcript will appear after processing.'} />}
    </Card>
  </div>;
}
