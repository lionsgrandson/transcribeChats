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
});
