import { describe, expect, it } from 'vitest';
import { analyzeText } from './analysis';

describe('analyzeText', () => {
  it('extracts an English task with a relative due date', () => {
    const result = analyzeText('I will send the final email tomorrow at 10.', new Date('2026-07-11T08:00:00Z'), ['s1']);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'task', sourceSegmentIds: ['s1'] });
    expect(result.items[0].dueAt).toContain('2026-07-12');
  });

  it('extracts a Hebrew task', () => {
    const result = analyzeText('אני אשלח ללקוחות את המייל מחר.', new Date('2026-07-11T08:00:00Z'), ['s2']);
    expect(result.items[0].kind).toBe('task');
    expect(result.items[0].dueAt).toContain('2026-07-12');
  });

  it('does not turn advice or predictions into tasks', () => {
    expect(analyzeText('You need to understand yourself and you will enjoy it.').items).toHaveLength(0);
    expect(analyzeText('Dana will be offline next week.').items).toHaveLength(0);
  });

  it('keeps an explicit meeting without a date out of the calendar until review', () => {
    const result = analyzeText("Let's have a meeting about the launch.", new Date('2026-07-11T08:00:00Z'), ['s3']);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'event', status: 'needs_review', startsAt: undefined });
  });

  it('does not invent action items for neutral text', () => {
    expect(analyzeText('The room has a blue wall.').items).toHaveLength(0);
  });
});
