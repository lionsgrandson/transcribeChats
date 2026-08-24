import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaultSettings } from '../data/db';
import type { ExtractedItem, Transcription } from '../domain/types';
import { sendTranscriptionToCrm } from './crmTransfer';

beforeEach(async () => {
  await Promise.all([db.transcriptions.clear(), db.items.clear(), db.notes.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CRM client and project creation', () => {
  it('can create a client and project in the same full-workspace sync', async () => {
    const transcription: Transcription = {
      id: 'transcription-project-create',
      title: 'Website discovery call',
      sourceType: 'upload',
      status: 'ready',
      languageMode: 'en',
      detectedLanguages: ['en'],
      recordedAt: '2026-08-24T12:00:00.000Z',
      createdAt: '2026-08-24T12:00:00.000Z',
      updatedAt: '2026-08-24T12:30:00.000Z',
      summary: 'The client approved moving forward with a new website project.',
    };
    const task: ExtractedItem = {
      id: 'task-project-create',
      transcriptionId: transcription.id,
      kind: 'task',
      title: 'Prepare website proposal',
      body: 'Include the agreed project scope.',
      status: 'open',
      priority: 'high',
      tags: [],
      sourceSegmentIds: [],
      confidence: 0.95,
      confirmed: true,
      createdAt: transcription.createdAt,
      updatedAt: transcription.updatedAt,
    };
    await db.transcriptions.add(transcription);
    await db.items.add(task);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      accepted: true,
      contactId: 'client-new',
      contactCreated: true,
      projectId: 'project-new',
      projectCreated: true,
      tasksCreated: 1,
      eventsCreated: 0,
    }), { status: 200 }));

    const result = await sendTranscriptionToCrm(
      transcription.id,
      {
        ...defaultSettings,
        crmEnabled: true,
        crmProvider: 'codecrafter',
        crmWebhookUrl: 'https://crm.example/functions/v1/crm-ingest',
        crmApiToken: 'secret-token',
      },
      {
        newContact: { name: 'New Client', company: 'New Co', email: 'new@example.com' },
        newProject: { name: 'Website rebuild', deadline: '2026-10-01', notes: 'Created from the discovery call.' },
      },
    );

    expect(result).toMatchObject({ contactCreated: true, projectCreated: true, contactId: 'client-new', projectId: 'project-new' });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.destination).toEqual({
      newContact: { name: 'New Client', company: 'New Co', email: 'new@example.com' },
      newProject: { name: 'Website rebuild', deadline: '2026-10-01', notes: 'Created from the discovery call.' },
    });
    expect(payload.externalReference).toContain('project:new:Website rebuild');
    expect(payload.tasks).toHaveLength(1);
    expect(payload.summary).toContain('The client approved moving forward');
  });
});
