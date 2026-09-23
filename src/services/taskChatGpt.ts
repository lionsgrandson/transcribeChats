import type { ExtractedItem, TranscriptSegment, Transcription } from '../domain/types';
import { formatTimestamp } from '../lib/format';

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

export function buildTaskChatGptPrompt(item: ExtractedItem, transcription: Transcription, segments: TranscriptSegment[]): string {
  const contextSegments = taskContextSegments(item, segments);
  const sourceIds = new Set(item.sourceSegmentIds);
  const metadata = [
    `Task: ${item.title}`,
    item.body?.trim() ? `Details: ${item.body.trim()}` : '',
    `Status: ${item.status}`,
    `Priority: ${item.priority}`,
    item.assignee ? `Assignee: ${item.assignee}` : '',
    item.dueAt ? `Due: ${item.dueAt}` : '',
    item.reminderAt ? `Reminder: ${item.reminderAt}` : '',
    item.tags.length ? `Tags: ${item.tags.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const transcriptContext = contextSegments.length
    ? contextSegments.map((segment) => {
        const marker = sourceIds.has(segment.id) ? 'SOURCE' : 'CONTEXT';
        return `[${marker} · ${formatTimestamp(segment.startMs)} · ${segment.speakerLabel}] ${segment.text}`;
      }).join('\n')
    : 'No linked source transcript segments are available for this task.';

  return `I want to work with you on one specific task from a meeting transcription.

Focus on helping me complete this task. Use the transcription context below as evidence, and clearly distinguish what was explicitly said from any assumption or suggestion you make. Do not turn unrelated parts of the meeting into extra work unless I ask.

Start by restating the concrete goal in one sentence. Then help me do the actual task or produce the next useful deliverable. If the task is straightforward, begin working on it instead of asking unnecessary questions.

TRANSCRIPTION
Title: ${transcription.title}
Recorded: ${transcription.recordedAt}
${transcription.summary?.trim() ? `Summary: ${transcription.summary.trim()}` : ''}

TASK
${metadata}

RELEVANT TRANSCRIPT CONTEXT
${transcriptContext}`;
}

export async function copyTaskToChatGpt(item: ExtractedItem, transcription: Transcription, segments: TranscriptSegment[]): Promise<void> {
  const prompt = buildTaskChatGptPrompt(item, transcription, segments);
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.');
  await navigator.clipboard.writeText(prompt);
  window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
}
