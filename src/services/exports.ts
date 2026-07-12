import type { ExtractedItem, TranscriptSegment, Transcription } from '../domain/types';
import { formatTimestamp } from '../lib/format';

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function transcriptAsText(transcription: Transcription, segments: TranscriptSegment[], items: ExtractedItem[]): string {
  const lines = [transcription.title, transcription.recordedAt, ''];
  segments.forEach((segment) => lines.push(`[${formatTimestamp(segment.startMs)}] ${segment.speakerLabel}: ${segment.text}`));
  if (transcription.summary) lines.push('', 'Summary', transcription.summary);
  const tasks = items.filter((item) => item.kind === 'task');
  if (tasks.length) {
    lines.push('', 'Tasks');
    tasks.forEach((task) => lines.push(`- [${task.status === 'completed' ? 'x' : ' '}] ${task.title}`));
  }
  return lines.join('\n');
}

export function exportText(transcription: Transcription, segments: TranscriptSegment[], items: ExtractedItem[]): void {
  download(`${transcription.title}.txt`, `\uFEFF${transcriptAsText(transcription, segments, items)}`, 'text/plain;charset=utf-8');
}

export function exportCsv(transcription: Transcription, items: ExtractedItem[]): void {
  const headers = ['kind', 'title', 'status', 'priority', 'assignee', 'starts_at', 'due_at', 'tags'];
  const rows = items.map((item) => [item.kind, item.title, item.status, item.priority, item.assignee, item.startsAt, item.dueAt, item.tags.join('|')]);
  download(`${transcription.title}-items.csv`, `\uFEFF${[headers, ...rows].map((row) => row.map(safeCell).join(',')).join('\r\n')}`, 'text/csv;charset=utf-8');
}

export function printPdf(transcription: Transcription, segments: TranscriptSegment[], items: ExtractedItem[]): void {
  const popup = window.open('about:blank', '_blank');
  if (!popup) throw new Error('The PDF window was blocked. Allow pop-ups for this app and try again.');
  popup.opener = null;
  const escape = (text: string) => text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!);
  const transcript = segments.map((segment) => `<p dir="auto"><b>${escape(formatTimestamp(segment.startMs))} · ${escape(segment.speakerLabel)}</b><br>${escape(segment.text)}</p>`).join('');
  const taskList = items.filter((item) => item.kind === 'task').map((item) => `<li dir="auto">${escape(item.title)}</li>`).join('');
  const noteList = items.filter((item) => item.kind === 'note' || item.kind === 'takeaway').map((item) => `<li dir="auto">${escape(item.title)}</li>`).join('');
  const eventList = items.filter((item) => item.kind === 'event').map((item) => `<li dir="auto">${escape(item.title)}</li>`).join('');
  const recordedDate = new Date(transcription.recordedAt);
  const recordedLabel = Number.isFinite(recordedDate.getTime()) ? recordedDate.toLocaleString() : transcription.recordedAt;
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(transcription.title)}</title><style>body{font-family:Arial,'Noto Sans Hebrew',sans-serif;max-width:760px;margin:40px auto;color:#17172a;line-height:1.55}h1{font-size:28px}p,li{break-inside:avoid}small{color:#666}@page{margin:18mm}@media print{body{margin:0}}</style></head><body><h1 dir="auto">${escape(transcription.title)}</h1><small>${escape(recordedLabel)}</small>${transcription.summary ? `<h2>Summary</h2><p dir="auto">${escape(transcription.summary)}</p>` : ''}${taskList ? `<h2>Tasks</h2><ul>${taskList}</ul>` : ''}${eventList ? `<h2>Events</h2><ul>${eventList}</ul>` : ''}${noteList ? `<h2>Notes and takeaways</h2><ul>${noteList}</ul>` : ''}<h2>Transcript</h2>${transcript}<script>setTimeout(()=>{window.focus();window.print()},250)</script></body></html>`);
  popup.document.close();
}
