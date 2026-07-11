import { describe, expect, it } from 'vitest';
import { analyzeText } from './analysis';

describe('analyzeText', () => {
  it('extracts an English task with a relative due date', () => {
    const result = analyzeText('Dana will send the final email tomorrow at 10.', new Date('2026-07-11T08:00:00Z'), ['s1']);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ kind: 'task', sourceSegmentIds: ['s1'] });
    expect(result.items[0].dueAt).toContain('2026-07-12');
  });

  it('extracts a Hebrew task', () => {
    const result = analyzeText('אני אשלח ללקוחות את המייל מחר.', new Date('2026-07-11T08:00:00Z'), ['s2']);
    expect(result.items[0].kind).toBe('task');
    expect(result.items[0].dueAt).toContain('2026-07-12');
  });

  it('does not invent action items for neutral text', () => {
    expect(analyzeText('The room has a blue wall.').items).toHaveLength(0);
  });
});
