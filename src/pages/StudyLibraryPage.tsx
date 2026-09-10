import { BookOpen, BrainCircuit, CheckCircle2, ExternalLink, FileText, FolderTree, RefreshCw, Search, Sparkles, UploadCloud, Video, Youtube } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { InteractiveQuestionSet, TopicLearningLinks } from '../components/StudyCourseTools';
import { Button, Card, Field } from '../components/ui';
import { db } from '../data/db';
import type { StudyAnalysis, StudyEntry, StudyQuestion } from '../domain/learning';
import type { LanguageMode } from '../domain/types';
import { createId } from '../lib/id';
import { analyzeStudyWithOllama, buildStudyChatGptPrompt, copyAndOpenChatGpt, importYouTubeTranscript, parseStudyChatGptResult, repairStudyChatGptResult } from '../services/learning';
import { transcribeWithWorker } from '../services/worker';
import { useAppStore } from '../state/AppStore';

type SourceMode = 'existing' | 'upload' | 'youtube' | 'text';
type StudyTab = 'learn' | 'flashcards' | 'quiz' | 'test' | 'tasks' | 'review' | 'chatgpt';

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
  const [tab, setTab] = useState<StudyTab>('learn');
  const [chatImportOpen, setChatImportOpen] = useState(false);
  const [chatResult, setChatResult] = useState('');
  const [chatImportError, setChatImportError] = useState<string>();
  const [chatImportBusy, setChatImportBusy] = useState(false);
  const [chatImportStage, setChatImportStage] = useState('');

  const reload = async () => {
    const values = (await db.studyEntries.orderBy('updatedAt').reverse().toArray()).map(normalizeEntry);
    setEntries(values);
    setSelectedId((current) => current && values.some((value) => value.id === current) ? current : values[0]?.id);
  };

  useEffect(() => { void reload(); }, []);

  const readyTranscripts = transcriptions.filter((item) => item.status === 'ready');
  const selected = entries.find((entry) => entry.id === selectedId);
  const reviewQuestions = selected
    ? [...selected.analysis.quiz, ...selected.analysis.test].filter((question) => selected.questionResults[question.id] === 'incorrect')
    : [];
  const reviewTopicIds = new Set(reviewQuestions.map((question) => question.topicId));
  const reviewTopics = selected ? selected.analysis.topics.filter((topic) => reviewTopicIds.has(topic.id)) : [];

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
        setProgress(70); setStage('Building full interactive course with Ollama');
      } else if (sourceMode === 'text') {
        if (!text.trim()) throw new Error('Paste study material first.');
        transcript = text.trim();
        resolvedTitle ||= 'Study notes';
        setProgress(70); setStage('Building full interactive course with Ollama');
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
        setStage(result.method === 'captions' ? 'YouTube captions loaded · building interactive course' : 'YouTube audio transcribed with Whisper · building interactive course');
      } else {
        if (!file) throw new Error('Choose a video or audio file first.');
        if (workerReady === false) throw new Error('The local transcription worker is not available. Start it before importing media.');
        sourceName = file.name;
        resolvedTitle ||= file.name.replace(/\.[^.]+$/, '');
        const result = await transcribeWithWorker(
          settings.workerUrl,
          file,
          file.name,
          languageMode,
          context,
          new Date().toISOString(),
          async (value, valueStage) => {
            setProgress(Math.min(65, Math.round(value * 0.65)));
            setStage(valueStage);
          },
          async () => undefined,
          undefined,
          false
        );
        transcript = result.segments.map((segment) => `${segment.speakerLabel}: ${segment.text}`).join('\n');
        setProgress(70); setStage('Building full interactive course with Ollama');
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
      setTab('learn');
      setProgress(100); setStage('Ready');
      showToast('Full interactive learning course created and indexed locally.');
      setFile(undefined); setYoutubeUrl(''); setText(''); setTitle(''); setPathText('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the study course.');
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
    if (result === 'incorrect') showToast('Incorrect. Added to Review with the related lesson and explanation.');
    else showToast('Correct.');
  };

  const rebuildFullCourse = async () => {
    if (!selected || busy) return;
    setBusy(true); setError(undefined); setProgress(65); setStage('Rebuilding a complete interactive course from the saved transcript');
    try {
      const analysis = await analyzeStudyWithOllama(settings.workerUrl, {
        title: selected.title,
        transcript: selected.transcript,
        context: 'Rebuild this as a self-contained course that can be learned without returning to the source video. Make quiz and test fully interactive multiple choice assessments. Preserve source grounding and provide complete learning, flashcards, quiz, test, and practice.'
      });
      const validTopics = new Set(analysis.topics.map((item) => item.id));
      const validTasks = new Set(analysis.tasks.map((item) => item.id));
      const validQuestions = new Set([...analysis.quiz, ...analysis.test].map((item) => item.id));
      const preservedQuestionResults = Object.fromEntries(
        Object.entries(selected.questionResults).filter(([id]) => validQuestions.has(id))
      ) as Record<string, 'correct' | 'incorrect'>;
      await db.studyEntries.update(selected.id, {
        title: analysis.title || selected.title,
        analysis,
        masteredTopicIds: selected.masteredTopicIds.filter((id) => validTopics.has(id)),
        completedTaskIds: selected.completedTaskIds.filter((id) => validTasks.has(id)),
        questionResults: preservedQuestionResults,
        updatedAt: new Date().toISOString()
      });
      await reload();
      setTab('learn');
      setProgress(100); setStage('Ready');
      showToast('Rebuilt as a complete interactive learning course.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rebuild the full course.');
    } finally {
      setBusy(false);
    }
  };

  const improveWithChatGpt = async () => {
    if (!selected) return;
    try {
      setChatImportOpen(true);
      setChatImportError(undefined);
      setChatImportStage('');
      await copyAndOpenChatGpt(buildStudyChatGptPrompt(selected.title, selected.transcript, selected.analysis));
      showToast('Full study context copied. Paste it into ChatGPT, then use Paste + apply when you copy the answer back.');
    } catch {
      setError('Could not copy the ChatGPT handoff. Your browser may have blocked clipboard access.');
    }
  };

  const saveStructuredChatGptStudy = async (analysis: StudyAnalysis, rawOutput: string, now: string) => {
    if (!selected) return;
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
      await db.studyEntries.update(selected.id, {
        updatedAt: now,
        lastReviewedAt: now,
        chatGptRefinedAt: now,
        chatGptOutput: rawOutput
      });

      let analysis: StudyAnalysis;
      let repairedLocally = false;
      try {
        analysis = parseStudyChatGptResult(rawOutput);
      } catch {
        if (workerReady === false) throw new Error('The ChatGPT response was saved, but the local worker is offline so it could not be repaired into the structured study tabs.');
        setChatImportStage('Formatting response locally with Ollama');
        analysis = await repairStudyChatGptResult(settings.workerUrl, { title: selected.title, response: rawOutput });
        repairedLocally = true;
      }

      setChatImportStage('Applying refined study pack');
      await saveStructuredChatGptStudy(analysis, rawOutput, now);
      await reload();
      setChatResult('');
      setChatImportOpen(false);
      setTab('learn');
      showToast(repairedLocally
        ? 'ChatGPT response repaired locally and applied to the study course.'
        : 'ChatGPT study pass applied to the structured study course.');
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

  const removeSelected = async () => {
    if (!selected) return;
    await db.studyEntries.delete(selected.id);
    await reload();
    showToast('Study entry deleted.');
  };

  const renderQuestions = (questions: StudyQuestion[], mode: 'quiz' | 'test') => {
    if (!selected) return null;
    return <InteractiveQuestionSet
      entry={selected}
      questions={questions}
      mode={mode}
      onMark={markQuestion}
      onRebuild={() => void rebuildFullCourse()}
    />;
  };

  return <div className="page learning-page">
    <header className="page-header learning-header">
      <div><span className="eyebrow">Learning system</span><h1>Study Library</h1><p>Turn lectures, courses, YouTube videos, transcripts and notes into complete self-contained courses you can learn from directly.</p></div>
      <div className="learning-kpi"><BrainCircuit /><strong>{entries.length}</strong><span>study packs</span></div>
    </header>

    <div className="learning-layout">
      <aside className="learning-library">
        <div className="learning-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Java, classes, inheritance…" /></div>
        <div className="library-list">
          {filtered.map((entry) => <button key={entry.id} className={`library-entry ${entry.id === selectedId ? 'active' : ''}`} onClick={() => { setSelectedId(entry.id); setTab('learn'); }}>
            <FolderTree size={18} /><span><small>{entry.path.join(' / ') || 'Unsorted'} · {masteryPercent(entry)}%</small><strong>{entry.title}</strong></span>
          </button>)}
          {!filtered.length && <p className="empty-copy">No study packs match this search.</p>}
        </div>
      </aside>

      <section className="learning-main">
        <Card className="learning-create-card">
          <div className="learning-card-title"><Sparkles /><div><strong>Create a full learning course</strong><span>Ollama runs locally. The result teaches the transcript first, then builds flashcards, an interactive quiz, an interactive full test, practice, and review.</span></div></div>
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
          <div className="form-actions"><Button busy={busy} onClick={() => void createStudyPack()}><UploadCloud size={17} />{sourceMode === 'upload' ? 'Transcribe + build full course' : sourceMode === 'youtube' ? 'Import YouTube + build full course' : 'Build full course'}</Button></div>
        </Card>

        {selected ? <div className="learning-result">
          <div className="learning-result-head">
            <div>
              <small>{selected.path.join(' / ') || 'Unsorted'}{selected.chatGptRefinedAt ? ' · ChatGPT refined' : ''}</small>
              <h2>{selected.title}</h2>
              <p>{selected.analysis.overview}</p>
              <div className="mastery-summary"><span><strong>{masteryPercent(selected)}%</strong> mastered</span><progress max="100" value={masteryPercent(selected)} /></div>
            </div>
            <div className="learning-result-actions">
              <Button variant="secondary" busy={busy} onClick={() => void rebuildFullCourse()}><RefreshCw size={16} />Rebuild full course</Button>
              <Button variant="secondary" onClick={() => void improveWithChatGpt()}><ExternalLink size={16} />Second pass with ChatGPT</Button>
              <Button variant="secondary" onClick={() => { setChatImportOpen(true); setChatImportError(undefined); setChatImportStage(''); }}>Paste ChatGPT result</Button>
              <Button variant="ghost" onClick={() => void removeSelected()}>Delete</Button>
            </div>
          </div>

          {chatImportOpen && <Card className="chatgpt-import-card">
            <div className="learning-card-title"><Sparkles /><div><strong>Bring the ChatGPT second pass back into this study course</strong><span>Paste the full response. If its formatting is messy, the local Ollama worker repairs it into the exact study structure automatically, while the original ChatGPT response is always saved.</span></div></div>
            <textarea className="learning-textarea" value={chatResult} disabled={chatImportBusy} onChange={(event) => { setChatResult(event.target.value); setChatImportError(undefined); }} placeholder="Paste the full ChatGPT response here…" />
            {chatImportBusy && <div className="learning-progress"><div><span>{chatImportStage}</span><strong>Working…</strong></div><progress /></div>}
            {chatImportError && <div className="banner banner-error">{chatImportError}</div>}
            <div className="form-actions">
              <Button variant="ghost" disabled={chatImportBusy} onClick={() => { setChatImportOpen(false); setChatImportError(undefined); setChatImportStage(''); }}>Cancel</Button>
              <Button variant="secondary" busy={chatImportBusy} onClick={() => void pasteAndApplyChatGptFromClipboard()}>Paste + apply from clipboard</Button>
              <Button busy={chatImportBusy} onClick={() => void importChatGptResponse(chatResult)}>Apply pasted response</Button>
            </div>
          </Card>}

          <div className="learning-tabs">
            <button className={tab === 'learn' ? 'active' : ''} onClick={() => setTab('learn')}>Learn</button>
            <button className={tab === 'flashcards' ? 'active' : ''} onClick={() => setTab('flashcards')}>Flashcards ({selected.analysis.flashcards.length})</button>
            <button className={tab === 'quiz' ? 'active' : ''} onClick={() => setTab('quiz')}>Quiz ({selected.analysis.quiz.length})</button>
            <button className={tab === 'test' ? 'active' : ''} onClick={() => setTab('test')}>Test ({selected.analysis.test.length})</button>
            <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>Practice ({selected.analysis.tasks.length})</button>
            <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>Review ({reviewQuestions.length})</button>
            {selected.chatGptOutput && <button className={tab === 'chatgpt' ? 'active' : ''} onClick={() => setTab('chatgpt')}>ChatGPT</button>}
          </div>

          {tab === 'learn' && <div className="learning-content-grid">
            <Card><h3>How to use this course</h3><p>Start here and learn the material in order. The notes are meant to replace ordinary rewatching of the source. After you understand the lessons, move to Flashcards, then the interactive Quiz, then the full interactive Test. Practice is for applying what you already learned.</p></Card>
            <Card><h3>Learning objectives</h3><ul>{selected.analysis.learningObjectives.map((item, index) => <li key={index}>{item}</li>)}</ul></Card>
            {selected.analysis.topics.map((topic) => {
              const learned = selected.masteredTopicIds.includes(topic.id);
              return <Card key={topic.id} className={`topic-card ${learned ? 'is-mastered' : ''}`}>
                <div className="study-card-status"><small>{topic.parentId ? `Under ${topic.parentId}` : 'Core topic'}</small><button onClick={() => void toggleTopic(topic.id)}>{learned ? <CheckCircle2 size={15} /> : null}{learned ? 'Learned' : 'Mark learned'}</button></div>
                <h3>{topic.title}</h3>
                <p style={{ whiteSpace: 'pre-line' }}>{topic.summary}</p>
                {topic.prerequisites.length > 0 && <><h4>Learn first</h4><ul>{topic.prerequisites.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
                <h4>Key points</h4><ul>{topic.keyPoints.map((item, index) => <li key={index}>{item}</li>)}</ul>
                {topic.examples.length > 0 && <><h4>Examples</h4><ul>{topic.examples.map((item, index) => <li key={index}><span style={{ whiteSpace: 'pre-line' }}>{item}</span></li>)}</ul></>}
                {topic.commonMistakes.length > 0 && <><h4>Common mistakes</h4><ul>{topic.commonMistakes.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
                <TopicLearningLinks courseTitle={selected.title} topicTitle={topic.title} />
              </Card>;
            })}
          </div>}

          {tab === 'flashcards' && (selected.analysis.flashcards.length > 0 ? <>
            <Card><h3>Flashcards</h3><p>Use these after reading Learn. Try to answer before opening each card.</p></Card>
            <div className="flashcard-grid">{selected.analysis.flashcards.map((card) => <details key={card.id} className="flashcard"><summary><small>{card.difficulty} · {card.topicId}</small><strong>{card.front}</strong><span>Reveal answer</span></summary><p>{card.back}</p></details>)}</div>
          </> : <Card><h3>No flashcards were generated</h3><p>This pack is incomplete. Use <strong>Rebuild full course</strong> above to regenerate it from the saved transcript.</p></Card>)}

          {tab === 'quiz' && renderQuestions(selected.analysis.quiz, 'quiz')}
          {tab === 'test' && renderQuestions(selected.analysis.test, 'test')}

          {tab === 'tasks' && <div className="learning-content-grid">
            <Card><h3>Practice after learning</h3><p>These are application exercises, not the lesson itself. Finish Learn first, then use Practice to prove you can actually use the material.</p></Card>
            {selected.analysis.tasks.length > 0 ? selected.analysis.tasks.map((task) => {
              const done = selected.completedTaskIds.includes(task.id);
              return <Card key={task.id} className={done ? 'is-mastered' : ''}><div className="study-card-status"><small>{task.difficulty} · {task.topicId}</small><button onClick={() => void toggleTask(task.id)}>{done ? <CheckCircle2 size={15} /> : null}{done ? 'Completed' : 'Mark completed'}</button></div><h3>{task.title}</h3><p style={{ whiteSpace: 'pre-line' }}>{task.instruction}</p><strong>Done when:</strong><p style={{ whiteSpace: 'pre-line' }}>{task.successCriteria}</p></Card>;
            }) : <Card><p>No practice exercises were generated for this pack. Rebuild the full course to regenerate them.</p></Card>}
          </div>}

          {tab === 'review' && <div className="learning-content-grid">
            {reviewQuestions.length === 0 ? <Card><h3>Review queue is clear</h3><p>When you answer a quiz or test question incorrectly, its lesson and question appear here automatically. Mark it understood later and it disappears from this queue.</p></Card> : <>
              <Card><h3>{reviewQuestions.length} item{reviewQuestions.length === 1 ? '' : 's'} need review</h3><p>Relearn the related lesson below, then retry the questions. This queue is driven by your interactive quiz and test results.</p></Card>
              {reviewTopics.map((topic) => <Card key={topic.id}><h3>Relearn: {topic.title}</h3><p style={{ whiteSpace: 'pre-line' }}>{topic.summary}</p><h4>Key points</h4><ul>{topic.keyPoints.map((item, index) => <li key={index}>{item}</li>)}</ul>{topic.examples.length > 0 && <><h4>Examples</h4><ul>{topic.examples.map((item, index) => <li key={index}>{item}</li>)}</ul></>}<TopicLearningLinks courseTitle={selected.title} topicTitle={topic.title} /></Card>)}
              {reviewQuestions.map((question) => <Card key={question.id} className="question-card result-incorrect"><small>{question.topicId} · {question.difficulty}</small><h3>{question.prompt}</h3><div className="answer-block"><strong>Correct answer</strong><p style={{ whiteSpace: 'pre-line' }}>{question.answer}</p><strong>Explanation</strong><p style={{ whiteSpace: 'pre-line' }}>{question.explanation}</p><Button onClick={() => void markQuestion(question.id, 'correct')}>I know this now</Button></div></Card>)}
            </>}
          </div>}

          {tab === 'chatgpt' && <Card><h3>ChatGPT second pass</h3><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', lineHeight: 1.6, margin: 0 }}>{selected.chatGptOutput || 'No ChatGPT response has been saved for this study pack yet.'}</pre></Card>}
        </div> : <Card className="learning-empty"><BrainCircuit size={42} /><h2>Your course library starts here</h2><p>Create the first course above. It will teach the material first, then give you flashcards, an interactive quiz, a full interactive test, practice exercises, and a review queue.</p></Card>}
      </section>
    </div>
  </div>;
}
