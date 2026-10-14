import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaultSettings } from '../data/db';
import type { ExtractedItem, Transcription } from '../domain/types';
import { AppStoreProvider, useAppStore } from './AppStore';

vi.mock('../services/worker', () => ({ checkWorker: vi.fn(async () => true), analyzeWithOllama: vi.fn(), analyzeSalesWithOllama: vi.fn(), transcribeWithWorker: vi.fn(), TranscriptionRateLimitError: class extends Error {} }));

const transcription: Transcription = { id: 't1', title: 'Meeting', sourceType: 'manual', status: 'ready', languageMode: 'en', detectedLanguages: ['en'], recordedAt: '2026-10-14T08:00:00Z', createdAt: '2026-10-14T08:00:00Z', updatedAt: '2026-10-14T08:00:00Z' };
const task = (id: string): ExtractedItem => ({ id, transcriptionId: 't1', kind: 'task', title: id, status: 'open', priority: 'none', confidence: .8, confirmed: true, tags: [], sourceSegmentIds: [], createdAt: transcription.createdAt, updatedAt: transcription.updatedAt });
beforeEach(async () => {
  await db.delete(); await db.open();
  await db.settings.put(defaultSettings); await db.transcriptions.put(transcription); await db.items.bulkPut([task('a'), task('b')]);
});
afterEach(async () => { cleanup(); await db.delete(); });

describe('persisted task mutations', () => {
  it('preserves rapid individual and bulk patches on the same records', async () => {
    const { result } = renderHook(useAppStore, { wrapper: AppStoreProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await Promise.all([
      result.current.updateItem('a', { priority: 'urgent' }),
      result.current.updateItems(['a', 'b'].map((id) => ({ id, patch: { status: 'completed', confirmed: true } }))),
      result.current.updateItem('a', { title: 'Updated title' })
    ]); });
    expect(await db.items.get('a')).toMatchObject({ status: 'completed', priority: 'urgent', title: 'Updated title' });
    expect(await db.items.get('b')).toMatchObject({ status: 'completed' });
    expect(result.current.items.find((value) => value.id === 'a')).toMatchObject({ status: 'completed', priority: 'urgent', title: 'Updated title' });
  });
  it('rolls back the entire bulk update when a selected record disappeared', async () => {
    const { result } = renderHook(useAppStore, { wrapper: AppStoreProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.updateItems([{ id: 'a', patch: { status: 'completed' } }, { id: 'missing', patch: { status: 'completed' } }])).rejects.toThrow('no longer exist');
    expect((await db.items.get('a'))?.status).toBe('open');
  });
  it('merges rapid settings edits against persistence instead of a stale render', async () => {
    const { result } = renderHook(useAppStore, { wrapper: AppStoreProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await Promise.all([result.current.updateSettings({ locale: 'he' }), result.current.updateSettings({ crmBaseUrl: 'https://crm.example/' })]); });
    expect(await db.settings.get('settings')).toMatchObject({ locale: 'he', crmBaseUrl: 'https://crm.example/' });
    expect(document.documentElement.dir).toBe('rtl');
  });
  it('imports ChatGPT analysis and items together', async () => {
    const { result } = renderHook(useAppStore, { wrapper: AppStoreProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const value = {
      kind: 'task' as const, title: 'Send requirements', status: 'needs_review' as const,
      priority: 'medium' as const, tags: [], sourceSegmentIds: ['s1'], confidence: .9, confirmed: false
    };
    await act(async () => { await result.current.importItems('t1', [value], 'Detailed meeting analysis'); });
    expect((await db.transcriptions.get('t1'))?.summary).toBe('Detailed meeting analysis');
    expect(await db.items.where('transcriptionId').equals('t1').filter((item) => item.title === 'Send requirements').count()).toBe(1);
  });

  it('applies a Gemini job once and never auto-accepts its tasks or dates', async () => {
    await db.transcriptions.update('t1', { summaryJobId: 'job1' });
    const { result } = renderHook(useAppStore, { wrapper: AppStoreProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const analysis = { summary: 'Meeting summary', items: [{ ...task('ai'), status: 'open' as const, confirmed: true }] };
    await act(async () => { await Promise.all([result.current.applyGeminiAnalysis('t1', 'job1', analysis), result.current.applyGeminiAnalysis('t1', 'job1', analysis)]); });
    const imported = await db.items.filter((item) => item.tags.includes('gemini')).toArray();
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ status: 'needs_review', confirmed: false });
  });
});
