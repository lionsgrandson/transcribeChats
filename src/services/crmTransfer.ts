import { db } from '../data/db';
import type { AppSettings, ExtractedItem, Transcription, TranscriptionNote } from '../domain/types';

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

export type CrmContactPayload = {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
};

export type CrmProjectPayload = {
  name: string;
  deadline?: string;
  notes?: string;
};

export type CrmEventPayload = {
  title: string;
  type: 'Meeting' | 'Other';
  startsAt: string;
  endsAt?: string;
  notes?: string;
  sourceId: string;
};

export type CrmDirectoryClient = {
  id: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
};

export type CrmDirectoryProject = {
  id: string;
  name: string;
  clientIds: string[];
};

export type CrmDirectory = {
  clients: CrmDirectoryClient[];
  projects: CrmDirectoryProject[];
};

export type CrmDestination = {
  contactId?: string;
  projectId?: string;
  newContact?: CrmContactPayload;
  newProject?: CrmProjectPayload;
};

export type CrmTransferResult = {
  accepted: boolean;
  tasksCreated?: number;
  eventsCreated?: number;
  contactId?: string | null;
  projectId?: string | null;
  contactCreated?: boolean;
  projectCreated?: boolean;
  duplicate?: boolean;
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

function matchContext(context: string | undefined, labels: string[]): string | undefined {
  if (!context) return undefined;
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = context.match(new RegExp(`(?:${escaped})\\s*[:=\\-]\\s*([^·|\\n;,]+)`, 'i'));
  return match?.[1]?.trim() || undefined;
}

function inferContact(transcription: Transcription): CrmContactPayload {
  const context = transcription.context || '';
  const name = matchContext(context, ['client', 'customer', 'contact', 'לקוח', 'לקוחה', 'איש קשר']) || transcription.title.trim() || 'Transcript client';
  const company = matchContext(context, ['company', 'business', 'חברה', 'עסק']);
  const email = matchContext(context, ['email', 'e-mail', 'אימייל', 'מייל']) || context.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0];
  const phone = matchContext(context, ['phone', 'mobile', 'tel', 'טלפון', 'נייד']);
  return { name, company, email, phone };
}

function toCrmEvent(item: ExtractedItem): CrmEventPayload | undefined {
  if (!item.startsAt) return undefined;
  return {
    title: item.title,
    type: item.kind === 'event' ? 'Meeting' : 'Other',
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    notes: item.body || item.uncertaintyReason,
    sourceId: item.id,
  };
}

function workspaceNote(transcription: Transcription, items: ExtractedItem[], notes: TranscriptionNote[]): string {
  const active = items.filter((item) => item.status !== 'dismissed');
  const extractedNotes = active.filter((item) => ['note', 'takeaway', 'summary'].includes(item.kind));
  const timeline = active
    .filter((item) => item.startsAt || item.dueAt)
    .sort((left, right) => new Date(left.startsAt || left.dueAt!).getTime() - new Date(right.startsAt || right.dueAt!).getTime());
  const parts: string[] = [
    `TranscribeChats: ${transcription.title}`,
    `Recorded: ${transcription.recordedAt}`,
  ];
  if (transcription.summary?.trim()) parts.push(`Summary\n${transcription.summary.trim()}`);
  if (extractedNotes.length) {
    const unique = [...new Set(extractedNotes.map((item) => (item.body || item.title).trim()).filter(Boolean))];
    parts.push(`Notes and takeaways\n${unique.map((value) => `- ${value}`).join('\n')}`);
  }
  if (notes.length) parts.push(`Personal notes\n${notes.map((note) => `- ${note.body.trim()}`).filter((value) => value !== '-').join('\n')}`);
  if (timeline.length) {
    parts.push(`Timeline\n${timeline.map((item) => {
      const when = item.startsAt || item.dueAt!;
      return `- ${when} · ${item.kind}: ${item.title}`;
    }).join('\n')}`);
  }
  return parts.join('\n\n').slice(0, 9500);
}

function validateSettings(settings: AppSettings): { webhookUrl: string; authorization: string } {
  if (!settings.crmEnabled) throw new Error('CRM sync is disabled. Choose a CRM in Settings first.');
  const webhookUrl = settings.crmWebhookUrl.trim();
  const token = settings.crmApiToken.trim();
  if (!webhookUrl || !token) throw new Error('Add the CRM webhook endpoint and API token in Settings.');
  let parsed: URL;
  try { parsed = new URL(webhookUrl); } catch { throw new Error('The CRM webhook endpoint is not a valid URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('The CRM webhook must use HTTP or HTTPS.');
  return { webhookUrl, authorization: token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}` };
}

export async function fetchCrmDirectory(settings: AppSettings): Promise<CrmDirectory> {
  const { webhookUrl, authorization } = validateSettings(settings);
  const response = await fetch(webhookUrl, { method: 'GET', headers: { Authorization: authorization } });
  const result = await response.json().catch(() => ({})) as { accepted?: boolean; clients?: CrmDirectoryClient[]; projects?: CrmDirectoryProject[]; error?: string };
  if (!response.ok || !result.accepted) throw new Error(result.error || `CRM returned HTTP ${response.status}.`);
  return { clients: result.clients || [], projects: result.projects || [] };
}

async function postToCrm(webhookUrl: string, authorization: string, payload: Record<string, unknown>): Promise<CrmTransferResult> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({})) as CrmTransferResult & { error?: string };
  if (!response.ok || !result.accepted) throw new Error(result.error || `CRM returned HTTP ${response.status}.`);
  return result;
}

async function sendLegacyTasks(tasks: CrmTaskPayload[], settings: AppSettings, webhookUrl: string, authorization: string): Promise<CrmTransferResult> {
  const actionId = `transcribeChats:${tasks.map((task) => task.sourceId).sort().join('|')}`;
  return postToCrm(webhookUrl, authorization, {
    schemaVersion: 3,
    provider: settings.crmProvider,
    eventType: 'transcribeChats.tasks.imported',
    occurredAt: new Date().toISOString(),
    externalReference: actionId,
    channel: 'transcribeChats',
    summary: `Imported ${tasks.length} task${tasks.length === 1 ? '' : 's'} from transcribeChats.`,
    tasks,
  });
}

/**
 * Sends an entire transcription workspace in one request to a chosen CRM client/project.
 * Summary, notes, takeaways and timeline are stored on the client card.
 */
export async function sendTranscriptionToCrm(transcriptionId: string, settings: AppSettings, destination: CrmDestination = {}): Promise<CrmTransferResult> {
  const { webhookUrl, authorization } = validateSettings(settings);
  const transcription = await db.transcriptions.get(transcriptionId);
  if (!transcription) throw new Error('The transcription could not be found.');

  const [workspaceItems, personalNotes] = await Promise.all([
    db.items.where('transcriptionId').equals(transcriptionId).toArray(),
    db.notes.where('transcriptionId').equals(transcriptionId).toArray(),
  ]);
  const activeItems = workspaceItems.filter((item) => item.status !== 'dismissed');
  const tasks = activeItems.filter((item) => item.kind === 'task').map((item) => toCrmTask(item, transcription.title));
  const events = activeItems
    .filter((item) => item.kind === 'event')
    .map(toCrmEvent)
    .filter((event): event is CrmEventPayload => Boolean(event));
  const projectKey = destination.projectId || (destination.newProject ? `new:${destination.newProject.name}` : 'none');
  const destinationKey = destination.contactId
    ? `client:${destination.contactId}:project:${projectKey}`
    : destination.newContact
      ? `new:${destination.newContact.email || destination.newContact.phone || destination.newContact.name}:project:${projectKey}`
      : `auto:project:${projectKey}`;

  return postToCrm(webhookUrl, authorization, {
    schemaVersion: 3,
    provider: settings.crmProvider,
    eventType: 'transcribeChats.client-workspace.imported',
    occurredAt: new Date().toISOString(),
    externalReference: `transcribeChats:${transcriptionId}:workspace:${destinationKey}`,
    channel: 'transcribeChats',
    destination,
    contact: destination.newContact || inferContact(transcription),
    summary: workspaceNote(transcription, workspaceItems, personalNotes),
    transcription: {
      id: transcription.id,
      title: transcription.title,
      recordedAt: transcription.recordedAt,
      detectedLanguages: transcription.detectedLanguages,
    },
    tasks,
    events,
  });
}

/**
 * Sends the selected task(s) plus the rest of their transcription workspace.
 * For CodeCrafter-compatible CRMs this means tasks, dated events/timeline,
 * summary and notes are attached to the same client card in one import.
 */
export async function sendTasksToCrm(tasks: CrmTaskPayload[], settings: AppSettings): Promise<CrmTransferResult> {
  if (!tasks.length) throw new Error('Choose at least one task to send to the CRM.');
  const { webhookUrl, authorization } = validateSettings(settings);

  const sourceItems = (await Promise.all(tasks.map((task) => db.items.get(task.sourceId))))
    .filter((item): item is ExtractedItem => Boolean(item));
  if (!sourceItems.length) return sendLegacyTasks(tasks, settings, webhookUrl, authorization);

  const byTranscription = new Map<string, ExtractedItem[]>();
  for (const item of sourceItems) {
    const current = byTranscription.get(item.transcriptionId) || [];
    current.push(item);
    byTranscription.set(item.transcriptionId, current);
  }

  let tasksCreated = 0;
  let eventsCreated = 0;
  let contactId: string | null | undefined;
  let contactCreated = false;
  let duplicate = false;

  for (const [transcriptionId, selectedItems] of byTranscription) {
    const transcription = await db.transcriptions.get(transcriptionId);
    if (!transcription) continue;
    const [workspaceItems, personalNotes] = await Promise.all([
      db.items.where('transcriptionId').equals(transcriptionId).toArray(),
      db.notes.where('transcriptionId').equals(transcriptionId).toArray(),
    ]);
    const selectedIds = new Set(selectedItems.map((item) => item.id));
    const selectedTasks = tasks.filter((task) => selectedIds.has(task.sourceId));
    const events = workspaceItems
      .filter((item) => item.kind === 'event' && item.status !== 'dismissed')
      .map(toCrmEvent)
      .filter((event): event is CrmEventPayload => Boolean(event));
    const actionId = `transcribeChats:${transcriptionId}:${selectedTasks.map((task) => task.sourceId).sort().join('|')}`;
    const result = await postToCrm(webhookUrl, authorization, {
      schemaVersion: 3,
      provider: settings.crmProvider,
      eventType: 'transcribeChats.client-workspace.imported',
      occurredAt: new Date().toISOString(),
      externalReference: actionId,
      channel: 'transcribeChats',
      contact: inferContact(transcription),
      summary: workspaceNote(transcription, workspaceItems, personalNotes),
      transcription: {
        id: transcription.id,
        title: transcription.title,
        recordedAt: transcription.recordedAt,
        detectedLanguages: transcription.detectedLanguages,
      },
      tasks: selectedTasks,
      events,
    });
    tasksCreated += result.duplicate ? 0 : (result.tasksCreated ?? selectedTasks.length);
    eventsCreated += result.duplicate ? 0 : (result.eventsCreated ?? events.length);
    contactId = result.contactId ?? contactId;
    contactCreated = contactCreated || Boolean(result.contactCreated);
    duplicate = duplicate || Boolean(result.duplicate);
  }

  return { accepted: true, tasksCreated, eventsCreated, contactId, contactCreated, duplicate };
}
