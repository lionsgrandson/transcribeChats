import { z } from 'zod';
import type { SocialAuditAnalysis, StudyAnalysis } from '../domain/learning';
import type { LanguageMode } from '../domain/types';

const difficulty = z.enum(['easy', 'medium', 'hard']);
const topicSchema = z.object({
  id: z.string(),
  title: z.string(),
  parentId: z.string().nullable().optional(),
  summary: z.string(),
  keyPoints: z.array(z.string()).default([]),
  examples: z.array(z.string()).default([]),
  commonMistakes: z.array(z.string()).default([]),
  prerequisites: z.array(z.string()).default([])
});
const questionSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  type: z.enum(['multiple_choice', 'short_answer', 'explain', 'code']),
  prompt: z.string(),
  choices: z.array(z.string()).default([]),
  answer: z.string(),
  explanation: z.string(),
  difficulty
});
const studySchema = z.object({
  title: z.string(),
  suggestedPath: z.array(z.string()).default([]),
  overview: z.string(),
  learningObjectives: z.array(z.string()).default([]),
  topics: z.array(topicSchema).default([]),
  flashcards: z.array(z.object({
    id: z.string(), topicId: z.string(), front: z.string(), back: z.string(), difficulty
  })).default([]),
  quiz: z.array(questionSchema).default([]),
  test: z.array(questionSchema).default([]),
  tasks: z.array(z.object({
    id: z.string(), topicId: z.string(), title: z.string(), instruction: z.string(),
    successCriteria: z.string(), difficulty
  })).default([]),
  reviewScheduleDays: z.array(z.number().int().positive()).default([1, 3, 7, 14, 30])
});

const observationSchema = z.object({
  title: z.string(),
  evidence: z.array(z.string()).default([]),
  interpretation: z.string(),
  alternatives: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1)
});
const socialAuditSchema = z.object({
  title: z.string(),
  summary: z.string(),
  emotional: z.array(observationSchema).default([]),
  logical: z.array(observationSchema).default([]),
  social: z.array(observationSchema).default([]),
  habitsAndPatterns: z.array(observationSchema).default([]),
  possibleBlindSpots: z.array(observationSchema).default([]),
  strengths: z.array(z.string()).default([]),
  socialNormsWorthLearning: z.array(z.object({ norm: z.string(), whyItMatters: z.string(), example: z.string() })).default([]),
  lessons: z.array(z.string()).default([]),
  reflectionQuestions: z.array(z.string()).default([]),
  experiments: z.array(z.object({ title: z.string(), action: z.string(), whatToNotice: z.string() })).default([]),
  uncertaintyNotes: z.array(z.string()).default([])
});

const youtubeImportSchema = z.object({
  title: z.string(),
  sourceName: z.string(),
  transcript: z.string().min(1),
  method: z.enum(['captions', 'whisper']),
  videoId: z.string(),
  webpageUrl: z.string(),
  durationSeconds: z.number().int().nonnegative().nullable().optional()
});

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(record: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function readableText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!isRecord(value)) return '';

  const primary = pick(value, [
    'text', 'title', 'name', 'strength', 'lesson', 'question', 'note', 'summary',
    'description', 'observation', 'finding', 'pattern', 'blindSpot', 'norm', 'action',
    'interpretation', 'insight', 'takeaway', 'value'
  ]);
  const primaryText = typeof primary === 'string' ? primary.trim() : '';
  const detail = pick(value, ['evidence', 'reason', 'why', 'whyItMatters', 'explanation', 'detail', 'context']);
  const detailText = typeof detail === 'string'
    ? detail.trim()
    : Array.isArray(detail)
      ? detail.map((item) => readableText(item)).filter(Boolean).join('; ')
      : '';

  if (primaryText && detailText && primaryText !== detailText) return `${primaryText} — ${detailText}`;
  if (primaryText) return primaryText;
  if (detailText) return detailText;

  const fallback = Object.values(value)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  return [...new Set(fallback)].join(' — ');
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map((item) => readableText(item)).filter(Boolean);
}

function firstText(record: UnknownRecord, keys: string[], fallback = ''): string {
  const value = pick(record, keys);
  const text = readableText(value);
  return text || fallback;
}

function shortTitle(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  const sentence = normalized.split(/[.!?]\s/)[0] || normalized;
  return sentence.length > 80 ? `${sentence.slice(0, 77).trim()}…` : sentence;
}

function confidenceValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    const numeric = Number.parseFloat(normalized.replace('%', ''));
    if (Number.isFinite(numeric)) return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
    if (normalized.includes('high')) return 0.85;
    if (normalized.includes('medium') || normalized.includes('moderate')) return 0.65;
    if (normalized.includes('low')) return 0.4;
  }
  return 0.5;
}

function normalizeObservation(value: unknown, index: number): z.infer<typeof observationSchema> {
  if (typeof value === 'string') {
    const interpretation = value.trim();
    return {
      title: shortTitle(interpretation, `Observation ${index + 1}`),
      evidence: [],
      interpretation,
      alternatives: [],
      confidence: 0.5
    };
  }

  const record = isRecord(value) ? value : {};
  const interpretation = firstText(record, [
    'interpretation', 'analysis', 'meaning', 'explanation', 'description', 'summary',
    'insight', 'finding', 'observation', 'text', 'takeaway', 'pattern', 'blindSpot'
  ]);
  const title = firstText(record, [
    'title', 'name', 'label', 'theme', 'point', 'pattern', 'issue', 'finding',
    'observation', 'behavior', 'blindSpot'
  ], shortTitle(interpretation, `Observation ${index + 1}`));
  const fallbackInterpretation = interpretation || firstText(record, ['title', 'name', 'label'], title);

  return {
    title,
    evidence: stringList(pick(record, ['evidence', 'examples', 'example', 'quotes', 'quote', 'support', 'signals'])),
    interpretation: fallbackInterpretation,
    alternatives: stringList(pick(record, [
      'alternatives', 'alternativeExplanations', 'otherExplanations', 'alternative',
      'otherInterpretations', 'plausibleAlternatives'
    ])),
    confidence: confidenceValue(pick(record, ['confidence', 'certainty', 'confidenceScore']))
  };
}

function normalizeObservationList(value: unknown): z.infer<typeof observationSchema>[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return values.map((item, index) => normalizeObservation(item, index));
}

function normalizeNorm(value: unknown): z.infer<typeof socialAuditSchema>['socialNormsWorthLearning'][number] {
  if (typeof value === 'string') return { norm: value.trim(), whyItMatters: '', example: '' };
  const record = isRecord(value) ? value : {};
  return {
    norm: firstText(record, ['norm', 'title', 'name', 'rule', 'principle', 'behavior'], readableText(record)),
    whyItMatters: firstText(record, ['whyItMatters', 'why', 'reason', 'importance', 'rationale', 'explanation']),
    example: firstText(record, ['example', 'examplePhrase', 'sample', 'howToApply', 'application'])
  };
}

function normalizeExperiment(value: unknown, index: number): z.infer<typeof socialAuditSchema>['experiments'][number] {
  if (typeof value === 'string') {
    const action = value.trim();
    return { title: shortTitle(action, `Experiment ${index + 1}`), action, whatToNotice: '' };
  }
  const record = isRecord(value) ? value : {};
  const action = firstText(record, ['action', 'whatToDo', 'instruction', 'exercise', 'try', 'practice', 'description']);
  return {
    title: firstText(record, ['title', 'name', 'experiment', 'practice'], shortTitle(action, `Experiment ${index + 1}`)),
    action: action || readableText(record),
    whatToNotice: firstText(record, ['whatToNotice', 'notice', 'observe', 'watchFor', 'measure', 'lookFor'])
  };
}

function unwrapAudit(value: unknown): UnknownRecord {
  if (!isRecord(value)) return {};
  for (const key of ['audit', 'socialAudit', 'conversationAudit', 'result']) {
    const nested = value[key];
    if (isRecord(nested)) return nested;
  }
  if (isRecord(value.analysis) && ('emotional' in value.analysis || 'logical' in value.analysis || 'social' in value.analysis)) {
    return value.analysis;
  }
  return value;
}

function normalizeSocialAudit(value: unknown): unknown {
  const record = unwrapAudit(value);
  const norms = pick(record, ['socialNormsWorthLearning', 'socialNorms', 'norms']);
  const experiments = pick(record, ['experiments', 'thingsToTry', 'practiceExperiments']);

  return {
    title: firstText(record, ['title', 'name'], 'Conversation audit'),
    summary: firstText(record, ['summary', 'overview', 'overallSummary', 'executiveSummary']),
    emotional: normalizeObservationList(pick(record, ['emotional', 'emotionalAnalysis', 'emotions'])),
    logical: normalizeObservationList(pick(record, ['logical', 'logicalAnalysis', 'reasoning'])),
    social: normalizeObservationList(pick(record, ['social', 'socialAnalysis', 'socialDynamics'])),
    habitsAndPatterns: normalizeObservationList(pick(record, ['habitsAndPatterns', 'patterns', 'habits', 'behavioralPatterns'])),
    possibleBlindSpots: normalizeObservationList(pick(record, ['possibleBlindSpots', 'blindSpots', 'blindspots', 'possibleBlindspots'])),
    strengths: stringList(pick(record, ['strengths', 'whatWorked', 'positives'])),
    socialNormsWorthLearning: (Array.isArray(norms) ? norms : norms === undefined || norms === null ? [] : [norms]).map(normalizeNorm),
    lessons: stringList(pick(record, ['lessons', 'takeaways', 'keyLessons'])),
    reflectionQuestions: stringList(pick(record, ['reflectionQuestions', 'questionsToReflectOn', 'reflection'])),
    experiments: (Array.isArray(experiments) ? experiments : experiments === undefined || experiments === null ? [] : [experiments]).map(normalizeExperiment),
    uncertaintyNotes: stringList(pick(record, ['uncertaintyNotes', 'uncertainties', 'limitations', 'caveats']))
  };
}

async function postJson<T>(workerUrl: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${workerUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const raw = await response.text();
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as { detail?: string };
      detail = parsed.detail || raw;
    } catch {
      // Keep the raw response when the worker did not return JSON.
    }
    throw new Error(detail || `Learning worker returned ${response.status}`);
  }
  return schema.parse(await response.json());
}

function parseChatGptJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Paste the ChatGPT result first.');

  try {
    return JSON.parse(trimmed);
  } catch {
    // ChatGPT may wrap the replacement object in a JSON code fence.
  }

  const fenced = [...trimmed.matchAll(/```json\s*([\s\S]*?)```/gi)];
  for (const match of fenced.reverse()) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      // Try another fenced block or the broad object fallback below.
    }
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // Fall through to the clearer error below.
    }
  }
  throw new Error('I could not find a valid JSON study/audit result in that ChatGPT response. Ask ChatGPT to return the complete replacement JSON object and paste it again.');
}

export function analyzeStudyWithOllama(workerUrl: string, input: { title: string; transcript: string; context: string }): Promise<StudyAnalysis> {
  return postJson(workerUrl, '/v1/study', input, studySchema);
}

export function analyzeSocialAuditWithOllama(workerUrl: string, input: { title: string; transcript: string; context: string }): Promise<SocialAuditAnalysis> {
  return postJson(workerUrl, '/v1/social-audit', input, socialAuditSchema);
}

export function importYouTubeTranscript(workerUrl: string, input: { url: string; languageMode: LanguageMode; context: string }) {
  return postJson(workerUrl, '/v1/youtube/transcript', {
    url: input.url,
    language_mode: input.languageMode,
    context: input.context
  }, youtubeImportSchema);
}

export function parseStudyChatGptResult(value: string): StudyAnalysis {
  return studySchema.parse(parseChatGptJson(value));
}

export function parseSocialAuditChatGptResult(value: string): SocialAuditAnalysis {
  return socialAuditSchema.parse(normalizeSocialAudit(parseChatGptJson(value)));
}

export function buildStudyChatGptPrompt(title: string, transcript: string, analysis: StudyAnalysis): string {
  return `You are my expert tutor and curriculum designer. Improve this locally generated study pack without deleting useful material. Correct mistakes against the transcript, improve the hierarchy, add missing active-recall questions, make the test genuinely challenging, and make the practice tasks prove mastery rather than passive reading. Keep claims grounded in the source.

IMPORTANT RETURN CONTRACT:
- Return the COMPLETE replacement study pack as one valid JSON object only.
- Keep exactly the same top-level structure and field names as LOCAL OLLAMA STUDY PACK.
- Preserve existing ids when an item still represents the same topic/question/task/flashcard so my learning progress can be preserved.
- New items must get short unique string ids.
- Do not add commentary before or after the JSON.
- Do not omit arrays just because they are empty.

TITLE:
${title}

LOCAL OLLAMA STUDY PACK:
${JSON.stringify(analysis, null, 2)}

SOURCE TRANSCRIPT:
${transcript}`;
}

export function buildAuditChatGptPrompt(title: string, transcript: string, analysis: SocialAuditAnalysis): string {
  return `Review this conversation audit as a careful coach. Improve the emotional, logical, and social analysis while staying evidence-based. Do not diagnose anyone, do not claim hidden intent as fact, distinguish observation from interpretation, add plausible alternative explanations, and focus on habits, social norms, communication choices, and practical lessons I can test.

IMPORTANT RETURN CONTRACT:
- Return the COMPLETE replacement audit as one valid JSON object only.
- Keep exactly the same top-level structure and field names as LOCAL OLLAMA AUDIT.
- emotional, logical, social, habitsAndPatterns, and possibleBlindSpots must contain objects with exactly: title (string), evidence (string array), interpretation (string), alternatives (string array), confidence (number from 0 to 1).
- strengths, lessons, reflectionQuestions, and uncertaintyNotes must be arrays of STRINGS, not objects.
- socialNormsWorthLearning items must use exactly: norm, whyItMatters, example.
- experiments items must use exactly: title, action, whatToNotice.
- Keep confidence values between 0 and 1.
- Do not add commentary before or after the JSON.
- Do not omit arrays just because they are empty.

TITLE:
${title}

LOCAL OLLAMA AUDIT:
${JSON.stringify(analysis, null, 2)}

SOURCE TRANSCRIPT:
${transcript}`;
}

export async function copyAndOpenChatGpt(prompt: string): Promise<void> {
  await navigator.clipboard.writeText(prompt);
  window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
}
