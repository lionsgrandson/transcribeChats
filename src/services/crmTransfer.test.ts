import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaultSettings } from '../data/db';
import type { ExtractedItem, Transcription } from '../domain/types';
import { crmImportUrl, encodeCrmTasks, sendTasksToCrm, toCrmTask } from './crmTransfer';

const task: ExtractedItem = {
  id: 'task-1', transcriptionId: 'transcription-1', kind: 'task', title: 'שליחת הצעה', body: 'Include the revised scope.',
  status: 'needs_review', priority: 'high', dueAt: '2026-07-20T08:30:00.000Z', tags: [], sourceSegmentIds: [],
  confidence: 0.9, confirmed: false, createdAt: '2026-07-15T08:00:00.000Z', updatedAt: '2026-07-15T08:00:00.000Z',
};

beforeEach(async () => {
  await Promise.all([db.transcriptions.clear(), db.items.clear(), db.notes.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CRM task transfer', () => {
  it('keeps the transcription as the project category and preserves unicode', () => {
    const payload = toCrmTask(task, 'פרויקט אתר');
    const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encodeCrmTasks([payload])), (character) => character.charCodeAt(0))));
    expect(decoded[0]).toMatchObject({ title: 'שליחת הצעה', projectName: 'פרויקט אתר', priority: 'High', dueDate: '2026-07-20' });
  });

  it('builds one batch import URL', () => {
    expect(crmImportUrl([toCrmTask(task, 'Website')], 'https://crm.example/')).toContain('https://crm.example/#importTasks=');
  });

  it('posts selected tasks to the CRM chosen in settings when no local workspace is available', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: true, tasksCreated: 1 }), { status: 200 }));
    const result = await sendTasksToCrm([toCrmTask(task, 'Website')], { ...defaultSettings, crmEnabled: true, crmProvider: 'compatible', crmWebhookUrl: 'https://crm.example/hooks/tasks', crmApiToken: 'secret-token' });
    expect(result.tasksCreated).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith('https://crm.example/hooks/tasks', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }) }));
  });

  it('sends tasks, timeline events, summary and notes to one client card', async () => {
    const transcription: Transcription = {
      id: 'transcription-1', title: 'Acme weekly call', sourceType: 'upload', status: 'ready', languageMode: 'mixed',
      detectedLanguages: ['he', 'en'], recordedAt: '2026-07-15T08:00:00.000Z', createdAt: '2026-07-15T08:00:00.000Z',
      updatedAt: '2026-07-15T09:00:00.000Z', context: 'Client: Acme Ltd · Email: dana@acme.example · Phone: +972501234567',
      summary: 'Agreed on the revised launch plan.',
    };
    const event: ExtractedItem = {
      ...task, id: 'event-1', kind: 'event', title: 'Launch review meeting', body: 'Review the final launch plan.',
      priority: 'none', dueAt: undefined, startsAt: '2026-07-22T10:00:00.000Z', status: 'open', confirmed: true,
    };
    const note: ExtractedItem = {
      ...task, id: 'note-1', kind: 'note', title: 'Client prefers WhatsApp', body: 'Client prefers WhatsApp for urgent questions.',
      priority: 'none', dueAt: undefined, status: 'open', confirmed: true,
    };
    await db.transcriptions.add(transcription);
    await db.items.bulkAdd([task, event, note]);
    await db.notes.add({ id: 'personal-note-1', transcriptionId: transcription.id, body: 'Send the polished mockup before the review.', createdAt: transcription.createdAt, updatedAt: transcription.updatedAt });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: true, contactId: 'client-1', tasksCreated: 1, eventsCreated: 1 }), { status: 200 }));
    const result = await sendTasksToCrm([toCrmTask(task, transcription.title)], { ...defaultSettings, crmEnabled: true, crmProvider: 'codecrafter', crmWebhookUrl: 'https://crm.example/functions/v1/crm-ingest', crmApiToken: 'secret-token' });

    expect(result).toMatchObject({ accepted: true, tasksCreated: 1, eventsCreated: 1, contactId: 'client-1' });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.eventType).toBe('transcribeChats.client-workspace.imported');
    expect(payload.contact).toMatchObject({ name: 'Acme Ltd', email: 'dana@acme.example', phone: '+972501234567' });
    expect(payload.tasks).toHaveLength(1);
    expect(payload.events).toEqual([expect.objectContaining({ title: 'Launch review meeting', startsAt: '2026-07-22T10:00:00.000Z' })]);
    expect(payload.summary).toContain('Agreed on the revised launch plan.');
    expect(payload.summary).toContain('Client prefers WhatsApp for urgent questions.');
    expect(payload.summary).toContain('Send the polished mockup before the review.');
    expect(payload.summary).toContain('Timeline');
  });
});
