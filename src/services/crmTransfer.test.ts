import { describe, expect, it, vi } from 'vitest';
import type { ExtractedItem } from '../domain/types';
import { crmImportUrl, encodeCrmTasks, sendTasksToCrm, toCrmTask } from './crmTransfer';
import { defaultSettings } from '../data/db';

const task: ExtractedItem = {
  id: 'task-1', transcriptionId: 'transcription-1', kind: 'task', title: 'שליחת הצעה', body: 'Include the revised scope.',
  status: 'needs_review', priority: 'high', dueAt: '2026-07-20T08:30:00.000Z', tags: [], sourceSegmentIds: [],
  confidence: 0.9, confirmed: false, createdAt: '2026-07-15T08:00:00.000Z', updatedAt: '2026-07-15T08:00:00.000Z',
};

describe('CRM task transfer', () => {
  it('keeps the transcription as the project category and preserves unicode', () => {
    const payload = toCrmTask(task, 'פרויקט אתר');
    const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encodeCrmTasks([payload])), (character) => character.charCodeAt(0))));
    expect(decoded[0]).toMatchObject({ title: 'שליחת הצעה', projectName: 'פרויקט אתר', priority: 'High', dueDate: '2026-07-20' });
  });

  it('builds one batch import URL', () => {
    expect(crmImportUrl([toCrmTask(task, 'Website')], 'https://crm.example/')).toContain('https://crm.example/#importTasks=');
  });

  it('posts selected tasks to the CRM chosen in settings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: true, tasksCreated: 1 }), { status: 200 }));
    const result = await sendTasksToCrm([toCrmTask(task, 'Website')], { ...defaultSettings, crmEnabled: true, crmProvider: 'compatible', crmWebhookUrl: 'https://crm.example/hooks/tasks', crmApiToken: 'secret-token' });
    expect(result.tasksCreated).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith('https://crm.example/hooks/tasks', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }) }));
    fetchMock.mockRestore();
  });
});
