import { describe, expect, it } from 'vitest';
import { stableSnapshot, validateSnapshot, type WorkspaceSnapshot } from './workspaceSync';

describe('workspace sync data preservation', () => {
  it('hashes JSONB-reordered keys and IndexedDB-reordered rows consistently', () => {
    const base = { schemaVersion: 1, transcriptions: [{ id: 'b', title: 'Second' }, { id: 'a', title: 'First' }], segments: [], items: [], notes: [], studyEntries: [], socialAudits: [], media: [] } as unknown as WorkspaceSnapshot;
    const cloud = { media: [], socialAudits: [], notes: [], studyEntries: [], items: [], segments: [], transcriptions: [{ title: 'First', id: 'a' }, { title: 'Second', id: 'b' }], schemaVersion: 1 } as unknown as WorkspaceSnapshot;
    expect(stableSnapshot(base)).toBe(stableSnapshot(cloud));
  });
  it('rejects unsupported cloud data before any local restore', () => {
    expect(() => validateSnapshot({ schemaVersion: 2 })).toThrow('No local data was changed');
  });
});
