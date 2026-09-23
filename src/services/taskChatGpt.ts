import type { ExtractedItem, TranscriptSegment, Transcription } from '../domain/types';
import { formatTimestamp } from '../lib/format';

export interface TaskChatGptEntry {
  item: ExtractedItem;
  transcription: Transcription;
  segments: TranscriptSegment[];
}

function taskContextSegments(item: ExtractedItem, segments: TranscriptSegment[]): TranscriptSegment[] {
  if (!item.sourceSegmentIds.length || !segments.length) return [];
  const ordered = [...segments].sort((left, right) => left.sequenceNo - right.sequenceNo);
  const sourceIds = new Set(item.sourceSegmentIds);
  const includedIndexes = new Set<number>();

  ordered.forEach((segment, index) => {
    if (!sourceIds.has(segment.id)) return;
    includedIndexes.add(index);
    if (index > 0) includedIndexes.add(index - 1);
    if (index < ordered.length - 1) includedIndexes.add(index + 1);
  });

  return [...includedIndexes].sort((left, right) => left - right).map((index) => ordered[index]);
}

function taskMetadata(item: ExtractedItem): string {
  return [
    `Task: ${item.title}`,
    item.body?.trim() ? `Details: ${item.body.trim()}` : '',
    `Status: ${item.status}`,
    `Priority: ${item.priority}`,
    item.assignee ? `Assignee: ${item.assignee}` : '',
    item.dueAt ? `Due: ${item.dueAt}` : '',
    item.reminderAt ? `Reminder: ${item.reminderAt}` : '',
    item.tags.length ? `Tags: ${item.tags.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

function taskTranscriptContext(item: ExtractedItem, segments: TranscriptSegment[]): string {
  const contextSegments = taskContextSegments(item, segments);
  const sourceIds = new Set(item.sourceSegmentIds);
  return contextSegments.length
    ? contextSegments.map((segment) => {
        const marker = sourceIds.has(segment.id) ? 'SOURCE' : 'CONTEXT';
        return `[${marker} · ${formatTimestamp(segment.startMs)} · ${segment.speakerLabel}] ${segment.text}`;
      }).join('\n')
    : 'No linked source transcript segments are available for this task.';
}

function taskSection({ item, transcription, segments }: TaskChatGptEntry, index?: number): string {
  return `${index ? `SELECTED TASK ${index}\n` : ''}TRANSCRIPTION
Title: ${transcription.title}
Recorded: ${transcription.recordedAt}
${transcription.summary?.trim() ? `Summary: ${transcription.summary.trim()}` : ''}

TASK
${taskMetadata(item)}

RELEVANT TRANSCRIPT CONTEXT
${taskTranscriptContext(item, segments)}`;
}

export function buildTaskChatGptPrompt(item: ExtractedItem, transcription: Transcription, segments: TranscriptSegment[]): string {
  return `I want to work with you on one specific task from a meeting transcription.

Focus on helping me complete this task. Use the transcription context below as evidence, and clearly distinguish what was explicitly said from any assumption or suggestion you make. Do not turn unrelated parts of the meeting into extra work unless I ask.

Start by restating the concrete goal in one sentence. Then help me do the actual task or produce the next useful deliverable. If the task is straightforward, begin working on it instead of asking unnecessary questions.

${taskSection({ item, transcription, segments })}`;
}

export function buildTasksChatGptPrompt(entries: TaskChatGptEntry[]): string {
  if (!entries.length) throw new Error('Choose at least one task to send to ChatGPT.');
  return `I selected ${entries.length} specific task${entries.length === 1 ? '' : 's'} from my transcription workspace and want to work with you on exactly these tasks.

Treat each selected task as a separate work item. Preserve the context attached to each one, distinguish explicit transcript evidence from assumptions, and do not add unrelated tasks from the meetings.

First give me a compact checklist of the selected tasks. Then start helping me complete them in a practical order. When a task can be completed directly (for example drafting text, planning implementation, or producing a deliverable), do the work instead of only describing what I should do. Ask a question only when a genuinely necessary fact is missing.

${entries.map((entry, index) => taskSection(entry, index + 1)).join('\n\n---\n\n')}`;
}

async function copyPromptAndOpenChatGpt(prompt: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.');
  await navigator.clipboard.writeText(prompt);
  window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
}

export async function copyTaskToChatGpt(item: ExtractedItem, transcription: Transcription, segments: TranscriptSegment[]): Promise<void> {
  await copyPromptAndOpenChatGpt(buildTaskChatGptPrompt(item, transcription, segments));
}

export async function copyTasksToChatGpt(entries: TaskChatGptEntry[]): Promise<void> {
  await copyPromptAndOpenChatGpt(buildTasksChatGptPrompt(entries));
}
