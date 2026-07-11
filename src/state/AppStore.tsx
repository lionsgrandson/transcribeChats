/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, defaultSettings } from '../data/db';
import { demoItems, demoSegments, demoTranscription } from '../data/demo';
import type {
  AnalysisResult,
  AppSettings,
  ExtractedItem,
  LanguageMode,
  LocalMediaAsset,
  Transcription,
  TranscriptionNote,
  TranscriptSegment
} from '../domain/types';
import { createId } from '../lib/id';
import { analyzeText } from '../services/analysis';
import { checkWorker, transcribeWithWorker } from '../services/worker';

interface AppStoreValue {
  loading: boolean;
  error?: string;
  online: boolean;
  workerReady: boolean | null;
  settings: AppSettings;
  transcriptions: Transcription[];
  segments: TranscriptSegment[];
  items: ExtractedItem[];
  notes: TranscriptionNote[];
  toast?: string;
  tSegments: (transcriptionId: string) => TranscriptSegment[];
  tItems: (transcriptionId: string) => ExtractedItem[];
  tNotes: (transcriptionId: string) => TranscriptionNote[];
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  createManual: (input: { title: string; text: string; languageMode: LanguageMode; context: string; recordedAt: string }) => Promise<string>;
  processMedia: (input: { title: string; blob: Blob; filename: string; languageMode: LanguageMode; context: string; recordedAt: string; sourceType: 'upload' | 'recording' }) => Promise<string>;
  retryTranscription: (id: string) => Promise<void>;
  updateTranscription: (id: string, patch: Partial<Transcription>) => Promise<void>;
  updateSegment: (id: string, text: string, speakerLabel?: string) => Promise<void>;
  updateItem: (id: string, patch: Partial<ExtractedItem>) => Promise<void>;
  addItem: (transcriptionId: string, item: Partial<ExtractedItem> & Pick<ExtractedItem, 'kind' | 'title'>) => Promise<void>;
  importItems: (transcriptionId: string, values: AnalysisResult['items']) => Promise<void>;
  addNote: (transcriptionId: string, body: string) => Promise<void>;
  deleteTranscription: (id: string) => Promise<void>;
  runAnalysis: (id: string) => Promise<void>;
  loadDemo: () => Promise<void>;
  clearData: () => Promise<void>;
  sync: () => Promise<void>;
  refreshWorker: () => Promise<void>;
  showToast: (message: string) => void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

function makeItems(transcriptionId: string, result: AnalysisResult): ExtractedItem[] {
  const now = new Date().toISOString();
  return result.items.map((item) => ({ ...item, id: createId(), transcriptionId, createdAt: now, updatedAt: now }));
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [online, setOnline] = useState(navigator.onLine);
  const [workerReady, setWorkerReady] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [notes, setNotes] = useState<TranscriptionNote[]>([]);
  const [toast, setToast] = useState<string>();

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 3600);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [storedSettings, storedTranscriptions, storedSegments, storedItems, storedNotes] = await Promise.all([
        db.settings.get('settings'), db.transcriptions.orderBy('updatedAt').reverse().toArray(),
        db.segments.toArray(), db.items.toArray(), db.notes.toArray()
      ]);
      setSettings(storedSettings || defaultSettings);
      setTranscriptions(storedTranscriptions);
      setSegments(storedSegments);
      setItems(storedItems);
      setNotes(storedNotes);
      if (!storedSettings) await db.settings.put(defaultSettings);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load local data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);
  useEffect(() => {
    document.documentElement.lang = settings.locale;
    document.documentElement.dir = settings.locale === 'he' ? 'rtl' : 'ltr';
  }, [settings.locale]);
  useEffect(() => {
    if (!settings.remindersEnabled || !('Notification' in window)) return;
    const notify = () => {
      const now = Date.now();
      items.filter((item) => item.reminderAt && item.status !== 'completed').forEach((item) => {
        const reminder = new Date(item.reminderAt!).getTime();
        if (reminder <= now && reminder > now - 60_000 && Notification.permission === 'granted') {
          new Notification(item.title, { body: item.dueAt ? `Due ${new Date(item.dueAt).toLocaleString()}` : undefined });
        }
      });
    };
    const timer = window.setInterval(notify, 30_000);
    return () => window.clearInterval(timer);
  }, [items, settings.remindersEnabled]);

  const refreshWorker = useCallback(async () => {
    setWorkerReady(null);
    setWorkerReady(await checkWorker(settings.workerUrl));
  }, [settings.workerUrl]);
  useEffect(() => { void refreshWorker(); }, [refreshWorker]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    await db.settings.put(next);
    setSettings(next);
  }, [settings]);

  const persistAnalysis = useCallback(async (transcriptionId: string, analysis: AnalysisResult) => {
    const created = makeItems(transcriptionId, analysis);
    await db.transaction('rw', db.transcriptions, db.items, async () => {
      await db.transcriptions.update(transcriptionId, { summary: analysis.summary, updatedAt: new Date().toISOString() });
      if (created.length) await db.items.bulkAdd(created);
    });
    return created;
  }, []);

  const createManual = useCallback(async ({ title, text, languageMode, context, recordedAt }: { title: string; text: string; languageMode: LanguageMode; context: string; recordedAt: string }) => {
    const id = createId();
    const now = new Date().toISOString();
    const lines = text.split(/\n+/).map((value) => value.trim()).filter(Boolean);
    const createdSegments: TranscriptSegment[] = lines.map((line, index) => ({
      id: createId(), transcriptionId: id, sequenceNo: index, speakerLabel: 'Speaker 1',
      startMs: index * 10_000, endMs: (index + 1) * 10_000, text: line, originalText: line,
      language: /[\u0590-\u05FF]/.test(line) ? 'he' : 'en', edited: false
    }));
    const result = analyzeText(text, new Date(recordedAt), createdSegments.map((segment) => segment.id));
    const transcription: Transcription = {
      id, title: title || lines[0]?.slice(0, 60) || 'Manual conversation', sourceType: 'manual', status: 'ready',
      languageMode, detectedLanguages: [...new Set(createdSegments.map((segment) => segment.language))],
      recordedAt, createdAt: now, updatedAt: now, durationMs: createdSegments.length * 10_000,
      context, summary: result.summary, synced: false
    };
    const createdItems = makeItems(id, result);
    await db.transaction('rw', db.transcriptions, db.segments, db.items, async () => {
      await db.transcriptions.add(transcription);
      if (createdSegments.length) await db.segments.bulkAdd(createdSegments);
      if (createdItems.length) await db.items.bulkAdd(createdItems);
    });
    await reload();
    showToast('Conversation analyzed and saved locally.');
    return id;
  }, [reload, showToast]);

  const processExistingMedia = useCallback(async (transcription: Transcription, media: LocalMediaAsset) => {
    try {
      await db.transcriptions.update(transcription.id, { status: 'processing', progress: 10, stage: 'Preparing', error: undefined, updatedAt: new Date().toISOString() });
      await reload();
      const result = await transcribeWithWorker(settings.workerUrl, media.blob, media.filename, transcription.languageMode, transcription.context || '', transcription.recordedAt, async (progress, stage) => {
        await db.transcriptions.update(transcription.id, { progress, stage, updatedAt: new Date().toISOString() });
        setTranscriptions((current) => current.map((value) => value.id === transcription.id ? { ...value, progress, stage } : value));
      });
      const createdSegments = result.segments.map((segment) => ({ ...segment, transcriptionId: transcription.id }));
      await db.transaction('rw', db.transcriptions, db.segments, async () => {
        await db.segments.where('transcriptionId').equals(transcription.id).delete();
        if (createdSegments.length) await db.segments.bulkAdd(createdSegments);
        await db.transcriptions.update(transcription.id, {
          status: 'ready', progress: 100, stage: 'Ready', durationMs: result.durationMs,
          detectedLanguages: result.detectedLanguages, updatedAt: new Date().toISOString(), synced: false
        });
      });
      const analysis = result.analysis || analyzeText(createdSegments.map((segment) => segment.text).join(' '), new Date(transcription.recordedAt), createdSegments.map((segment) => segment.id));
      await persistAnalysis(transcription.id, analysis);
      await reload();
      showToast('Transcription is ready.');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Transcription failed.';
      await db.transcriptions.update(transcription.id, { status: 'failed', progress: 0, stage: 'Failed', error: message, updatedAt: new Date().toISOString() });
      await reload();
      showToast('Transcription failed. The recording is still saved locally.');
    }
  }, [persistAnalysis, reload, settings.workerUrl, showToast]);

  const processMedia = useCallback(async ({ title, blob, filename, languageMode, context, recordedAt, sourceType }: { title: string; blob: Blob; filename: string; languageMode: LanguageMode; context: string; recordedAt: string; sourceType: 'upload' | 'recording' }) => {
    const id = createId();
    const now = new Date().toISOString();
    const transcription: Transcription = {
      id, title: title || filename.replace(/\.[^.]+$/, ''), sourceType, status: 'queued', languageMode,
      detectedLanguages: [], recordedAt, createdAt: now, updatedAt: now, context, progress: 0, stage: 'Queued', synced: false
    };
    const media: LocalMediaAsset = { id: createId(), transcriptionId: id, filename, mimeType: blob.type || 'application/octet-stream', size: blob.size, blob, createdAt: now };
    await db.transaction('rw', db.transcriptions, db.media, async () => { await db.transcriptions.add(transcription); await db.media.add(media); });
    await reload();
    void processExistingMedia(transcription, media);
    return id;
  }, [processExistingMedia, reload]);

  const retryTranscription = useCallback(async (id: string) => {
    const transcription = await db.transcriptions.get(id);
    const media = await db.media.where('transcriptionId').equals(id).first();
    if (!transcription || !media) throw new Error('The local media file is missing.');
    await processExistingMedia(transcription, media);
  }, [processExistingMedia]);

  const updateTranscription = useCallback(async (id: string, patch: Partial<Transcription>) => {
    await db.transcriptions.update(id, { ...patch, updatedAt: new Date().toISOString(), synced: false });
    await reload();
  }, [reload]);
  const updateSegment = useCallback(async (id: string, text: string, speakerLabel?: string) => {
    await db.segments.update(id, { text, speakerLabel, edited: true });
    await reload();
  }, [reload]);
  const updateItem = useCallback(async (id: string, patch: Partial<ExtractedItem>) => {
    await db.items.update(id, { ...patch, updatedAt: new Date().toISOString() });
    await reload();
  }, [reload]);
  const addItem = useCallback(async (transcriptionId: string, item: Partial<ExtractedItem> & Pick<ExtractedItem, 'kind' | 'title'>) => {
    const now = new Date().toISOString();
    await db.items.add({
      id: createId(), transcriptionId, kind: item.kind, title: item.title, body: item.body,
      status: item.status || 'open', priority: item.priority || 'none', assignee: item.assignee,
      startsAt: item.startsAt, endsAt: item.endsAt, dueAt: item.dueAt, reminderAt: item.reminderAt,
      tags: item.tags || [], sourceSegmentIds: item.sourceSegmentIds || [], confidence: item.confidence ?? 1,
      uncertaintyReason: item.uncertaintyReason, confirmed: item.confirmed ?? true, createdAt: now, updatedAt: now
    });
    await reload();
  }, [reload]);
  const importItems = useCallback(async (transcriptionId: string, values: AnalysisResult['items']) => {
    const created = makeItems(transcriptionId, values.length ? { summary: '', items: values } : { summary: '', items: [] });
    if (created.length) await db.items.bulkAdd(created);
    await reload();
    showToast(`${created.length} items imported.`);
  }, [reload, showToast]);
  const addNote = useCallback(async (transcriptionId: string, body: string) => {
    const now = new Date().toISOString();
    await db.notes.add({ id: createId(), transcriptionId, body, createdAt: now, updatedAt: now });
    await reload();
  }, [reload]);
  const deleteTranscription = useCallback(async (id: string) => {
    await db.transaction('rw', db.transcriptions, db.segments, db.items, db.notes, db.media, async () => {
      await Promise.all([
        db.transcriptions.delete(id), db.segments.where('transcriptionId').equals(id).delete(),
        db.items.where('transcriptionId').equals(id).delete(), db.notes.where('transcriptionId').equals(id).delete(),
        db.media.where('transcriptionId').equals(id).delete()
      ]);
    });
    await reload();
    showToast('Transcription deleted.');
  }, [reload, showToast]);
  const runAnalysis = useCallback(async (id: string) => {
    const transcription = await db.transcriptions.get(id);
    const values = await db.segments.where('transcriptionId').equals(id).sortBy('sequenceNo');
    if (!transcription) return;
    const result = analyzeText(values.map((segment) => segment.text).join(' '), new Date(transcription.recordedAt), values.map((segment) => segment.id));
    await persistAnalysis(id, result);
    await reload();
    showToast('Analysis completed.');
  }, [persistAnalysis, reload, showToast]);
  const loadDemo = useCallback(async () => {
    await db.transaction('rw', db.transcriptions, db.segments, db.items, async () => {
      await db.transcriptions.put(demoTranscription); await db.segments.bulkPut(demoSegments); await db.items.bulkPut(demoItems);
    });
    await reload();
    showToast('Demo workspace loaded.');
  }, [reload, showToast]);
  const clearData = useCallback(async () => {
    await db.transaction('rw', db.transcriptions, db.segments, db.items, db.notes, db.media, async () => {
      await Promise.all([db.transcriptions.clear(), db.segments.clear(), db.items.clear(), db.notes.clear(), db.media.clear()]);
    });
    await reload();
    showToast('Local data cleared.');
  }, [reload, showToast]);
  const sync = useCallback(async () => {
    const { pullFromSupabase, syncToSupabase } = await import('../services/supabase');
    const media = await db.media.toArray();
    await syncToSupabase(transcriptions, segments, items, notes, media);
    const cloud = await pullFromSupabase();
    await db.transaction('rw', db.transcriptions, db.segments, db.items, db.notes, async () => {
      if (cloud.transcriptions.length) await db.transcriptions.bulkPut(cloud.transcriptions);
      if (cloud.segments.length) await db.segments.bulkPut(cloud.segments);
      if (cloud.items.length) await db.items.bulkPut(cloud.items);
      if (cloud.notes.length) await db.notes.bulkPut(cloud.notes);
    });
    const timestamp = new Date().toISOString();
    await db.transcriptions.toCollection().modify({ synced: true });
    await updateSettings({ lastSyncAt: timestamp });
    await reload();
    showToast('All local changes are synced.');
  }, [items, notes, reload, segments, showToast, transcriptions, updateSettings]);

  const tSegments = useCallback((id: string) => segments.filter((segment) => segment.transcriptionId === id).sort((a, b) => a.sequenceNo - b.sequenceNo), [segments]);
  const tItems = useCallback((id: string) => items.filter((item) => item.transcriptionId === id), [items]);
  const tNotes = useCallback((id: string) => notes.filter((note) => note.transcriptionId === id), [notes]);

  const value = useMemo<AppStoreValue>(() => ({
    loading, error, online, workerReady, settings, transcriptions, segments, items, notes, toast,
    tSegments, tItems, tNotes, updateSettings, createManual, processMedia, retryTranscription,
    updateTranscription, updateSegment, updateItem, addItem, importItems, addNote, deleteTranscription,
    runAnalysis, loadDemo, clearData, sync, refreshWorker, showToast
  }), [loading, error, online, workerReady, settings, transcriptions, segments, items, notes, toast,
    tSegments, tItems, tNotes, updateSettings, createManual, processMedia, retryTranscription,
    updateTranscription, updateSegment, updateItem, addItem, importItems, addNote, deleteTranscription,
    runAnalysis, loadDemo, clearData, sync, refreshWorker, showToast]);

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const value = useContext(AppStoreContext);
  if (!value) throw new Error('useAppStore must be used inside AppStoreProvider.');
  return value;
}
