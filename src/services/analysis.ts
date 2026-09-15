import type { AnalysisResult, ExtractedItem, ItemKind, Priority } from '../domain/types';

const actionVerbs = '(?:ask|send|call|email|schedule|book|prepare|deliver|finish|complete|update|review|check|confirm|arrange|organize|handle|research|draft|test|investigate|remind|follow\\s+up|pay|buy|submit|upload|create|fix|contact|share|write|implement|build|change|add|remove|backup|migrate)';
const explicitEnglishTask = new RegExp(`\\b(?:(?:i|we)\\s+(?:will|shall|must|have\\s+to|need\\s+to|am\\s+going\\s+to|are\\s+going\\s+to|committed\\s+to)|(?:i|we)['’]ll|you\\s+(?:must|have\\s+to|need\\s+to)|(?:please|can\\s+you|could\\s+you|would\\s+you|will\\s+you))\\s+${actionVerbs}\\b|^\\s*(?:please\\s+)?${actionVerbs}\\b`, 'i');
const explicitHebrewTask = /(?:אני|אנחנו)\s+(?:אשלח|נשלח|אתקשר|נתקשר|אכין|נכין|אסיים|נסיים|אעדכן|נעדכן|אקבע|נקבע|אטפל|נטפל|אבדוק|נבדוק|אאשר|נאשר|אסדר|נסדר|אארגן|נארגן|אחקור|נחקור|אכתוב|נכתוב|אצור|ניצור|אתקן|נתקן|אעלה|נעלה|אבנה|נבנה|אשלם|נשלם)|(?:בבקשה|נא)\s+(?:שלח|תשלח|התקשר|תתקשר|תכין|תסיים|תעדכן|תקבע|תבדוק|תטפל|תאשר|תסדר|תארגן|תחקור|תכתוב|תיצור|תתקן|תעלה|תבנה|תשלם)/i;
const nonAction = /\b(?:need\s+to|have\s+to|must)\s+(?:understand|know|remember|realize|consider|think|feel)\b|(?:צריך|צריכה|צריכים|חייב|חייבת|חייבים)\s+ל(?:הבין|דעת|זכור|חשוב|שקול|הרגיש)/i;
const eventNoun = /\b(?:meeting|call|appointment|demo|interview|workshop|visit|presentation|launch|delivery|trip|flight|deadline|renewal|expiration)\b|(?:פגישה|ישיבה|שיחה|שיחת|דמו|ראיון|סדנה|ביקור|מצגת|השקה|אספקה|נסיעה|טיסה|דדליין|חידוש|תפוגה)/i;
const meetingProposal = /\b(?:let'?s|can\s+we|please)\b.{0,70}\b(?:meeting|call|appointment)\b|(?:בואו?|נקבע).{0,45}(?:פגישה|ישיבה|שיחה)/i;
const plannedEvent = /\b(?:there\s+(?:is|will\s+be)|we\s+have|i\s+have|is\s+scheduled|is\s+planned|is\s+booked|is\s+set|will\s+be)\b|(?:יש\s+(?:לנו|לי)?|תהיה|יהיה|נקבעה|נקבע|קבענו|מתוכננת|מתוכנן|סגורה|סגור)/i;
const pastEvent = /\b(?:had\s+(?:a\s+)?(?:meeting|call|appointment)|yesterday|last\s+week)\b|(?:הייתה\s+(?:פגישה|ישיבה|שיחה)|אתמול|שבוע\s+שעבר|נפגשנו)/i;
const explicitDecision = /\b(?:we\s+decided|we\s+agreed|decision:)\b|(?:החלטנו|סיכמנו)/i;
const weekdays: Array<[RegExp, number]> = [
  [/\bmonday\b|(?:ביום\s+|יום\s+|ב)?שני\b/i, 1],
  [/\btuesday\b|(?:ביום\s+|יום\s+|ב)?שלישי\b/i, 2],
  [/\bwednesday\b|(?:ביום\s+|יום\s+|ב)?רביעי\b/i, 3],
  [/\bthursday\b|(?:ביום\s+|יום\s+|ב)?חמישי\b/i, 4],
  [/\bfriday\b|(?:ביום\s+|יום\s+|ב)?שישי\b/i, 5],
  [/\bsaturday\b|(?:ביום\s+|יום\s+|ב)?שבת\b/i, 6],
  [/\bsunday\b|(?:ביום\s+|יום\s+|ב)?ראשון\b/i, 0]
];

function inferPriority(text: string): Priority {
  if (/urgent|asap|immediately|דחוף|מייד/i.test(text)) return 'urgent';
  if (/important|high priority|חשוב|עדיפות גבוהה/i.test(text)) return 'high';
  return 'medium';
}

function hasExplicitTime(text: string): boolean {
  return /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/i.test(text) || /(?:\bat\b|בשעה|ב-)\s*(?:[01]?\d|2[0-3])\b/i.test(text);
}

function inferDate(text: string, conversationDate: Date): string | undefined {
  const value = new Date(conversationDate);
  let found = false;
  const isoDate = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  const slashDate = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](20\d{2}|\d{2}))?\b/);
  if (isoDate) {
    value.setFullYear(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])); found = true;
  } else if (slashDate) {
    const rawYear = slashDate[3] ? Number(slashDate[3]) : value.getFullYear();
    value.setFullYear(rawYear < 100 ? rawYear + 2000 : rawYear, Number(slashDate[2]) - 1, Number(slashDate[1])); found = true;
  } else if (/day\s+after\s+tomorrow|מחרתיים/i.test(text)) {
    value.setDate(value.getDate() + 2); found = true;
  } else if (/tomorrow|מחר/i.test(text)) {
    value.setDate(value.getDate() + 1); found = true;
  } else if (/today|היום/i.test(text)) {
    found = true;
  } else {
    const relativeDays = text.match(/\bin\s+(\d{1,2})\s+days?\b|בעוד\s+(\d{1,2})\s+ימים/i);
    if (relativeDays) {
      value.setDate(value.getDate() + Number(relativeDays[1] || relativeDays[2])); found = true;
    } else {
      for (const [pattern, targetDay] of weekdays) {
        if (!pattern.test(text)) continue;
        const delta = (targetDay - value.getDay() + 7) % 7;
        value.setDate(value.getDate() + delta); found = true; break;
      }
    }
  }
  if (!found) return undefined;
  const time = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b|(?:\bat\b|בשעה|ב-)\s*([01]?\d|2[0-3])\b/i);
  value.setHours(Number(time?.[1] || time?.[3] || 0), Number(time?.[2] || 0), 0, 0);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:00`;
}

function isExplicitTask(text: string): boolean {
  return !nonAction.test(text) && (explicitEnglishTask.test(text) || explicitHebrewTask.test(text));
}

function isTimelineEvent(text: string, conversationDate: Date): boolean {
  if (!eventNoun.test(text) || pastEvent.test(text)) return false;
  if (meetingProposal.test(text) || plannedEvent.test(text)) return true;
  return Boolean(inferDate(text, conversationDate)) && !isExplicitTask(text);
}

function makeItem(kind: ItemKind, text: string, sourceSegmentIds: string[], conversationDate: Date): Omit<ExtractedItem, 'id' | 'transcriptionId' | 'createdAt' | 'updatedAt'> {
  const date = kind === 'task' || kind === 'event' ? inferDate(text, conversationDate) : undefined;
  const dateOnly = Boolean(date && !hasExplicitTime(text));
  return {
    kind,
    title: text.trim().replace(/^[-–•]\s*/, '').slice(0, 180),
    body: kind === 'takeaway' || kind === 'note' ? text.trim() : undefined,
    status: kind === 'task' || kind === 'event' ? 'needs_review' : 'open',
    priority: kind === 'task' ? inferPriority(text) : 'none',
    dueAt: kind === 'task' ? date : undefined,
    startsAt: kind === 'event' ? date : undefined,
    tags: dateOnly ? ['date-only'] : [],
    sourceSegmentIds,
    confidence: kind === 'event' && !date ? 0.72 : 0.9,
    uncertaintyReason: kind === 'event' && !date ? 'The event is explicit, but its date/time was not stated.' : dateOnly ? (kind === 'event' ? 'The date is stated, but the time is not.' : 'The due date is stated, but no time was given.') : undefined,
    confirmed: false
  };
}

export function analyzeText(text: string, conversationDate = new Date(), segmentIds: string[] = []): AnalysisResult {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 3);
  const items: AnalysisResult['items'] = [];

  sentences.forEach((sentence, index) => {
    const source = segmentIds[index] ? [segmentIds[index]] : segmentIds.slice(0, 1);
    if (isExplicitTask(sentence)) items.push(makeItem('task', sentence, source, conversationDate));
    else if (isTimelineEvent(sentence, conversationDate)) items.push(makeItem('event', sentence, source, conversationDate));
    else if (explicitDecision.test(sentence)) items.push(makeItem('takeaway', sentence, source, conversationDate));
  });

  const summary = sentences.slice(0, 8).join(' ').slice(0, 1200) || text.slice(0, 1200);
  return { summary, items };
}
