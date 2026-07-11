import { AlertTriangle, FileAudio, Mic, Pause, Play, Square, Type, UploadCloud, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Field } from '../components/ui';
import type { LanguageMode } from '../domain/types';
import { useTranslation } from '../i18n/useTranslation';
import { formatDuration } from '../lib/format';
import { useAppStore } from '../state/AppStore';

type Mode = 'record' | 'upload' | 'text';

export function NewTranscriptionPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { settings, createManual, processMedia, workerReady } = useAppStore();
  const initial = params.get('mode');
  const [mode, setMode] = useState<Mode>(initial === 'record' || initial === 'upload' || initial === 'text' ? initial : 'record');
  const [title, setTitle] = useState('');
  const [languageMode, setLanguageMode] = useState<LanguageMode>(settings.languageMode);
  const [context, setContext] = useState('');
  const [recordedAt, setRecordedAt] = useState(new Date().toISOString().slice(0, 16));
  const [text, setText] = useState('');
  const [file, setFile] = useState<File>();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (!recording || paused) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording, paused]);
  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  const validMedia = (candidate: File) => candidate.type.startsWith('audio/') || candidate.type.startsWith('video/') || /\.(mp3|m4a|mp4|mov|wav|webm|mpeg)$/i.test(candidate.name);
  const selectFile = (candidate?: File) => {
    setError(undefined);
    if (!candidate) return;
    if (!validMedia(candidate)) return setError(t('unsupportedFile'));
    if (candidate.size > 2 * 1024 * 1024 * 1024) return setError(t('fileTooLarge'));
    setFile(candidate);
    if (!title) setTitle(candidate.name.replace(/\.[^.]+$/, ''));
  };

  const submitText = async () => {
    if (!text.trim()) return setError('Add conversation text before analyzing.');
    setBusy(true); setError(undefined);
    try {
      const id = await createManual({ title, text, languageMode, context, recordedAt: new Date(recordedAt).toISOString() });
      navigate(`/transcriptions/${id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save the conversation.'); }
    finally { setBusy(false); }
  };
  const submitFile = async () => {
    if (!file) return setError(t('unsupportedFile'));
    setBusy(true); setError(undefined);
    try {
      const id = await processMedia({ title, blob: file, filename: file.name, languageMode, context, recordedAt: new Date(recordedAt).toISOString(), sourceType: 'upload' });
      navigate(`/transcriptions/${id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save the file.'); }
    finally { setBusy(false); }
  };
  const startRecording = async () => {
    setError(undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorderRef.current = recorder;
      recorder.start(1000);
      setSeconds(0); setRecording(true); setPaused(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Microphone permission was denied.'); }
  };
  const togglePause = () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') { recorder.pause(); setPaused(true); }
    else if (recorder.state === 'paused') { recorder.resume(); setPaused(false); }
  };
  const stopRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setBusy(true);
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
    try {
      const id = await processMedia({ title: title || `Recording ${new Date().toLocaleDateString()}`, blob, filename: `recording-${Date.now()}.webm`, languageMode, context, recordedAt: new Date(recordedAt).toISOString(), sourceType: 'recording' });
      navigate(`/transcriptions/${id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save the recording.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="page page-narrow">
      <header className="page-header"><div><span className="eyebrow">{t('capture')}</span><h1>{t('newTranscript')}</h1><p>{t('newSubtitle')}</p></div></header>
      <div className="mode-tabs" role="tablist">
        <button className={mode === 'record' ? 'active' : ''} onClick={() => setMode('record')}><Mic />{t('record')}</button>
        <button className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')}><FileAudio />{t('upload')}</button>
        <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}><Type />{t('addText')}</button>
      </div>
      <Card className="new-card">
        <div className="form-grid two-columns">
          <Field label={t('title')}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Weekly check-in" /></Field>
          <Field label={t('conversationDate')}><input type="datetime-local" value={recordedAt} onChange={(event) => setRecordedAt(event.target.value)} /></Field>
          <Field label={t('language')}><select value={languageMode} onChange={(event) => setLanguageMode(event.target.value as LanguageMode)}><option value="auto">{t('autoDetect')}</option><option value="en">{t('english')}</option><option value="he">{t('hebrew')}</option><option value="mixed">{t('mixed')}</option></select></Field>
          <Field label={t('context')} hint={mode === 'text' ? 'Used by Ollama to understand names, roles, terminology, and intent. The pasted transcript itself is not rewritten.' : 'Whisper uses this as spelling/vocabulary guidance; Ollama uses it during analysis. Names are not automatically matched to individual voices.'}><input value={context} onChange={(event) => setContext(event.target.value)} placeholder="People: Dana, Noam · Terms: Acme, Q3 launch" dir="auto" /></Field>
        </div>
        <div className="capture-panel">
          {mode === 'record' && <div className="record-panel">
            <div className={`record-visual ${recording ? 'is-recording' : ''}`}><span className="record-pulse"><Mic /></span><strong>{recording ? formatDuration(seconds * 1000) : t('microphoneReady')}</strong><p>{recording ? (paused ? 'Recording paused. Your audio is safe.' : 'Recording and saving locally…') : t('recordingConsent')}</p></div>
            <div className="record-actions">{!recording ? <Button onClick={() => void startRecording()}><Mic size={18} />{t('startRecording')}</Button> : <><Button variant="secondary" onClick={togglePause}>{paused ? <Play size={18} /> : <Pause size={18} />}{paused ? t('resume') : t('pause')}</Button><Button variant="danger" busy={busy} onClick={() => void stopRecording()}><Square size={17} />{t('stopRecording')}</Button></>}</div>
          </div>}
          {mode === 'upload' && <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]); }}>
            {file ? <div className="selected-file"><FileAudio size={34} /><div><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB · {file.type || 'media'}</span></div><button className="icon-button" onClick={() => setFile(undefined)} aria-label="Remove file"><X /></button></div> : <><UploadCloud size={40} /><strong>{t('dropFile')}</strong><span>{t('supportedFormats')}</span><label className="button button-secondary file-button">{t('chooseFile')}<input type="file" accept="audio/*,video/*,.mp3,.m4a,.mp4,.mov,.wav" onChange={(event) => selectFile(event.target.files?.[0])} /></label></>}
          </div>}
          {mode === 'text' && <Field label={t('manualText')}><textarea className="manual-text" value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste a conversation or meeting notes…" dir="auto" /></Field>}
        </div>
        {mode !== 'text' && workerReady === false && <div className="banner banner-warning"><AlertTriangle size={18} /><span>{t('workerUnavailable')}</span></div>}
        {error && <div className="banner banner-error"><AlertTriangle size={18} /><span>{error}</span></div>}
        {mode !== 'record' && <div className="form-actions"><Button variant="ghost" onClick={() => navigate(-1)}>{t('cancel')}</Button><Button busy={busy} onClick={() => void (mode === 'text' ? submitText() : submitFile())}>{mode === 'text' ? t('processText') : 'Upload and transcribe'}</Button></div>}
      </Card>
    </div>
  );
}
