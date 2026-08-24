import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaultSettings } from '../data/db';
import type { ExtractedItem, Transcription } from '../domain/types';
import { crmImportUrl, encodeCrmTasks, fetchCrmDirectory, sendTasksToCrm, sendTranscriptionToCrm, toCrmTask } from './crmTransfer';

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

  it('loads the client and project directory from the configured CRM', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      accepted: true,
      clients: [{ id: 'client-1', name: 'Acme', company: 'Acme Ltd' }],
      projects: [{ id: 'project-1', name: 'Website', clientIds: ['client-1'] }],
    }), { status: 200 }));
    const settings = { ...defaultSettings, crmEnabled: true, crmWebhookUrl: 'https://crm.example/functions/v1/crm-ingest', crmApiToken: 'secret-token' };
    const directory = await fetchCrmDirectory(settings);

    expect(directory.clients[0]).toMatchObject({ id: 'client-1', name: 'Acme' });
    expect(directory.projects[0]).toMatchObject({ id: 'project-1', clientIds: ['client-1'] });
    expect(fetchMock).toHaveBeenCalledWith(settings.crmWebhookUrl, expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }) }));
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

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: true, contactId: 'client-1', projectId: 'project-1', tasksCreated: 1, eventsCreated: 1 }), { status: 200 }));
    const result = await sendTranscriptionToCrm(
      transcription.id,
      { ...defaultSettings, crmEnabled: true, crmProvider: 'codecrafter', crmWebhookUrl: 'https://crm.example/functions/v1/crm-ingest', crmApiToken: 'secret-token' },
      { contactId: 'client-1', projectId: 'project-1' },
    );

    expect(result).toMatchObject({ accepted: true, tasksCreated: 1, eventsCreated: 1, contactId: 'client-1', projectId: 'project-1' });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.eventType).toBe('transcribeChats.client-workspace.imported');
    expect(payload.destination).toEqual({ contactId: 'client-1', projectId: 'project-1' });
    expect(payload.externalReference).toContain('client:client-1:project:project-1');
    expect(payload.tasks).toHaveLength(1);
    expect(payload.events).toEqual([expect.objectContaining({ title: 'Launch review meeting', startsAt: '2026-07-22T10:00:00.000Z' })]);
    expect(payload.summary).toContain('Agreed on the revised launch plan.');
    expect(payload.summary).toContain('Client prefers WhatsApp for urgent questions.');
    expect(payload.summary).toContain('Send the polished mockup before the review.');
    expect(payload.summary).toContain('Timeline');
  });

  it('can create a new client while sending the complete workspace', async () => {
    const transcription: Transcription = {
      id: 'transcription-new-client', title: 'New lead call', sourceType: 'upload', status: 'ready', languageMode: 'en',
      detectedLanguages: ['en'], recordedAt: '2026-08-24T10:00:00.000Z', createdAt: '2026-08-24T10:00:00.000Z',
      updatedAt: '2026-08-24T10:30:00.000Z', summary: 'New client discovery call.',
    };
    await db.transcriptions.add(transcription);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: true, contactId: 'client-new', contactCreated: true, tasksCreated: 0, eventsCreated: 0 }), { status: 200 }));

    const result = await sendTranscriptionToCrm(
      transcription.id,
      { ...defaultSettings, crmEnabled: true, crmProvider: 'codecrafter', crmWebhookUrl: 'https://crm.example/functions/v1/crm-ingest', crmApiToken: 'secret-token' },
      { newContact: { name: 'New Client', company: 'New Co', email: 'new@example.com' } },
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
    expect(payload.externalReference).toBe('transcribeChats:transcription-2:workspace:auto');
    expect(payload.tasks).toEqual([]);
    expect(payload.events).toEqual([]);
    expect(payload.summary).toContain('Discussed the new website');
    expect(payload.summary).toContain('The homepage should focus on one clear CTA.');
    expect(payload.summary).toContain('Ask for brand assets.');
  });
});
