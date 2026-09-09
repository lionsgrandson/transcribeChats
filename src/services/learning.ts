import { z } from 'zod';
import type { SocialAuditAnalysis, StudyAnalysis } from '../domain/learning';

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

async function postJson<T>(workerUrl: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${workerUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Learning worker returned ${response.status}`);
  }
  return schema.parse(await response.json());
}

export function analyzeStudyWithOllama(workerUrl: string, input: { title: string; transcript: string; context: string }): Promise<StudyAnalysis> {
  return postJson(workerUrl, '/v1/study', input, studySchema);
}

export function analyzeSocialAuditWithOllama(workerUrl: string, input: { title: string; transcript: string; context: string }): Promise<SocialAuditAnalysis> {
  return postJson(workerUrl, '/v1/social-audit', input, socialAuditSchema);
}

export function buildStudyChatGptPrompt(title: string, transcript: string, analysis: StudyAnalysis): string {
  return `You are my expert tutor and curriculum designer. Improve this locally generated study pack without deleting useful material. Correct mistakes against the transcript, improve the hierarchy, add missing active-recall questions, make the test genuinely challenging, and make the practice tasks prove mastery rather than passive reading. Keep claims grounded in the source.\n\nTITLE:\n${title}\n\nLOCAL OLLAMA STUDY PACK:\n${JSON.stringify(analysis, null, 2)}\n\nSOURCE TRANSCRIPT:\n${transcript}`;
}

export function buildAuditChatGptPrompt(title: string, transcript: string, analysis: SocialAuditAnalysis): string {
  return `Review this conversation audit as a careful coach. Improve the emotional, logical, and social analysis while staying evidence-based. Do not diagnose anyone, do not claim hidden intent as fact, distinguish observation from interpretation, add plausible alternative explanations, and focus on habits, social norms, communication choices, and practical lessons I can test.\n\nTITLE:\n${title}\n\nLOCAL OLLAMA AUDIT:\n${JSON.stringify(analysis, null, 2)}\n\nSOURCE TRANSCRIPT:\n${transcript}`;
}

export async function copyAndOpenChatGpt(prompt: string): Promise<void> {
  await navigator.clipboard.writeText(prompt);
  window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
}
