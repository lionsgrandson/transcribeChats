import { describe, expect, it } from 'vitest';
import { previewImport } from './importer';

describe('previewImport', () => {
  it('parses a fenced ChatGPT JSON response', () => {
    const result = previewImport('```json\n{"items":[{"kind":"task","title":"Send report"}]}\n```', []);
    expect(result.invalid).toHaveLength(0);
    expect(result.valid[0]).toMatchObject({ kind: 'task', title: 'Send report', status: 'needs_review' });
  });

  it('flags invalid JSON without committing data', () => {
    const result = previewImport('not-json', []);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });

  it('detects duplicate titles of the same kind', () => {
    const result = previewImport('{"items":[{"kind":"task","title":"Send report"}]}', [{
      id: '1', transcriptionId: 't', kind: 'task', title: 'send report', status: 'open', priority: 'none',
      tags: [], sourceSegmentIds: [], confidence: 1, confirmed: true, createdAt: '', updatedAt: ''
    }]);
    expect(result.duplicates).toEqual(['Send report']);
  });

  it('keeps useful items when optional AI dates are not valid ISO values', () => {
    const result = previewImport(JSON.stringify({ items: [
      { kind: 'task', title: 'Ask about the chocolate factory', dueAt: 'next weekend' },
      { kind: 'note', title: 'Transportation timing', startsAt: '' },
      { kind: 'event', title: 'Anniversary weekend', startsAt: '2026-07-18' }
    ] }), []);
    expect(result.invalid).toEqual([]);
    expect(result.valid).toHaveLength(3);
    expect(result.valid[0].dueAt).toBeUndefined();
    expect(result.valid[1].startsAt).toBeUndefined();
    expect(result.valid[1].status).toBe('open');
    expect(result.valid[2].startsAt).toContain('2026-07-18');
  });

  it('turns imported summary items into visible notes', () => {
    const result = previewImport('{"items":[{"kind":"summary","title":"Confirmed family schedule"}]}', []);
    expect(result.invalid).toEqual([]);
    expect(result.valid[0]).toMatchObject({ kind: 'note', title: 'Confirmed family schedule', status: 'open' });
  });
});
