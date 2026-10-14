import { describe, expect, it } from 'vitest';
import { TranscribeChatsDatabase } from './db';

describe('account data isolation and additive upgrades', () => {
  it('keeps account data and CRM settings in independent databases', async () => {
    const first = new TranscribeChatsDatabase('test-user-one');
    const second = new TranscribeChatsDatabase('test-user-two');
    try {
      await first.settings.put({ id: 'settings', crmApiToken: 'one-private-token' } as never);
      expect(await second.settings.get('settings')).toBeUndefined();
      await second.open();
      expect(first.tables.map((table) => table.name)).toContain('syncBackups');
      expect(first.tables.map((table) => table.name)).toContain('studyEntries');
      expect((await first.settings.get('settings'))?.crmApiToken).toBe('one-private-token');
    } finally { await first.delete(); await second.delete(); }
  });
});
