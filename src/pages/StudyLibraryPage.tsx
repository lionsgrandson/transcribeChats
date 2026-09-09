import { BookOpen, BrainCircuit, ExternalLink, FileText, FolderTree, Search, Sparkles, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Field } from '../components/ui';
import { db } from '../data/db';
import type { StudyEntry } from '../domain/learning';
import type { LanguageMode } from '../domain/types';
import { createId } from '../lib/id';
import { analyzeStudyWithOllama, buildStudyChatGptPrompt, copyAndOpenChatGpt } from '../services/learning';
import { transcribeWithWorker } from '../services/worker';
import { useAppStore } from '../state/AppStore';

type SourceMode = 'existing' | 'upload' | 'text';
type StudyTab = 'notes' | 'tasks' | 'flashcards' | 'quiz' | 'test';

function parsePath(value: string): string[] {
  return value.split(/[>\/\\]+/).map((part) => part.trim()).filter(Boolean);
}

export function StudyLibraryPage() {
  const { settings, transcriptions, tSegments, workerReady, showToast } = useAppStore();
  const [entries, setEntries] = useState<StudyEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [sourceMode, setSourceMode] = useState<SourceMode>('existing');
  const [sourceId, setSourceId] = useState('');
  const [title, setTitle] = useState('');
  const [pathText, setPathText] = useState('');
  const [context, setContext] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File>();
  const [languageMode, setLanguageMode] = useState<LanguageMode>(settings.languageMode);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<StudyTab>('notes');

  const reload = async () => {
    const values = await db.studyEntries.orderBy('updatedAt').reverse().toArray();
    setEntries(values);
    setSelectedId((current) => current && values.some((value) => value.id === current) ? current : values[0]?.id);
  };
  useEffect(() => { void reload(); }, []);

  const readyTranscripts = transcriptions.filter((item) => item.status === 'ready');
  const selected = entries.find((entry) => entry.id === selectedId);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => `${entry.path.join(' ')} ${entry.title} ${entry.analysis.overview}`.toLocaleLowerCase().includes(needle));
  }, [entries, query]);

  const createStudyPack = async () => {
    setBusy(true); setError(undefined); setProgress(0); setStage('Preparing source');
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
        setProgress(70); setStage('Building study pack with Ollama');
      } else if (sourceMode === 'text') {
        if (!text.trim()) throw new Error('Paste study material first.');
        transcript = text.trim();
        resolvedTitle ||= 'Study notes';
        setProgress(70); setStage('Building study pack with Ollama');
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
        setProgress(70); setStage('Building study pack with Ollama');
      }

      const analysis = await analyzeStudyWithOllama(settings.workerUrl, { title: resolvedTitle, transcript, context });
      const now = new Date().toISOString();
      const entry: StudyEntry = {
        id: createId(),
        title: analysis.title || resolvedTitle,
        path: parsePath(pathText).length ? parsePath(pathText) : analysis.suggestedPath,
        sourceName,
        transcript,
        analysis,
        createdAt: now,
        updatedAt: now
      };
      await db.studyEntries.add(entry);
      await reload();
      setSelectedId(entry.id);
      setProgress(100); setStage('Ready');
      showToast('Study pack created and indexed locally.');
      setFile(undefined); setText(''); setTitle(''); setPathText('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the study pack.');
    } finally {
      setBusy(false);
    }
  };

  const improveWithChatGpt = async () => {
    if (!selected) return;
    try {
      await copyAndOpenChatGpt(buildStudyChatGptPrompt(selected.title, selected.transcript, selected.analysis));
      showToast('Full study context copied. Paste it into the ChatGPT tab that opened.');
    } catch {
      setError('Could not copy the ChatGPT handoff. Your browser may have blocked clipboard access.');
    }
  };

  const removeSelected = async () => {
    if (!selected) return;
    await db.studyEntries.delete(selected.id);
    await reload();
    showToast('Study entry deleted.');
  };

  return <div className="page learning-page">
    <header className="page-header learning-header">
      <div><span className="eyebrow">Learning system</span><h1>Study Library</h1><p>Turn lectures, courses, videos, transcripts and notes into a structured library you can actually learn from.</p></div>
      <div className="learning-kpi"><BrainCircuit /><strong>{entries.length}</strong><span>study packs</span></div>
    </header>

    <div className="learning-layout">
      <aside className="learning-library">
        <div className="learning-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Java, classes, inheritance…" /></div>
        <div className="library-list">
          {filtered.map((entry) => <button key={entry.id} className={`library-entry ${entry.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(entry.id)}>
            <FolderTree size={18} /><span><small>{entry.path.join(' / ') || 'Unsorted'}</small><strong>{entry.title}</strong></span>
          </button>)}
          {!filtered.length && <p className="empty-copy">No study packs match this search.</p>}
        </div>
      </aside>

      <section className="learning-main">
        <Card className="learning-create-card">
          <div className="learning-card-title"><Sparkles /><div><strong>Create a study pack</strong><span>Ollama runs locally. Use an existing transcript or bring new material in.</span></div></div>
          <div className="learning-source-tabs">
            <button className={sourceMode === 'existing' ? 'active' : ''} onClick={() => setSourceMode('existing')}><BookOpen size={16} />Existing transcript</button>
            <button className={sourceMode === 'upload' ? 'active' : ''} onClick={() => setSourceMode('upload')}><UploadCloud size={16} />Audio / video</button>
            <button className={sourceMode === 'text' ? 'active' : ''} onClick={() => setSourceMode('text')}><FileText size={16} />Paste text</button>
          </div>
          <div className="form-grid two-columns">
            {sourceMode === 'existing' && <Field label="Transcript"><select value={sourceId} onChange={(event) => { setSourceId(event.target.value); const source = readyTranscripts.find((item) => item.id === event.target.value); if (source && !title) setTitle(source.title); }}><option value="">Choose transcript…</option>{readyTranscripts.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>}
            {sourceMode === 'upload' && <Field label="Media file"><input type="file" accept="audio/*,video/*,.mp3,.m4a,.mp4,.mov,.wav,.webm" onChange={(event) => { const next = event.target.files?.[0]; setFile(next); if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, '')); }} /></Field>}
            {sourceMode === 'upload' && <Field label="Language"><select value={languageMode} onChange={(event) => setLanguageMode(event.target.value as LanguageMode)}><option value="auto">Auto</option><option value="en">English</option><option value="he">Hebrew</option><option value="mixed">Mixed Hebrew / English</option></select></Field>}
            <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Java — Classes lesson 3" /></Field>
            <Field label="Library path" hint="Optional. Ollama can suggest it."><input value={pathText} onChange={(event) => setPathText(event.target.value)} placeholder="Java / Classes / Inheritance" /></Field>
          </div>
          {sourceMode === 'text' && <Field label="Study material"><textarea className="learning-textarea" value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste lecture transcript, notes, course material…" /></Field>}
          <Field label="Context" hint="Optional: course name, lecturer terms, what you are trying to master."><input value={context} onChange={(event) => setContext(event.target.value)} placeholder="Course: Java fundamentals · Focus: OOP and exam preparation" /></Field>
          {(busy || progress > 0) && <div className="learning-progress"><div><span>{stage}</span><strong>{progress}%</strong></div><progress max="100" value={progress} /></div>}
          {error && <div className="banner banner-error">{error}</div>}
          <div className="form-actions"><Button busy={busy} onClick={() => void createStudyPack()}><Sparkles size={17} />Transcribe + build learning pack</Button></div>
        </Card>

        {selected ? <div className="learning-result">
          <div className="learning-result-head"><div><small>{selected.path.join(' / ') || 'Unsorted'}</small><h2>{selected.title}</h2><p>{selected.analysis.overview}</p></div><div className="learning-result-actions"><Button variant="secondary" onClick={() => void improveWithChatGpt()}><ExternalLink size={16} />Improve with ChatGPT</Button><Button variant="ghost" onClick={() => void removeSelected()}>Delete</Button></div></div>
          <div className="learning-tabs">{(['notes','tasks','flashcards','quiz','test'] as StudyTab[]).map((value) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{value}</button>)}</div>

          {tab === 'notes' && <div className="learning-content-grid">
            <Card><h3>Learning objectives</h3><ul>{selected.analysis.learningObjectives.map((item, index) => <li key={index}>{item}</li>)}</ul></Card>
            {selected.analysis.topics.map((topic) => <Card key={topic.id} className="topic-card"><small>{topic.parentId ? `Under ${topic.parentId}` : 'Core topic'}</small><h3>{topic.title}</h3><p>{topic.summary}</p><h4>Key points</h4><ul>{topic.keyPoints.map((item, index) => <li key={index}>{item}</li>)}</ul>{topic.commonMistakes.length > 0 && <><h4>Common mistakes</h4><ul>{topic.commonMistakes.map((item, index) => <li key={index}>{item}</li>)}</ul></>}</Card>)}
          </div>}
          {tab === 'tasks' && <div className="learning-content-grid">{selected.analysis.tasks.map((task) => <Card key={task.id}><small>{task.difficulty} · {task.topicId}</small><h3>{task.title}</h3><p>{task.instruction}</p><strong>Done when:</strong><p>{task.successCriteria}</p></Card>)}</div>}
          {tab === 'flashcards' && <div className="flashcard-grid">{selected.analysis.flashcards.map((card) => <details key={card.id} className="flashcard"><summary><small>{card.difficulty}</small><strong>{card.front}</strong><span>Reveal answer</span></summary><p>{card.back}</p></details>)}</div>}
          {(tab === 'quiz' || tab === 'test') && <div className="question-list">{selected.analysis[tab].map((question, index) => <details key={question.id} className="question-card"><summary><span>{index + 1}</span><strong>{question.prompt}</strong><small>{question.difficulty}</small></summary>{question.choices.length > 0 && <ol>{question.choices.map((choice) => <li key={choice}>{choice}</li>)}</ol>}<div className="answer-block"><strong>Answer</strong><p>{question.answer}</p><strong>Why</strong><p>{question.explanation}</p></div></details>)}</div>}
        </div> : <Card className="learning-empty"><BrainCircuit size={42} /><h2>Your course library starts here</h2><p>Create the first pack above. It will be indexed by subject and topic, with notes, tasks, flashcards, quizzes and tests together.</p></Card>}
      </section>
    </div>
  </div>;
}
