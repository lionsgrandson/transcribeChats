import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaultSettings } from '../data/db';
import type { ExtractedItem, Transcription } from '../domain/types';
import { crmImportUrl, fetchCrmDirectory, sendTasksToCrm, sendTranscriptionToCrm, toCrmTask } from './crmTransfer';

const task: ExtractedItem = {
  id: 'task-1', transcriptionId: 'transcription-1', kind: 'task', title: 'שלח proposal ללקוח', body: 'Include final pricing',
  status: 'needs_review', priority: 'high', dueAt: '2026-08-26T07:00:00.000Z', reminderAt: '2026-08-26T06:00:00.000Z',
  tags: [], sourceSegmentIds: ['segment-1'], confidence: 0.9, confirmed: false, createdAt: '2026-08-24T10:00:00.000Z', updatedAt: '2026-08-24T10:00:00.000Z'
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

describe('CRM task transfer', () => {
  it('keeps the transcription as the project category and preserves unicode', () => {
    const payload = toCrmTask(task, 'Project Alpha');
    expect(payload.projectName).toBe('Project Alpha');
    expect(payload.title).toContain('שלח');
    expect(payload.priority).toBe('High');
  });

  it('builds one batch import URL', () => {
    const url = crmImportUrl([toCrmTask(task, 'Project Alpha')], 'https://crm.example/');
    expect(url.startsWith('https://crm.example/#importTasks=')).toBe(true);
  });

  it('loads the client and project directory from the configured CRM', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      accepted: true,
      clients: [{ id: 'client-1', name: 'Acme' }],
      projects: [{ id: 'project-1', name: 'Website', clientIds: ['client-1'] }],
    }), { status: 200 }));
    const directory = await fetchCrmDirectory({ ...defaultSettings, crmEnabled: true, crmWebhookUrl: 'https://crm.example/functions/v1/crm-ingest', crmApiToken: 'secret-token' });
    expect(directory.clients[0].name).toBe('Acme');
    expect(directory.projects[0].clientIds).toEqual(['client-1']);
    expect(fetchMock).toHaveBeenCalledWith('https://crm.example/functions/v1/crm-ingest', expect.objectContaining({ method: 'GET' }));
  });

  it('posts selected tasks to the CRM chosen in settings when no local workspace is available', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: true, tasksCreated: 1 }), { status: 200 }));
    const result = await sendTasksToCrm([toCrmTask(task, 'Project Alpha')], {
      ...defaultSettings,
      crmEnabled: true,
      crmProvider: 'codecrafter',
      crmWebhookUrl: 'https://crm.example/functions/v1/crm-ingest',
      crmApiToken: 'secret-token',
    });
    expect(result.accepted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends tasks, timeline events, summary and notes to one client card', async () => {
    const transcription: Transcription = {
      id: 'transcription-1', title: 'Project Alpha', sourceType: 'upload', status: 'ready', languageMode: 'en',
      detectedLanguages: ['en'], recordedAt: '2026-08-24T10:00:00.000Z', createdAt: '2026-08-24T10:00:00.000Z',
      updatedAt: '2026-08-24T10:30:00.000Z', context: 'Client: Acme · Email: client@acme.example', summary: 'Discussed launch work.',
    };
    const event: ExtractedItem = {
      ...task, id: 'event-1', kind: 'event', title: 'Launch call', startsAt: '2026-08-27T10:00:00.000Z', dueAt: undefined,
    };
    const note: ExtractedItem = {
      ...task, id: 'note-1', kind: 'note', title: 'Important context', body: 'Client prefers WhatsApp.', dueAt: undefined, priority: 'none', status: 'open', confirmed: true,
    };
    await db.transcriptions.add(transcription);
    await db.items.bulkAdd([task, event, note]);
    await db.notes.add({ id: 'personal-note-1', transcriptionId: transcription.id, body: 'Check assets folder.', createdAt: transcription.createdAt, updatedAt: transcription.updatedAt });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: true, contactId: 'client-1', tasksCreated: 1, eventsCreated: 1 }), { status: 200 }));
    const result = await sendTasksToCrm([toCrmTask(task, transcription.title)], { ...defaultSettings, crmEnabled: true, crmProvider: 'codecrafter', crmWebhookUrl: 'https://crm.example/functions/v1/crm-ingest', crmApiToken: 'secret-token' });

    expect(result).toMatchObject({ accepted: true, tasksCreated: 1, eventsCreated: 1, contactId: 'client-1' });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.tasks).toHaveLength(1);
    expect(payload.events).toHaveLength(1);
    expect(payload.summary).toContain('Discussed launch work.');
    expect(payload.summary).toContain('Client prefers WhatsApp.');
    expect(payload.summary).toContain('Check assets folder.');
  });

  it('can create a new client while sending the complete workspace', async () => {
    const transcription: Transcription = {
      id: 'transcription-new-client', title: 'New client discovery', sourceType: 'manual', status: 'ready', languageMode: 'en',
      detectedLanguages: ['en'], recordedAt: '2026-08-24T10:00:00.000Z', createdAt: '2026-08-24T10:00:00.000Z',
      updatedAt: '2026-08-24T10:30:00.000Z', summary: 'New client discovery call.',
    };
    await db.transcriptions.add(transcription);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: true, contactId: 'new-client', contactCreated: true }), { status: 200 }));
    const result = await sendTranscriptionToCrm(transcription.id, { ...defaultSettings, crmEnabled: true, crmProvider: 'codecrafter', crmWebhookUrl: 'https://crm.example/functions/v1/crm-ingest', crmApiToken: 'secret-token' },
      { newContact: { name: 'New Client', company: 'New Co', email: 'new@example.com' } }
    );

    expect(result.contactCreated).toBe(true);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.destination.newContact).toEqual({ name: 'New Client', company: 'New Co', email: 'new@example.com' });
    expect(payload.contact).toEqual({ name: 'New Client', company: 'New Co', email: 'new@example.com' });
    expect(payload.summary).toContain('New client discovery call.');
  });

  it('sends the whole transcription workspace with one action even when there are no tasks', async () => {
    const transcription: Transcription = {
      id: 'transcription-2', title: 'Discovery call', sourceType: 'upload', status: 'ready', languageMode: 'en',
      detectedLanguages: ['en'], recordedAt: '2026-08-24T10:00:00.000Z', createdAt: '2026-08-24T10:00:00.000Z',
      updatedAt: '2026-08-24T10:30:00.000Z', context: 'Client: Example Client · Email: client@example.com',
      summary: 'Discussed the new website and agreed to follow up next week.',
    };
    const takeaway: ExtractedItem = {
      ...task, id: 'takeaway-2', transcriptionId: transcription.id, kind: 'takeaway', title: 'Client wants a simpler homepage',
      body: 'The homepage should focus on one clear CTA.', priority: 'none', dueAt: undefined, status: 'open', confirmed: true,
    };
    await db.transcriptions.add(transcription);
    await db.items.add(takeaway);
    await db.notes.add({ id: 'personal-note-2', transcriptionId: transcription.id, body: 'Ask for brand assets.', createdAt: transcription.createdAt, updatedAt: transcription.updatedAt });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: true, contactId: 'client-2', tasksCreated: 0, eventsCreated: 0 }), { status: 200 }));
    const result = await sendTranscriptionToCrm(transcription.id, { ...defaultSettings, crmEnabled: true, crmProvider: 'codecrafter', crmWebhookUrl: 'https://crm.example/functions/v1/crm-ingest', crmApiToken: 'secret-token' });

    expect(result).toMatchObject({ accepted: true, tasksCreated: 0, eventsCreated: 0, contactId: 'client-2' });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.externalReference).toBe('transcribeChats:transcription-2:workspace:auto:project:none');
    expect(payload.tasks).toEqual([]);
    expect(payload.events).toEqual([]);
    expect(payload.summary).toContain('Discussed the new website');
    expect(payload.summary).toContain('The homepage should focus on one clear CTA.');
    expect(payload.summary).toContain('Ask for brand assets.');
  });
});
