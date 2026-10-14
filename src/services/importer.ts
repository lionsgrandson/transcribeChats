import { z } from 'zod';
import type { ExtractedItem, ImportPreview } from '../domain/types';

function normalizeOptionalDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const candidate = value.trim();
  if (!candidate || !/^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(candidate)) return undefined;
  const normalized = candidate.length === 10 ? `${candidate}T00:00:00` : candidate.replace(' ', 'T');
  return Number.isFinite(new Date(normalized).getTime()) ? normalized : undefined;
}

const optionalDateSchema = z.preprocess(normalizeOptionalDate, z.string().optional());

const importItemSchema = z.object({
  kind: z.enum(['task', 'event', 'note', 'takeaway', 'summary']),
  title: z.string().min(1).max(300),
  body: z.string().max(5000).optional(),
  status: z.enum(['needs_review', 'open', 'completed', 'dismissed']).default('needs_review'),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).default('none'),
  assignee: z.string().max(200).optional().nullable().transform((value) => value || undefined),
  startsAt: optionalDateSchema,
  endsAt: optionalDateSchema,
  dueAt: optionalDateSchema,
  reminderAt: optionalDateSchema,
  tags: z.array(z.string().max(80)).default([]),
  sourceSegmentIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.7),
  uncertaintyReason: z.string().max(500).optional().nullable().transform((value) => value || undefined),
  confirmed: z.boolean().default(false)
});

function extractJson(value: string): unknown {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? value;
  return JSON.parse(candidate.trim());
}

const duplicateNoise = new Set([
  'the','a','an','to','of','and','for','with','on','in','at','from','by','please','need','needs','will',
  'את','של','על','עם','ו','או','צריך','צריכה','צריכים','יש','נא','בבקשה','כדי','לגבי'
]);

function semanticTokens(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !duplicateNoise.has(token)));
}

function containmentSimilarity(left: string, right: string): number {
  const a = semanticTokens(left);
  const b = semanticTokens(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / Math.min(a.size, b.size);
}

function sameMeaning(
  left: Pick<ExtractedItem, 'kind' | 'title' | 'body' | 'assignee' | 'dueAt' | 'startsAt' | 'sourceSegmentIds'>,
  right: Pick<ExtractedItem, 'kind' | 'title' | 'body' | 'assignee' | 'dueAt' | 'startsAt' | 'sourceSegmentIds'>
): boolean {
  if (left.kind !== right.kind) return false;
  const leftText = `${left.title} ${left.body || ''}`;
  const rightText = `${right.title} ${right.body || ''}`;
  const similarity = containmentSimilarity(leftText, rightText);
  const sharedSource = left.sourceSegmentIds.some((id) => right.sourceSegmentIds.includes(id));
  const sameOwner = Boolean(left.assignee && right.assignee && left.assignee === right.assignee);
  const sameDate = Boolean((left.dueAt && left.dueAt === right.dueAt) || (left.startsAt && left.startsAt === right.startsAt));
  return similarity >= 0.78 || (sharedSource && similarity >= 0.45) || ((sameOwner || sameDate) && similarity >= 0.62);
}

export function previewImport(
  raw: string,
  existing: ExtractedItem[]
): ImportPreview {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch {
    return { valid: [], invalid: ['The pasted content is not valid JSON.'], duplicates: [] };
  }

  const parsedSummary = typeof parsed === 'object' && parsed !== null && 'summary' in parsed && typeof (parsed as { summary?: unknown }).summary === 'string'
    ? (parsed as { summary: string }).summary.trim()
    : '';
  const rawValues = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && 'items' in parsed
      ? (parsed as { items: unknown }).items
      : [];
  if (!Array.isArray(rawValues)) return { valid: [], invalid: ['Expected an items array.'], duplicates: [] };
  const values = parsedSummary
    ? [{ kind: 'summary', title: 'Detailed meeting analysis', body: parsedSummary, status: 'open', priority: 'none', sourceSegmentIds: [], confidence: 1, confirmed: false }, ...rawValues]
    : rawValues;

  const valid: ImportPreview['valid'] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  values.forEach((value, index) => {
    const result = importItemSchema.safeParse(value);
    if (!result.success) {
      invalid.push(`Item ${index + 1}: ${result.error.issues[0]?.message ?? 'Invalid item'}`);
      return;
    }
    const normalizedKind = result.data.kind === 'summary' ? 'note' as const : result.data.kind;
    const normalized = {
      ...result.data,
      kind: normalizedKind,
      status: normalizedKind === 'note' || normalizedKind === 'takeaway' ? 'open' as const : result.data.status,
      priority: result.data.kind === 'summary' ? 'none' as const : result.data.priority
    };
    const existingDuplicate = existing.some((item) => sameMeaning(item, normalized));
    const incomingIndex = valid.findIndex((item) => sameMeaning(item as ExtractedItem, normalized));
    if (existingDuplicate) {
      duplicates.push(normalized.title);
    } else if (incomingIndex >= 0) {
      const current = valid[incomingIndex];
      valid[incomingIndex] = {
        ...current,
        body: (normalized.body || '').length > (current.body || '').length ? normalized.body : current.body,
        sourceSegmentIds: [...new Set([...current.sourceSegmentIds, ...normalized.sourceSegmentIds])],
        confidence: Math.max(current.confidence, normalized.confidence)
      };
      duplicates.push(normalized.title);
    } else {
      valid.push(normalized);
    }
  });
  return { valid, invalid, duplicates };
}
