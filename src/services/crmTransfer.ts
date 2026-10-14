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
  pendingConfirmation?: boolean;
  message?: string;
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
  const destination = validateCrmDestination(baseUrl, 'browser');
  destination.hash = `importTasks=${encodeURIComponent(encodeCrmTasks(tasks))}`;
  return destination.toString();
}

export function validateCrmDestination(value: string, mode: 'api' | 'browser'): URL {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid CRM destination URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    throw new Error('Use a public HTTPS CRM destination without credentials, query parameters or fragments.');
  }
  if (mode === 'api' && !url.pathname.endsWith('/functions/v1/crm-ingest')) {
    throw new Error('Use the CodeCrafter CRM inbound API endpoint ending in /functions/v1/crm-ingest.');
  }
  return url;
}

export const crmAdapters = {
  codecrafter: { name: 'CodeCrafter CRM', modes: ['browser', 'api'] as const },
};

export const browserCrmMode = (settings: AppSettings): boolean => settings.crmConnectionMode === 'browser';

export function crmTransferMessage(result: CrmTransferResult): string {
  if (result.pendingConfirmation) return 'CRM import opened. Review the project and save in your CRM to confirm. Import is not yet confirmed.';
  if (!result.accepted) throw new Error('The CRM did not confirm this transfer.');
  if (result.duplicate) return 'CRM confirmed the request; previously imported source IDs were skipped.';
  return typeof result.tasksCreated === 'number' ? `CRM confirmed ${result.tasksCreated} task(s) created.` : 'CRM confirmed the import request.';
}

async function openBrowserImport(tasks: CrmTaskPayload[], settings: AppSettings): Promise<CrmTransferResult> {
  if (!settings.crmEnabled) throw new Error('Connect your CRM in Settings first.');
  const stored = await db.items.bulkGet(tasks.map((task) => task.sourceId));
  const eligible = tasks.filter((_, index) => !stored[index] || (stored[index]!.kind === 'task' && !['completed', 'dismissed'].includes(stored[index]!.status)));
  if (!eligible.length) throw new Error('Completed or dismissed tasks are not sent to the CRM.');
  const url = crmImportUrl(eligible, settings.crmBaseUrl || '');
  if (url.length > 60_000) throw new Error('This selection is too large for browser import. Select fewer tasks or connect the workspace API.');
  // noopener may return null even on success; never infer import success from window.open.
  window.open(url, '_blank', 'noopener,noreferrer');
  return { accepted: false, pendingConfirmation: true };
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
  const active = items.filter((item) => item.status !== 'dismissed' && !(item.kind === 'task' && item.status === 'completed'));
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

function crmDestinationKey(destination: CrmDestination): string {
  const projectKey = destination.projectId || (destination.newProject ? `new:${destination.newProject.name}` : 'none');
  return destination.contactId
    ? `client:${destination.contactId}:project:${projectKey}`
    : destination.newContact
      ? `new:${destination.newContact.email || destination.newContact.phone || destination.newContact.name}:project:${projectKey}`
      : `auto:project:${projectKey}`;
}

function validateSettings(settings: AppSettings): { webhookUrl: string; authorization: string } {
  if (!settings.crmEnabled) throw new Error('CRM sync is disabled. Choose a CRM in Settings first.');
  if (settings.crmProvider !== 'codecrafter') throw new Error('This CRM provider has no verified adapter. Choose CodeCrafter CRM.');
  const webhookUrl = settings.crmWebhookUrl.trim();
  const token = settings.crmApiToken.trim();
  if (!webhookUrl || !token) throw new Error('Add the CRM webhook endpoint and API token in Settings.');
  validateCrmDestination(webhookUrl, 'api');
  return { webhookUrl, authorization: token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}` };
}

export async function fetchCrmDirectory(settings: AppSettings): Promise<CrmDirectory> {
  const { webhookUrl, authorization } = validateSettings(settings);
  const response = await fetch(webhookUrl, { method: 'GET', headers: { Authorization: authorization }, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(20_000) });
  const result = await response.json().catch(() => ({})) as { accepted?: boolean; clients?: CrmDirectoryClient[]; projects?: CrmDirectoryProject[]; error?: string };
  if (!response.ok || result.accepted !== true) throw new Error(result.error || `CRM did not confirm the request (HTTP ${response.status}).`);
  return { clients: result.clients || [], projects: result.projects || [] };
}

async function postToCrm(webhookUrl: string, authorization: string, payload: Record<string, unknown>): Promise<CrmTransferResult> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization },
    body: JSON.stringify(payload),
    redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({})) as CrmTransferResult & { error?: string };
  if (!response.ok || result.accepted !== true) throw new Error(result.error || `CRM did not confirm the request (HTTP ${response.status}).`);
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
  const tasks = activeItems.filter((item) => item.kind === 'task' && item.status !== 'completed').map((item) => toCrmTask(item, transcription.title));
  const events = activeItems
    .filter((item) => item.kind === 'event')
    .map(toCrmEvent)
    .filter((event): event is CrmEventPayload => Boolean(event));
  const destinationKey = crmDestinationKey(destination);

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
export async function sendTasksToCrm(tasks: CrmTaskPayload[], settings: AppSettings, destination: CrmDestination = {}): Promise<CrmTransferResult> {
  if (!tasks.length) throw new Error('Choose at least one task to send to the CRM.');
  if (settings.crmProvider !== 'codecrafter') throw new Error('This CRM provider has no verified adapter. Choose CodeCrafter CRM.');
  if (browserCrmMode(settings)) return openBrowserImport(tasks, settings);
  const { webhookUrl, authorization } = validateSettings(settings);

  const sourceItems = (await Promise.all(tasks.map((task) => db.items.get(task.sourceId))))
    .filter((item): item is ExtractedItem => Boolean(item));
  if (!sourceItems.length) return sendLegacyTasks(tasks, settings, webhookUrl, authorization);
  const eligibleSourceItems = sourceItems.filter((item) => item.kind === 'task' && item.status !== 'completed' && item.status !== 'dismissed');
  if (!eligibleSourceItems.length) throw new Error('Completed or dismissed tasks are not sent to the CRM.');

  const byTranscription = new Map<string, ExtractedItem[]>();
  for (const item of eligibleSourceItems) {
    const current = byTranscription.get(item.transcriptionId) || [];
    current.push(item);
    byTranscription.set(item.transcriptionId, current);
  }

  let tasksCreated: number | undefined = 0;
  let eventsCreated: number | undefined = 0;
  let contactId: string | null | undefined;
  let contactCreated = false;
  let duplicate = false;

  for (const [transcriptionId, selectedItems] of byTranscription) {
    const transcription = await db.transcriptions.get(transcriptionId);
    if (!transcription) throw new Error('A selected task no longer has a source transcription. No success was recorded.');
    const [workspaceItems, personalNotes] = await Promise.all([
      db.items.where('transcriptionId').equals(transcriptionId).toArray(),
      db.notes.where('transcriptionId').equals(transcriptionId).toArray(),
    ]);
    const selectedIds = new Set(selectedItems.map((item) => item.id));
    const selectedTasks = selectedItems.filter((item) => selectedIds.has(item.id)).map((item) => toCrmTask(item, transcription.title));
    const events = workspaceItems
      .filter((item) => item.kind === 'event' && item.status !== 'dismissed')
      .map(toCrmEvent)
      .filter((event): event is CrmEventPayload => Boolean(event));
    if (!selectedTasks.length) continue;
    const destinationKey = crmDestinationKey(destination);
    const actionId = `transcribeChats:${transcriptionId}:${selectedTasks.map((task) => task.sourceId).sort().join('|')}:destination:${destinationKey}`;
    const result = await postToCrm(webhookUrl, authorization, {
      schemaVersion: 3,
      provider: settings.crmProvider,
      eventType: 'transcribeChats.client-workspace.imported',
      occurredAt: new Date().toISOString(),
      externalReference: actionId,
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
      tasks: selectedTasks,
      events,
    });
    tasksCreated = result.duplicate ? tasksCreated : typeof result.tasksCreated === 'number' && tasksCreated !== undefined ? tasksCreated + result.tasksCreated : undefined;
    eventsCreated = result.duplicate ? eventsCreated : typeof result.eventsCreated === 'number' && eventsCreated !== undefined ? eventsCreated + result.eventsCreated : undefined;
    contactId = result.contactId ?? contactId;
    contactCreated = contactCreated || Boolean(result.contactCreated);
    duplicate = duplicate || Boolean(result.duplicate);
  }

  return { accepted: true, tasksCreated, eventsCreated, contactId, contactCreated, duplicate };
}
