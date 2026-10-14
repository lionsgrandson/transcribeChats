import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../data/db';
import { crmTransferMessage, sendTasksToCrm, validateCrmDestination } from './crmTransfer';

afterEach(() => vi.restoreAllMocks());
describe('verified CRM adapters', () => {
  it.each(['javascript:alert(1)', 'http://crm.example', 'https://127.0.0.1/functions/v1/crm-ingest', 'https://crm.local/', 'https://user:password@crm.example/', 'https://crm.example/?token=secret', 'https://[::1]/'])('rejects unsafe destination %s', (url) => {
    expect(() => validateCrmDestination(url, 'browser')).toThrow();
  });
  it('rejects unsupported CRM APIs and refuses false success payloads', async () => {
    expect(() => validateCrmDestination('https://crm.example/arbitrary-api', 'api')).toThrow('CodeCrafter');
    expect(() => crmTransferMessage({ accepted: false })).toThrow();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ accepted: 'yes' }));
    await expect(sendTasksToCrm([{ title: 'Synthetic task', notes: '', priority: 'Medium', sourceId: 'synthetic', sourceLabel: 'test', projectName: 'test' }], { ...defaultSettings, crmEnabled: true, crmWebhookUrl: 'https://crm.example/functions/v1/crm-ingest', crmApiToken: 'test-only' })).rejects.toThrow('did not confirm');
  });
  it('describes a browser handoff as pending, never as a confirmed import', () => {
    expect(crmTransferMessage({ accepted: false, pendingConfirmation: true })).toContain('not yet confirmed');
  });
});
