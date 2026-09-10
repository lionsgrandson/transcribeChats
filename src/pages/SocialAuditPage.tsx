import { ExternalLink, FileText, MessageCircleMore, Search, ShieldCheck, Sparkles, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Field } from '../components/ui';
import { db } from '../data/db';
import type { SocialAuditAnalysis, SocialAuditEntry, SocialAuditObservation } from '../domain/learning';
import type { LanguageMode } from '../domain/types';
import { createId } from '../lib/id';
import { analyzeSocialAuditWithOllama, buildAuditChatGptPrompt, copyAndOpenChatGpt, parseSocialAuditChatGptResult, repairSocialAuditChatGptResult } from '../services/learning';
import { transcribeWithWorker } from '../services/worker';
import { useAppStore } from '../state/AppStore';

type SourceMode = 'existing' | 'upload' | 'text';
type AuditTab = 'overview' | 'emotional' | 'logical' | 'social' | 'patterns' | 'blindspots' | 'chatgpt';

function ObservationList({ values }: { values: SocialAuditObservation[] }) {
  if (!values.length) return <p className="empty-copy">No strong observations in this category.</p>;
  return <div className="audit-observations">{values.map((item, index) => <Card key={`${item.title}-${index}`} className="audit-observation">
    <div className="audit-confidence"><strong>{item.title}</strong><span>{Math.round(item.confidence * 100)}% confidence</span></div>
    <p>{item.interpretation}</p>
    {item.evidence.length > 0 && <><h4>Evidence from the conversation</h4><ul>{item.evidence.map((value, valueIndex) => <li key={valueIndex}>{value}</li>)}</ul></>}
    {item.alternatives.length > 0 && <><h4>Other plausible explanations</h4><ul>{item.alternatives.map((value, valueIndex) => <li key={valueIndex}>{value}</li>)}</ul></>}
  </Card>)}</div>;
}

export function SocialAuditPage() {
  const { settings, transcriptions, tSegments, workerReady, showToast } = useAppStore();
  const [entries, setEntries] = useState<SocialAuditEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [sessionRaw, setSessionRaw] = useState<Record<string, string>>({});
  const [sourceMode, setSourceMode] = useState<SourceMode>('existing');
  const [sourceId, setSourceId] = useState('');
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File>();
  const [languageMode, setLanguageMode] = useState<LanguageMode>(settings.languageMode);
  const [saveRaw, setSaveRaw] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<AuditTab>('overview');
  const [chatImportOpen, setChatImportOpen] = useState(false);
  const [chatResult, setChatResult] = useState('');
  const [chatImportError, setChatImportError] = useState<string>();
  const [chatImportBusy, setChatImportBusy] = useState(false);
  const [chatImportStage, setChatImportStage] = useState('');

  const reload = async () => {
    const values = await db.socialAudits.orderBy('updatedAt').reverse().toArray();
    setEntries(values);
    setSelectedId((current) => current && values.some((value) => value.id === current) ? current : values[0]?.id);
  };
  useEffect(() => { void reload(); }, []);

  const readyTranscripts = transcriptions.filter((item) => item.status === 'ready');
  const selected = entries.find((entry) => entry.id === selectedId);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => `${entry.title} ${entry.analysis.summary} ${entry.analysis.lessons.join(' ')}`.toLocaleLowerCase().includes(needle));
  }, [entries, query]);

  const createAudit = async () => {
    setBusy(true); setError(undefined); setProgress(0); setStage('Preparing conversation');
    try {
      let transcript = '';
      let sourceName = 'Pasted text';
      let resolvedTitle = title.trim();
      if (sourceMode === 'existing') {
        const source = readyTranscripts.find((item) => item.id === sourceId);
        if (!source) throw new Error('Choose a ready transcript first.');
        const segments = tSegments(source.id);
        if (!segments.length) throw new Error('That transcript has no text segments.');
        transcript = segments.map((segment) => `${segment.speakerLabel}: ${segment.text}`).join('\n');
        sourceName = `TranscribeChats · ${source.title}`;
        resolvedTitle ||= source.title;
        setProgress(70); setStage('Auditing conversation with Ollama');
      } else if (sourceMode === 'text') {
        if (!text.trim()) throw new Error('Paste a conversation first.');
        transcript = text.trim();
        resolvedTitle ||= 'Conversation audit';
        setProgress(70); setStage('Auditing conversation with Ollama');
      } else {
        if (!file) throw new Error('Choose an audio or video file first.');
        if (workerReady === false) throw new Error('The local transcription worker is not available. Start it before importing media.');
        sourceName = file.name;
        resolvedTitle ||= file.name.replace(/\.[^.]+$/, '');
        const result = await transcribeWithWorker(
          settings.workerUrl, file, file.name, languageMode, context, new Date().toISOString(),
          async (value, valueStage) => { setProgress(Math.min(65, Math.round(value * 0.65))); setStage(valueStage); },
          async () => undefined,
          undefined,
          false
        );
        transcript = result.segments.map((segment) => `${segment.speakerLabel}: ${segment.text}`).join('\n');
        setProgress(70); setStage('Auditing conversation with Ollama');
      }

      const analysis = await analyzeSocialAuditWithOllama(settings.workerUrl, { title: resolvedTitle, transcript, context });
      const now = new Date().toISOString();
      const id = createId();
      const entry: SocialAuditEntry = {
        id,
        title: analysis.title || resolvedTitle,
        sourceName,
        transcript: saveRaw ? transcript : undefined,
        analysis,
        createdAt: now,
        updatedAt: now
      };
      await db.socialAudits.add(entry);
      setSessionRaw((current) => ({ ...current, [id]: transcript }));
      await reload();
      setSelectedId(id);
      setProgress(100); setStage('Ready');
      showToast(saveRaw ? 'Conversation audit saved locally with its transcript.' : 'Audit saved locally. Raw transcript is kept only for this session.');
      setFile(undefined); setText(''); setTitle('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the conversation audit.');
    } finally {
      setBusy(false);
    }
  };

  const improveWithChatGpt = async () => {
    if (!selected) return;
    const raw = selected.transcript || sessionRaw[selected.id];
    if (!raw) return setError('The raw transcript was not saved. Re-import it if you want a ChatGPT second pass.');
    try {
      setChatImportOpen(true);
      setChatImportError(undefined);
      setChatImportStage('');
      await copyAndOpenChatGpt(buildAuditChatGptPrompt(selected.title, raw, selected.analysis));
      showToast('Audit and source transcript copied. Paste them into ChatGPT, then use Paste + apply when you copy the answer back.');
    } catch {
      setError('Could not copy the ChatGPT handoff. Your browser may have blocked clipboard access.');
    }
  };

  const saveStructuredChatGptAudit = async (analysis: SocialAuditAnalysis, rawOutput: string, now: string) => {
    if (!selected) return;
    await db.socialAudits.update(selected.id, {
      title: analysis.title || selected.title,
      analysis,
      updatedAt: now,
      chatGptRefinedAt: now,
      chatGptOutput: rawOutput
    });
  };

  const importChatGptResponse = async (value: string) => {
    if (!selected || chatImportBusy) return;
    const rawOutput = value.trim();
    if (!rawOutput) return setChatImportError('Paste the ChatGPT response first.');

    setChatImportBusy(true);
    setChatImportError(undefined);
    setChatImportStage('Checking ChatGPT response format');
    const now = new Date().toISOString();

    try {
      await db.socialAudits.update(selected.id, {
        updatedAt: now,
        chatGptRefinedAt: now,
        chatGptOutput: rawOutput
      });

      let analysis: SocialAuditAnalysis;
      let repairedLocally = false;
      try {
        analysis = parseSocialAuditChatGptResult(rawOutput);
      } catch {
        if (workerReady === false) throw new Error('The ChatGPT response was saved, but the local worker is offline so it could not be repaired into the structured audit tabs.');
        setChatImportStage('Formatting response locally with Ollama');
        analysis = await repairSocialAuditChatGptResult(settings.workerUrl, { title: selected.title, response: rawOutput });
        repairedLocally = true;
      }

      setChatImportStage('Applying refined conversation audit');
      await saveStructuredChatGptAudit(analysis, rawOutput, now);
      await reload();
      setChatResult('');
      setChatImportOpen(false);
      setTab('overview');
      showToast(repairedLocally
        ? 'ChatGPT response repaired locally and applied to the conversation audit.'
        : 'ChatGPT audit applied to the structured conversation audit.');
    } catch (reason) {
      await reload();
      setChatImportOpen(false);
      setTab('chatgpt');
      const message = reason instanceof Error ? reason.message : 'The structured import could not be completed.';
      showToast(`${message} The full ChatGPT response is still saved under the ChatGPT tab.`);
    } finally {
      setChatImportBusy(false);
      setChatImportStage('');
    }
  };

  const pasteAndApplyChatGptFromClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) throw new Error('Clipboard is empty.');
      setChatResult(value);
      await importChatGptResponse(value);
    } catch (reason) {
      setChatImportError(reason instanceof Error ? reason.message : 'Could not read the clipboard. You can paste into the box manually.');
    }
  };

  const applyChatGptResult = async () => {
    await importChatGptResponse(chatResult);
  };

  const removeSelected = async () => {
    if (!selected) return;
    await db.socialAudits.delete(selected.id);
    setSessionRaw((current) => { const next = { ...current }; delete next[selected.id]; return next; });
    await reload();
    showToast('Conversation audit deleted.');
  };

  const categoryValues = selected ? {
    emotional: selected.analysis.emotional,
    logical: selected.analysis.logical,
    social: selected.analysis.social,
    patterns: selected.analysis.habitsAndPatterns,
    blindspots: selected.analysis.possibleBlindSpots
  } : undefined;

  return <div className="page learning-page">
    <header className="page-header learning-header">
      <div><span className="eyebrow">Communication learning</span><h1>Conversation Audit</h1><p>Review a real conversation for emotional, logical and social patterns, then turn the useful observations into things you can practice.</p></div>
      <div className="learning-kpi"><MessageCircleMore /><strong>{entries.length}</strong><span>audits</span></div>
    </header>

    <div className="learning-layout">
      <aside className="learning-library">
        <div className="learning-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search audits…" /></div>
        <div className="library-list">
          {filtered.map((entry) => <button key={entry.id} className={`library-entry ${entry.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(entry.id)}>
            <MessageCircleMore size={18} /><span><small>{new Date(entry.createdAt).toLocaleDateString()}{entry.chatGptRefinedAt ? ' · ChatGPT refined' : ''}</small><strong>{entry.title}</strong></span>
          </button>)}
          {!filtered.length && <p className="empty-copy">No conversation audits match this search.</p>}
        </div>
      </aside>

      <section className="learning-main">
        <Card className="learning-create-card">
          <div className="learning-card-title"><ShieldCheck /><div><strong>Audit a conversation</strong><span>Local Ollama looks for evidence and alternatives. It should not diagnose people or pretend to know hidden intent.</span></div></div>
          <div className="learning-source-tabs">
            <button className={sourceMode === 'existing' ? 'active' : ''} onClick={() => setSourceMode('existing')}><MessageCircleMore size={16} />Existing transcript</button>
            <button className={sourceMode === 'upload' ? 'active' : ''} onClick={() => setSourceMode('upload')}><UploadCloud size={16} />Audio / video</button>
            <button className={sourceMode === 'text' ? 'active' : ''} onClick={() => setSourceMode('text')}><FileText size={16} />Paste conversation</button>
          </div>
          <div className="form-grid two-columns">
            {sourceMode === 'existing' && <Field label="Transcript"><select value={sourceId} onChange={(event) => { setSourceId(event.target.value); const source = readyTranscripts.find((item) => item.id === event.target.value); if (source && !title) setTitle(source.title); }}><option value="">Choose transcript…</option>{readyTranscripts.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>}
            {sourceMode === 'upload' && <Field label="Media file"><input type="file" accept="audio/*,video/*,.mp3,.m4a,.mp4,.mov,.wav,.webm" onChange={(event) => { const next = event.target.files?.[0]; setFile(next); if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, '')); }} /></Field>}
            {sourceMode === 'upload' && <Field label="Language"><select value={languageMode} onChange={(event) => setLanguageMode(event.target.value as LanguageMode)}><option value="auto">Auto</option><option value="en">English</option><option value="he">Hebrew</option><option value="mixed">Mixed Hebrew / English</option></select></Field>}
            <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Conversation with Alex — project disagreement" /></Field>
            <Field label="Context" hint="Optional factual context only: relationship, setting, what happened before."><input value={context} onChange={(event) => setContext(event.target.value)} placeholder="Work conversation · first disagreement about scope" /></Field>
          </div>
          {sourceMode === 'text' && <Field label="Conversation"><textarea className="learning-textarea" value={text} onChange={(event) => setText(event.target.value)} placeholder="Speaker 1: …\nSpeaker 2: …" /></Field>}
          <label className="privacy-toggle"><input type="checkbox" checked={saveRaw} onChange={(event) => setSaveRaw(event.target.checked)} /><span><strong>Save the raw transcript in the local audit library</strong><small>Off by default. The derived audit is saved either way.</small></span></label>
          {(busy || progress > 0) && <div className="learning-progress"><div><span>{stage}</span><strong>{progress}%</strong></div><progress max="100" value={progress} /></div>}
          {error && <div className="banner banner-error">{error}</div>}
          <div className="form-actions"><Button busy={busy} onClick={() => void createAudit()}><Sparkles size={17} />Transcribe + audit conversation</Button></div>
        </Card>

        {selected ? <div className="learning-result audit-result">
          <div className="learning-result-head"><div><small>{selected.sourceName}{selected.chatGptRefinedAt ? ' · ChatGPT refined' : ''}</small><h2>{selected.title}</h2><p>{selected.analysis.summary}</p></div><div className="learning-result-actions"><Button variant="secondary" onClick={() => void improveWithChatGpt()}><ExternalLink size={16} />Second pass with ChatGPT</Button><Button variant="secondary" onClick={() => { setChatImportOpen(true); setChatImportError(undefined); setChatImportStage(''); }}>Paste ChatGPT result</Button><Button variant="ghost" onClick={() => void removeSelected()}>Delete</Button></div></div>

          {chatImportOpen && <Card className="chatgpt-import-card">
            <div className="learning-card-title"><Sparkles /><div><strong>Bring the ChatGPT second pass back into this audit</strong><span>Paste the full response. If its formatting is messy, the local Ollama worker repairs it into the exact audit structure automatically, while the original ChatGPT response is always saved.</span></div></div>
            <textarea className="learning-textarea" value={chatResult} disabled={chatImportBusy} onChange={(event) => { setChatResult(event.target.value); setChatImportError(undefined); }} placeholder="Paste the full ChatGPT response here…" />
            {chatImportBusy && <div className="learning-progress"><div><span>{chatImportStage}</span><strong>Working…</strong></div><progress /></div>}
            {chatImportError && <div className="banner banner-error">{chatImportError}</div>}
            <div className="form-actions"><Button variant="ghost" disabled={chatImportBusy} onClick={() => { setChatImportOpen(false); setChatImportError(undefined); setChatImportStage(''); }}>Cancel</Button><Button variant="secondary" busy={chatImportBusy} onClick={() => void pasteAndApplyChatGptFromClipboard()}>Paste + apply from clipboard</Button><Button busy={chatImportBusy} onClick={() => void applyChatGptResult()}>Apply pasted response</Button></div>
          </Card>}

          <div className="learning-tabs">{(['overview','emotional','logical','social','patterns','blindspots'] as AuditTab[]).map((value) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{value}</button>)}{selected.chatGptOutput && <button className={tab === 'chatgpt' ? 'active' : ''} onClick={() => setTab('chatgpt')}>ChatGPT</button>}</div>

          {tab === 'overview' && <div className="learning-content-grid">
            <Card><h3>What worked</h3><ul>{selected.analysis.strengths.map((item, index) => <li key={index}>{item}</li>)}</ul></Card>
            <Card><h3>Lessons</h3><ul>{selected.analysis.lessons.map((item, index) => <li key={index}>{item}</li>)}</ul></Card>
            <Card><h3>Social norms worth learning</h3>{selected.analysis.socialNormsWorthLearning.map((item, index) => <div className="audit-norm" key={index}><strong>{item.norm}</strong><p>{item.whyItMatters}</p><small>Example: {item.example}</small></div>)}</Card>
            <Card><h3>Things to try next time</h3>{selected.analysis.experiments.map((item, index) => <div className="audit-norm" key={index}><strong>{item.title}</strong><p>{item.action}</p><small>Notice: {item.whatToNotice}</small></div>)}</Card>
            <Card><h3>Reflection questions</h3><ul>{selected.analysis.reflectionQuestions.map((item, index) => <li key={index}>{item}</li>)}</ul></Card>
            <Card><h3>What the transcript cannot tell us</h3><ul>{selected.analysis.uncertaintyNotes.map((item, index) => <li key={index}>{item}</li>)}</ul></Card>
          </div>}
          {tab !== 'overview' && tab !== 'chatgpt' && categoryValues && <ObservationList values={categoryValues[tab]} />}
          {tab === 'chatgpt' && <Card><h3>ChatGPT second pass</h3><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', lineHeight: 1.6, margin: 0 }}>{selected.chatGptOutput || 'No ChatGPT response has been saved for this audit yet.'}</pre></Card>}
        </div> : <Card className="learning-empty"><MessageCircleMore size={42} /><h2>Build a private communication library</h2><p>Each audit separates what was actually said from possible interpretations, then gives you norms, lessons and small experiments to learn from.</p></Card>}
      </section>
    </div>
  </div>;
}
