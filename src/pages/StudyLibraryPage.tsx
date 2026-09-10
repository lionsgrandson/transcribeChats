import { BookOpen, BrainCircuit, CheckCircle2, ExternalLink, FileText, FolderTree, Search, Sparkles, UploadCloud, Video, Youtube } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Field } from '../components/ui';
import { db } from '../data/db';
import type { StudyEntry } from '../domain/learning';
import type { LanguageMode } from '../domain/types';
import { createId } from '../lib/id';
import { analyzeStudyWithOllama, buildStudyChatGptPrompt, copyAndOpenChatGpt, importYouTubeTranscript, parseStudyChatGptResult } from '../services/learning';
import { transcribeWithWorker } from '../services/worker';
import { useAppStore } from '../state/AppStore';

type SourceMode = 'existing' | 'upload' | 'youtube' | 'text';
type StudyTab = 'notes' | 'tasks' | 'flashcards' | 'quiz' | 'test' | 'chatgpt';

function parsePath(value: string): string[] {
  return value.split(/[>/\\]+/).map((part) => part.trim()).filter(Boolean);
}

function isSupportedMedia(candidate: File): boolean {
  return candidate.type.startsWith('audio/') || candidate.type.startsWith('video/') || /\.(mp3|m4a|mp4|mov|wav|webm|mpeg|mpga|ogg|flac)$/i.test(candidate.name);
}

function normalizeEntry(entry: StudyEntry): StudyEntry {
  return {
    ...entry,
    masteredTopicIds: entry.masteredTopicIds || [],
    completedTaskIds: entry.completedTaskIds || [],
    questionResults: entry.questionResults || {}
  };
}

function masteryPercent(entry: StudyEntry): number {
  const questions = [...entry.analysis.quiz, ...entry.analysis.test];
  const total = entry.analysis.topics.length + entry.analysis.tasks.length + questions.length;
  if (!total) return 0;
  const correctQuestions = questions.filter((question) => entry.questionResults?.[question.id] === 'correct').length;
  const done = (entry.masteredTopicIds?.length || 0) + (entry.completedTaskIds?.length || 0) + correctQuestions;
  return Math.min(100, Math.round((done / total) * 100));
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
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [languageMode, setLanguageMode] = useState<LanguageMode>(settings.languageMode);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<StudyTab>('notes');
  const [chatImportOpen, setChatImportOpen] = useState(false);
  const [chatResult, setChatResult] = useState('');
  const [chatImportError, setChatImportError] = useState<string>();

  const reload = async () => {
    const values = (await db.studyEntries.orderBy('updatedAt').reverse().toArray()).map(normalizeEntry);
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

  const chooseMedia = (candidate?: File) => {
    setError(undefined);
    if (!candidate) return setFile(undefined);
    if (!isSupportedMedia(candidate)) {
      setFile(undefined);
      return setError('Choose a supported video or audio file. Video: MP4, MOV, WebM, MPEG. Audio: MP3, M4A, WAV, OGG, FLAC.');
    }
    if (candidate.size > 2 * 1024 * 1024 * 1024) {
      setFile(undefined);
      return setError('The selected video/audio file is larger than the 2 GB local worker limit.');
    }
    setFile(candidate);
    if (!title) setTitle(candidate.name.replace(/\.[^.]+$/, ''));
  };

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
      } else if (sourceMode === 'youtube') {
        if (!youtubeUrl.trim()) throw new Error('Paste a YouTube link first.');
        if (workerReady === false) throw new Error('The local transcription worker is not available. Start it before importing YouTube.');
        setProgress(15); setStage('Checking YouTube captions');
        const result = await importYouTubeTranscript(settings.workerUrl, {
          url: youtubeUrl.trim(),
          languageMode,
          context
        });
        transcript = result.transcript;
        sourceName = result.sourceName;
        resolvedTitle ||= result.title;
        setProgress(70);
        setStage(result.method === 'captions' ? 'YouTube captions loaded · building study pack with Ollama' : 'YouTube audio transcribed with Whisper · building study pack with Ollama');
      } else {
        if (!file) throw new Error('Choose a video or audio file first.');
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
      const manualPath = parsePath(pathText);
      const entry: StudyEntry = {
        id: createId(),
        title: analysis.title || resolvedTitle,
        path: manualPath.length ? manualPath : analysis.suggestedPath,
        sourceName,
        transcript,
        analysis,
        masteredTopicIds: [],
        completedTaskIds: [],
        questionResults: {},
        createdAt: now,
        updatedAt: now
      };
      await db.studyEntries.add(entry);
      await reload();
      setSelectedId(entry.id);
      setProgress(100); setStage('Ready');
      showToast('Study pack created and indexed locally.');
      setFile(undefined); setYoutubeUrl(''); setText(''); setTitle(''); setPathText('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the study pack.');
    } finally {
      setBusy(false);
    }
  };

  const patchSelected = async (patch: Partial<StudyEntry>) => {
    if (!selected) return;
    const now = new Date().toISOString();
    await db.studyEntries.update(selected.id, { ...patch, updatedAt: now, lastReviewedAt: now });
    await reload();
  };

  const toggleTopic = async (topicId: string) => {
    if (!selected) return;
    const values = selected.masteredTopicIds.includes(topicId)
      ? selected.masteredTopicIds.filter((id) => id !== topicId)
      : [...selected.masteredTopicIds, topicId];
    await patchSelected({ masteredTopicIds: values });
  };

  const toggleTask = async (taskId: string) => {
    if (!selected) return;
    const values = selected.completedTaskIds.includes(taskId)
      ? selected.completedTaskIds.filter((id) => id !== taskId)
      : [...selected.completedTaskIds, taskId];
    await patchSelected({ completedTaskIds: values });
  };

  const markQuestion = async (questionId: string, result: 'correct' | 'incorrect') => {
    if (!selected) return;
    await patchSelected({ questionResults: { ...selected.questionResults, [questionId]: result } });
  };

  const improveWithChatGpt = async () => {
    if (!selected) return;
    try {
      setChatImportOpen(true);
      setChatImportError(undefined);
      await copyAndOpenChatGpt(buildStudyChatGptPrompt(selected.title, selected.transcript, selected.analysis));
      showToast('Full study context copied. Paste it into ChatGPT, then paste the full ChatGPT response back here.');
    } catch {
      setError('Could not copy the ChatGPT handoff. Your browser may have blocked clipboard access.');
    }
  };

  const pasteChatGptFromClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) throw new Error('Clipboard is empty.');
      setChatResult(value);
      setChatImportError(undefined);
    } catch (reason) {
      setChatImportError(reason instanceof Error ? reason.message : 'Could not read the clipboard. You can paste into the box manually.');
    }
  };

  const applyChatGptResult = async () => {
    if (!selected) return;
    const rawOutput = chatResult.trim();
    if (!rawOutput) return setChatImportError('Paste the ChatGPT response first.');
    const now = new Date().toISOString();
    let structuredImported = false;

    try {
      const analysis = parseStudyChatGptResult(rawOutput);
      const validTopics = new Set(analysis.topics.map((item) => item.id));
      const validTasks = new Set(analysis.tasks.map((item) => item.id));
      const validQuestions = new Set([...analysis.quiz, ...analysis.test].map((item) => item.id));
      const preservedQuestionResults = Object.fromEntries(
        Object.entries(selected.questionResults).filter(([id]) => validQuestions.has(id))
      ) as Record<string, 'correct' | 'incorrect'>;
      await db.studyEntries.update(selected.id, {
        title: analysis.title || selected.title,
        path: selected.path.length ? selected.path : analysis.suggestedPath,
        analysis,
        masteredTopicIds: selected.masteredTopicIds.filter((id) => validTopics.has(id)),
        completedTaskIds: selected.completedTaskIds.filter((id) => validTasks.has(id)),
        questionResults: preservedQuestionResults,
        updatedAt: now,
        lastReviewedAt: now,
        chatGptRefinedAt: now,
        chatGptOutput: rawOutput
      });
      structuredImported = true;
    } catch {
      await db.studyEntries.update(selected.id, {
        updatedAt: now,
        lastReviewedAt: now,
        chatGptRefinedAt: now,
        chatGptOutput: rawOutput
      });
    }

    await reload();
    setChatResult('');
    setChatImportOpen(false);
    setChatImportError(undefined);
    setTab('chatgpt');
    showToast(structuredImported
      ? 'ChatGPT study pass imported and the full response was saved.'
      : 'ChatGPT response saved exactly as pasted. The structured Ollama pack was left unchanged.');
  };

  const removeSelected = async () => {
    if (!selected) return;
    await db.studyEntries.delete(selected.id);
    await reload();
    showToast('Study entry deleted.');
  };

  return <div className="page learning-page">
    <header className="page-header learning-header">
      <div><span className="eyebrow">Learning system</span><h1>Study Library</h1><p>Turn lectures, courses, YouTube videos, transcripts and notes into a structured library you can actually learn from.</p></div>
      <div className="learning-kpi"><BrainCircuit /><strong>{entries.length}</strong><span>study packs</span></div>
    </header>

    <div className="learning-layout">
      <aside className="learning-library">
        <div className="learning-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Java, classes, inheritance…" /></div>
        <div className="library-list">
          {filtered.map((entry) => <button key={entry.id} className={`library-entry ${entry.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(entry.id)}>
            <FolderTree size={18} /><span><small>{entry.path.join(' / ') || 'Unsorted'} · {masteryPercent(entry)}%</small><strong>{entry.title}</strong></span>
          </button>)}
          {!filtered.length && <p className="empty-copy">No study packs match this search.</p>}
        </div>
      </aside>

      <section className="learning-main">
        <Card className="learning-create-card">
          <div className="learning-card-title"><Sparkles /><div><strong>Create a study pack</strong><span>Ollama runs locally. Use an existing transcript, upload video/audio, paste a YouTube link, or paste notes.</span></div></div>
          <div className="learning-source-tabs">
            <button className={sourceMode === 'existing' ? 'active' : ''} onClick={() => setSourceMode('existing')}><BookOpen size={16} />Existing transcript</button>
            <button className={sourceMode === 'upload' ? 'active' : ''} onClick={() => setSourceMode('upload')}><Video size={16} />Video / audio</button>
            <button className={sourceMode === 'youtube' ? 'active' : ''} onClick={() => setSourceMode('youtube')}><Youtube size={16} />YouTube link</button>
            <button className={sourceMode === 'text' ? 'active' : ''} onClick={() => setSourceMode('text')}><FileText size={16} />Paste text</button>
          </div>
          <div className="form-grid two-columns">
            {sourceMode === 'existing' && <Field label="Transcript"><select value={sourceId} onChange={(event) => { setSourceId(event.target.value); const source = readyTranscripts.find((item) => item.id === event.target.value); if (source && !title) setTitle(source.title); }}><option value="">Choose transcript…</option>{readyTranscripts.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>}
            {sourceMode === 'upload' && <Field label="Video or audio file" hint="Video: MP4, MOV, WebM, MPEG · Audio: MP3, M4A, WAV, OGG, FLAC"><input type="file" accept="video/mp4,video/quicktime,video/webm,video/mpeg,audio/*,.mp4,.mov,.webm,.mpeg,.mp3,.m4a,.wav,.ogg,.flac" onChange={(event) => chooseMedia(event.target.files?.[0])} /></Field>}
            {sourceMode === 'youtube' && <Field label="YouTube link" hint="Single video links only. Captions are used first; Whisper is the automatic fallback."><input type="url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></Field>}
            {(sourceMode === 'upload' || sourceMode === 'youtube') && <Field label="Language"><select value={languageMode} onChange={(event) => setLanguageMode(event.target.value as LanguageMode)}><option value="auto">Auto</option><option value="en">English</option><option value="he">Hebrew</option><option value="mixed">Mixed Hebrew / English</option></select></Field>}
            <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Java — Classes lesson 3" /></Field>
            <Field label="Library path" hint="Optional. Ollama can suggest it."><input value={pathText} onChange={(event) => setPathText(event.target.value)} placeholder="Java / Classes / Inheritance" /></Field>
          </div>
          {sourceMode === 'upload' && file && <div className="selected-learning-media"><Video size={20} /><div><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB · {file.type.startsWith('video/') ? 'Video' : 'Audio'}</span></div><button type="button" onClick={() => setFile(undefined)}>Remove</button></div>}
          {sourceMode === 'youtube' && <div className="youtube-study-note"><Youtube size={20} /><div><strong>Fast path first</strong><span>If the video has usable captions, the app imports those directly. If not, it downloads only the audio with yt-dlp and transcribes it locally with Whisper.</span></div></div>}
          {sourceMode === 'text' && <Field label="Study material"><textarea className="learning-textarea" value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste lecture transcript, notes, course material…" /></Field>}
          <Field label="Context" hint="Optional: course name, lecturer terms, what you are trying to master."><input value={context} onChange={(event) => setContext(event.target.value)} placeholder="Course: Java fundamentals · Focus: OOP and exam preparation" /></Field>
          {(busy || progress > 0) && <div className="learning-progress"><div><span>{stage}</span><strong>{progress}%</strong></div><progress max="100" value={progress} /></div>}
          {error && <div className="banner banner-error">{error}</div>}
          <div className="form-actions"><Button busy={busy} onClick={() => void createStudyPack()}><UploadCloud size={17} />{sourceMode === 'upload' ? 'Transcribe video/audio + build study pack' : sourceMode === 'youtube' ? 'Import YouTube + build study pack' : 'Build learning pack'}</Button></div>
        </Card>

        {selected ? <div className="learning-result">
          <div className="learning-result-head"><div><small>{selected.path.join(' / ') || 'Unsorted'}{selected.chatGptRefinedAt ? ' · ChatGPT refined' : ''}</small><h2>{selected.title}</h2><p>{selected.analysis.overview}</p><div className="mastery-summary"><span><strong>{masteryPercent(selected)}%</strong> mastered</span><progress max="100" value={masteryPercent(selected)} /></div></div><div className="learning-result-actions"><Button variant="secondary" onClick={() => void improveWithChatGpt()}><ExternalLink size={16} />Second pass with ChatGPT</Button><Button variant="secondary" onClick={() => { setChatImportOpen(true); setChatImportError(undefined); }}>Paste ChatGPT result</Button><Button variant="ghost" onClick={() => void removeSelected()}>Delete</Button></div></div>

          {chatImportOpen && <Card className="chatgpt-import-card">
            <div className="learning-card-title"><Sparkles /><div><strong>Bring the ChatGPT second pass back into this study pack</strong><span>Paste the full ChatGPT response here. The app always saves it. If it is valid structured JSON, the study pack is updated too; otherwise the existing structured pack stays untouched.</span></div></div>
            <textarea className="learning-textarea" value={chatResult} onChange={(event) => { setChatResult(event.target.value); setChatImportError(undefined); }} placeholder="Paste the full ChatGPT response here…" />
            {chatImportError && <div className="banner banner-error">{chatImportError}</div>}
            <div className="form-actions"><Button variant="ghost" onClick={() => { setChatImportOpen(false); setChatImportError(undefined); }}>Cancel</Button><Button variant="secondary" onClick={() => void pasteChatGptFromClipboard()}>Paste from clipboard</Button><Button onClick={() => void applyChatGptResult()}>Save ChatGPT response</Button></div>
          </Card>}

          <div className="learning-tabs">{(['notes','tasks','flashcards','quiz','test'] as StudyTab[]).map((value) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{value}</button>)}{selected.chatGptOutput && <button className={tab === 'chatgpt' ? 'active' : ''} onClick={() => setTab('chatgpt')}>ChatGPT</button>}</div>

          {tab === 'notes' && <div className="learning-content-grid">
            <Card><h3>Learning objectives</h3><ul>{selected.analysis.learningObjectives.map((item, index) => <li key={index}>{item}</li>)}</ul></Card>
            {selected.analysis.topics.map((topic) => { const learned = selected.masteredTopicIds.includes(topic.id); return <Card key={topic.id} className={`topic-card ${learned ? 'is-mastered' : ''}`}><div className="study-card-status"><small>{topic.parentId ? `Under ${topic.parentId}` : 'Core topic'}</small><button onClick={() => void toggleTopic(topic.id)}>{learned ? <CheckCircle2 size={15} /> : null}{learned ? 'Learned' : 'Mark learned'}</button></div><h3>{topic.title}</h3><p>{topic.summary}</p><h4>Key points</h4><ul>{topic.keyPoints.map((item, index) => <li key={index}>{item}</li>)}</ul>{topic.commonMistakes.length > 0 && <><h4>Common mistakes</h4><ul>{topic.commonMistakes.map((item, index) => <li key={index}>{item}</li>)}</ul></>}</Card>; })}
          </div>}
          {tab === 'tasks' && <div className="learning-content-grid">{selected.analysis.tasks.map((task) => { const done = selected.completedTaskIds.includes(task.id); return <Card key={task.id} className={done ? 'is-mastered' : ''}><div className="study-card-status"><small>{task.difficulty} · {task.topicId}</small><button onClick={() => void toggleTask(task.id)}>{done ? <CheckCircle2 size={15} /> : null}{done ? 'Completed' : 'Mark completed'}</button></div><h3>{task.title}</h3><p>{task.instruction}</p><strong>Done when:</strong><p>{task.successCriteria}</p></Card>; })}</div>}
          {tab === 'flashcards' && <div className="flashcard-grid">{selected.analysis.flashcards.map((card) => <details key={card.id} className="flashcard"><summary><small>{card.difficulty}</small><strong>{card.front}</strong><span>Reveal answer</span></summary><p>{card.back}</p></details>)}</div>}
          {(tab === 'quiz' || tab === 'test') && <div className="question-list">{selected.analysis[tab].map((question, index) => { const result = selected.questionResults[question.id]; return <details key={question.id} className={`question-card ${result ? `result-${result}` : ''}`}><summary><span>{index + 1}</span><strong>{question.prompt}</strong><small>{result ? `${result} · ${question.difficulty}` : question.difficulty}</small></summary>{question.choices.length > 0 && <ol>{question.choices.map((choice) => <li key={choice}>{choice}</li>)}</ol>}<div className="answer-block"><strong>Answer</strong><p>{question.answer}</p><strong>Why</strong><p>{question.explanation}</p><div className="self-grade"><button onClick={() => void markQuestion(question.id, 'correct')}>I got it</button><button onClick={() => void markQuestion(question.id, 'incorrect')}>Needs review</button></div></div></details>; })}</div>}
          {tab === 'chatgpt' && <Card><h3>ChatGPT second pass</h3><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', lineHeight: 1.6, margin: 0 }}>{selected.chatGptOutput || 'No ChatGPT response has been saved for this study pack yet.'}</pre></Card>}
        </div> : <Card className="learning-empty"><BrainCircuit size={42} /><h2>Your course library starts here</h2><p>Create the first pack above. It will be indexed by subject and topic, with notes, tasks, flashcards, quizzes and tests together.</p></Card>}
      </section>
    </div>
  </div>;
}