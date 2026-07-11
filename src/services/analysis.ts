import type { AnalysisResult, ExtractedItem, ItemKind, Priority } from '../domain/types';

const taskSignals = /\b(will|need to|needs to|should|action item|follow up|send|prepare|finish|call|email)\b|צריך|צריכה|אשלח|ישלח|תשלח|להכין|לסיים|לטפל|משימה/i;
const eventSignals = /\b(meeting|review|appointment|birthday|offline|vacation|deadline|launch)\b|פגישה|ישיבה|סקירה|יום הולדת|חופש|לא זמין|השקה/i;
const importantSignals = /\b(important|remember|decision|agreed|confirmed|blocked)\b|חשוב|לזכור|החלטה|סיכמנו|אושר|חסום/i;

function inferPriority(text: string): Priority {
  if (/urgent|asap|immediately|דחוף|מייד/i.test(text)) return 'urgent';
  if (/important|high priority|חשוב|עדיפות גבוהה/i.test(text)) return 'high';
  return 'medium';
}

function inferDate(text: string, conversationDate: Date): string | undefined {
  const value = new Date(conversationDate);
  if (/tomorrow|מחר/i.test(text)) value.setDate(value.getDate() + 1);
  else if (/next week|שבוע הבא/i.test(text)) value.setDate(value.getDate() + 7);
  else if (/today|היום/i.test(text)) { /* same day */ }
  else return undefined;

  const time = text.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?/i);
  if (time) value.setHours(Number(time[1]), Number(time[2] || 0), 0, 0);
  else value.setHours(9, 0, 0, 0);
  return value.toISOString();
}

function makeItem(
  kind: ItemKind,
  text: string,
  sourceSegmentIds: string[],
  conversationDate: Date
): Omit<ExtractedItem, 'id' | 'transcriptionId' | 'createdAt' | 'updatedAt'> {
  const dueAt = kind === 'task' ? inferDate(text, conversationDate) : undefined;
  const startsAt = kind === 'event' ? inferDate(text, conversationDate) : undefined;
  return {
    kind,
    title: text.trim().replace(/^[-–•]\s*/, '').slice(0, 180),
    status: kind === 'task' || kind === 'event' ? 'needs_review' : 'open',
    priority: kind === 'task' ? inferPriority(text) : 'none',
    dueAt,
    startsAt,
    tags: [],
    sourceSegmentIds,
    confidence: kind === 'note' ? 0.62 : 0.72,
    uncertaintyReason: /tomorrow|next week|מחר|שבוע הבא/i.test(text) ? 'Relative date inferred from the conversation date.' : undefined,
    confirmed: false
  };
}

export function analyzeText(
  text: string,
  conversationDate = new Date(),
  segmentIds: string[] = []
): AnalysisResult {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 3);
  const items: AnalysisResult['items'] = [];

  sentences.forEach((sentence, index) => {
    const source = segmentIds[index] ? [segmentIds[index]] : segmentIds.slice(0, 1);
    if (taskSignals.test(sentence)) items.push(makeItem('task', sentence, source, conversationDate));
    else if (eventSignals.test(sentence)) items.push(makeItem('event', sentence, source, conversationDate));
    else if (importantSignals.test(sentence)) items.push(makeItem('takeaway', sentence, source, conversationDate));
  });

  const summary = sentences.slice(0, 3).join(' ').slice(0, 600) || text.slice(0, 600);
  return { summary, items };
}
