import type { AnalysisResult, ExtractedItem, ItemKind, Priority } from '../domain/types';

const actionVerbs = '(?:send|call|email|schedule|book|prepare|deliver|finish|update|review|follow\\s+up|pay|buy|submit|upload|create|fix|contact|share|write)';
const explicitEnglishTask = new RegExp(`\\b(?:(?:i|we|you|[A-Z][a-z]+)\\s+(?:will|shall|must|have\\s+to|am\\s+going\\s+to|are\\s+going\\s+to|committed\\s+to)|(?:please|can\\s+you|could\\s+you))\\s+${actionVerbs}\\b`, 'i');
const explicitHebrewTask = /(?:\u05d0\u05e0\u05d9|\u05d0\u05e0\u05d7\u05e0\u05d5)\s+(?:\u05d0\u05e9\u05dc\u05d7|\u05e0\u05e9\u05dc\u05d7|\u05d0\u05ea\u05e7\u05e9\u05e8|\u05e0\u05ea\u05e7\u05e9\u05e8|\u05d0\u05db\u05d9\u05df|\u05e0\u05db\u05d9\u05df|\u05d0\u05e1\u05d9\u05d9\u05dd|\u05e0\u05e1\u05d9\u05d9\u05dd|\u05d0\u05e2\u05d3\u05db\u05df|\u05e0\u05e2\u05d3\u05db\u05df|\u05d0\u05e7\u05d1\u05e2|\u05e0\u05e7\u05d1\u05e2|\u05d0\u05d8\u05e4\u05dc|\u05e0\u05d8\u05e4\u05dc)|(?:\u05d1\u05d1\u05e7\u05e9\u05d4|\u05e0\u05d0)\s+(?:\u05e9\u05dc\u05d7|\u05ea\u05e9\u05dc\u05d7|\u05d4\u05ea\u05e7\u05e9\u05e8|\u05ea\u05ea\u05e7\u05e9\u05e8|\u05ea\u05db\u05d9\u05df|\u05ea\u05e2\u05d3\u05db\u05df|\u05ea\u05e7\u05d1\u05e2)/i;
const explicitMeeting = /\b(?:let'?s|we\s+will|can\s+we|please)\s+(?:(?:have|schedule|book)\s+)?(?:a\s+)?(?:meeting|call|appointment)\b|\b(?:schedule|book)\s+(?:a\s+)?(?:meeting|call|appointment)\b|(?:\u05d1\u05d5\u05d0\u05d5?|\u05e0\u05e7\u05d1\u05e2)\s+(?:\u05e4\u05d2\u05d9\u05e9\u05d4|\u05d9\u05e9\u05d9\u05d1\u05d4|\u05e9\u05d9\u05d7\u05d4)/i;
const explicitDecision = /\b(?:we\s+decided|we\s+agreed|decision:)\b|(?:\u05d4\u05d7\u05dc\u05d8\u05e0\u05d5|\u05e1\u05d9\u05db\u05de\u05e0\u05d5)/i;

function inferPriority(text: string): Priority {
  if (/urgent|asap|immediately|\u05d3\u05d7\u05d5\u05e3|\u05de\u05d9\u05d9\u05d3/i.test(text)) return 'urgent';
  if (/important|high priority|\u05d7\u05e9\u05d5\u05d1|\u05e2\u05d3\u05d9\u05e4\u05d5\u05ea \u05d2\u05d1\u05d5\u05d4\u05d4/i.test(text)) return 'high';
  return 'medium';
}

function inferDate(text: string, conversationDate: Date): string | undefined {
  const value = new Date(conversationDate);
  const isoDate = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoDate) value.setFullYear(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
  else if (/tomorrow|\u05de\u05d7\u05e8/i.test(text)) value.setDate(value.getDate() + 1);
  else if (/next week|\u05e9\u05d1\u05d5\u05e2 \u05d4\u05d1\u05d0/i.test(text)) value.setDate(value.getDate() + 7);
  else if (!/today|\u05d4\u05d9\u05d5\u05dd/i.test(text)) return undefined;

  const time = text.match(/(?:at|\u05d1\u05e9\u05e2\u05d4)\s*(\d{1,2})(?::(\d{2}))?/i);
  if (time) value.setHours(Number(time[1]), Number(time[2] || 0), 0, 0);
  else value.setHours(9, 0, 0, 0);
  return value.toISOString();
}

function makeItem(kind: ItemKind, text: string, sourceSegmentIds: string[], conversationDate: Date): Omit<ExtractedItem, 'id' | 'transcriptionId' | 'createdAt' | 'updatedAt'> {
  const dueAt = kind === 'task' ? inferDate(text, conversationDate) : undefined;
  const startsAt = kind === 'event' ? inferDate(text, conversationDate) : undefined;
  return {
    kind,
    title: text.trim().replace(/^[-\u2013\u2022]\s*/, '').slice(0, 180),
    status: kind === 'task' || kind === 'event' ? 'needs_review' : 'open',
    priority: kind === 'task' ? inferPriority(text) : 'none',
    dueAt,
    startsAt,
    tags: [],
    sourceSegmentIds,
    confidence: kind === 'event' && !startsAt ? 0.72 : 0.9,
    uncertaintyReason: kind === 'event' && !startsAt ? 'Meeting intent is explicit, but a date and time must be added before it appears on the calendar.' : undefined,
    confirmed: false
  };
}

export function analyzeText(text: string, conversationDate = new Date(), segmentIds: string[] = []): AnalysisResult {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 3);
  const items: AnalysisResult['items'] = [];

  sentences.forEach((sentence, index) => {
    const source = segmentIds[index] ? [segmentIds[index]] : segmentIds.slice(0, 1);
    if (explicitMeeting.test(sentence)) items.push(makeItem('event', sentence, source, conversationDate));
    else if (explicitEnglishTask.test(sentence) || explicitHebrewTask.test(sentence)) items.push(makeItem('task', sentence, source, conversationDate));
    else if (explicitDecision.test(sentence)) items.push(makeItem('takeaway', sentence, source, conversationDate));
  });

  const summary = sentences.slice(0, 3).join(' ').slice(0, 600) || text.slice(0, 600);
  return { summary, items };
}
