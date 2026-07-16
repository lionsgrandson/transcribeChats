import type { ExtractedItem } from '../domain/types';
import type { AppSettings } from '../domain/types';

export type CrmTaskPayload = {
  title: string;
  notes: string;
  dueDate?: string;
  reminderAt?: string;
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  sourceId: string;
  sourceLabel: string;
  projectName: string;
};

const priorities = { none: 'Medium', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' } as const;

export function toCrmTask(item: ExtractedItem, transcriptionTitle: string): CrmTaskPayload {
  return {
    title: item.title,
    notes: item.body || '',
    dueDate: item.dueAt?.slice(0, 10),
    reminderAt: item.reminderAt,
    priority: priorities[item.priority],
    sourceId: item.id,
    sourceLabel: `${transcriptionTitle} · transcribeChats`,
    projectName: transcriptionTitle,
  };
}

export function encodeCrmTasks(value: CrmTaskPayload[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

export function crmImportUrl(tasks: CrmTaskPayload[], baseUrl: string): string {
  const cleanBase = baseUrl.replace(/\/$/, '');
  return `${cleanBase}/#importTasks=${encodeURIComponent(encodeCrmTasks(tasks))}`;
}

export async function sendTasksToCrm(tasks: CrmTaskPayload[], settings: AppSettings): Promise<{ accepted: boolean; tasksCreated?: number }> {
  if (!settings.crmEnabled) throw new Error('CRM sync is disabled. Choose a CRM in Settings first.');
  const webhookUrl = settings.crmWebhookUrl.trim();
  const token = settings.crmApiToken.trim();
  if (!webhookUrl || !token) throw new Error('Add the CRM webhook endpoint and API token in Settings.');
  let parsed: URL;
  try { parsed = new URL(webhookUrl); } catch { throw new Error('The CRM webhook endpoint is not a valid URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('The CRM webhook must use HTTP or HTTPS.');
  const actionId = `transcribeChats:${tasks.map((task) => task.sourceId).sort().join('|')}`;
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}` },
    body: JSON.stringify({
      schemaVersion: 2,
      provider: settings.crmProvider,
      eventType: 'transcribeChats.tasks.imported',
      occurredAt: new Date().toISOString(),
      externalReference: actionId,
      channel: 'transcribeChats',
      summary: `Imported ${tasks.length} task${tasks.length === 1 ? '' : 's'} from transcribeChats.`,
      tasks,
    }),
  });
  const result = await response.json().catch(() => ({})) as { accepted?: boolean; tasksCreated?: number; error?: string };
  if (!response.ok || !result.accepted) throw new Error(result.error || `CRM returned HTTP ${response.status}.`);
  return { accepted: true, tasksCreated: result.tasksCreated };
}
