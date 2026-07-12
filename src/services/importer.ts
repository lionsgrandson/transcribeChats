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

  const values = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && 'items' in parsed
      ? (parsed as { items: unknown }).items
      : [];
  if (!Array.isArray(values)) return { valid: [], invalid: ['Expected an items array.'], duplicates: [] };

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
    const duplicate = existing.some((item) =>
      item.kind === normalized.kind && item.title.trim().toLowerCase() === normalized.title.trim().toLowerCase()
    );
    if (duplicate) duplicates.push(normalized.title);
    valid.push(normalized);
  });
  return { valid, invalid, duplicates };
}
