import { z } from 'zod';
import type { ExtractedItem, ImportPreview } from '../domain/types';

const importItemSchema = z.object({
  kind: z.enum(['task', 'event', 'note', 'takeaway', 'summary']),
  title: z.string().min(1).max(300),
  body: z.string().max(5000).optional(),
  status: z.enum(['needs_review', 'open', 'completed', 'dismissed']).default('needs_review'),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).default('none'),
  assignee: z.string().max(200).optional().nullable().transform((value) => value || undefined),
  startsAt: z.string().datetime().optional().nullable().transform((value) => value || undefined),
  endsAt: z.string().datetime().optional().nullable().transform((value) => value || undefined),
  dueAt: z.string().datetime().optional().nullable().transform((value) => value || undefined),
  reminderAt: z.string().datetime().optional().nullable().transform((value) => value || undefined),
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
    const duplicate = existing.some((item) =>
      item.kind === result.data.kind && item.title.trim().toLowerCase() === result.data.title.trim().toLowerCase()
    );
    if (duplicate) duplicates.push(result.data.title);
    valid.push(result.data);
  });
  return { valid, invalid, duplicates };
}
