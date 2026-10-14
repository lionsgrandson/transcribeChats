import { test, expect, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.skip(process.env.E2E_HOSTED !== 'true', 'Run against the hosted build with controlled test-account fixtures.');
type TestIdentity = { id: string; session: Record<string, unknown> & { access_token: string; expires_in: number; expires_at?: number } };
function identities(): TestIdentity[] { return JSON.parse(readFileSync(process.env.E2E_AUTH_FIXTURE || '.audit/test-users.json', 'utf8')); }
async function authorize(context: BrowserContext, user: TestIdentity) {
  await context.addInitScript((session) => {
    if (!sessionStorage.getItem('validation-auth-initialized')) {
      localStorage.setItem('sb-qsspsijyvcemayocilgk-auth-token', JSON.stringify(session));
      sessionStorage.setItem('validation-auth-initialized', 'true');
    }
  }, { ...user.session, expires_at: user.session.expires_at || Math.floor(Date.now() / 1000) + user.session.expires_in });
}

test('hosted sign-in gate protects workspace routes', async ({ page }) => {
  await page.goto('/transcriptions/private-validation-id');
  await expect(page.getByRole('heading', { name: 'TranscribeChats' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Email sign-in link/ })).toBeVisible();
  await expect(page.locator('.transcription-segment')).toHaveCount(0);
});

test('verified hosted account transcribes real synthetic audio, analyzes with Gemini and syncs', async ({ page, context }) => {
  test.setTimeout(120_000);
  await authorize(context, identities()[0]);
  const requests: string[] = []; page.on('request', (request) => requests.push(request.url()));
  await page.goto('/new?mode=upload');
  await page.getByLabel('Title', { exact: true }).fill('Hosted synthetic validation');
  await page.locator('input[type=file]').setInputFiles('.audit/validation.wav');
  await page.locator('.form-actions button.button-primary').click();
  await expect(page).toHaveURL(/\/transcriptions\//);
  await expect(page.locator('.transcription-segment')).not.toHaveCount(0, { timeout: 50_000 });
  await expect(page.getByText('This is a synthetic meeting', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Analyze meeting with Gemini', exact: true }).click();
  await expect(page.locator('.transcription-summary-card')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.followup-card.kind-task')).not.toHaveCount(0);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sync records', exact: true }).click();
  await expect(page.getByText('Sync completed.', { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(requests.some((url) => /^http:\/\/(?:localhost|127\.0\.0\.1):8787/.test(url))).toBe(false);
  await page.screenshot({ path: 'test-results/hosted-settings.png', fullPage: true });
});

test('new browser restores cloud transcripts while another account cannot see them or CRM credentials', async ({ page, context, browser }) => {
  await authorize(context, identities()[0]);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sync records', exact: true }).click();
  await expect(page.getByText('Sync completed.', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.goto('/history');
  await expect(page.getByText('Hosted synthetic validation', { exact: true })).toBeVisible();
  const recordUrl = await page.getByRole('link', { name: /Hosted synthetic validation/ }).getAttribute('href');
  const other = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  await authorize(other, identities()[1]);
  const otherPage = await other.newPage();
  await otherPage.goto(recordUrl!);
  await expect(otherPage.getByText('This transcript was not found on this device.', { exact: true })).toBeVisible();
  await otherPage.goto('/settings');
  await expect(otherPage.getByLabel('Your CRM application URL', { exact: true })).toHaveValue('');
  await other.close();
});

test('production RLS rejects cross-user writes and anonymous workspace access', async ({ request }) => {
  const users = identities();
  const configuration = JSON.parse(readFileSync('.audit/test-public-config.json', 'utf8'));
  const endpoint = configuration.url + '/rest/v1/transcribe_workspaces';
  const owner = { apikey: configuration.key, Authorization: `Bearer ${users[0].session.access_token}` };
  const other = { apikey: configuration.key, Authorization: `Bearer ${users[1].session.access_token}` };
  const crossRead = await request.get(endpoint + `?user_id=eq.${users[0].id}&select=user_id`, { headers: other });
  expect(crossRead.ok()).toBe(true); expect(await crossRead.json()).toEqual([]);
  const reassign = await request.patch(endpoint + `?user_id=eq.${users[0].id}`, { headers: owner, data: { user_id: users[1].id } });
  expect(reassign.status()).toBe(403);
  const anonymous = await request.get(endpoint + '?select=user_id', { headers: { apikey: configuration.key } });
  expect(anonymous.status()).toBe(401);
});
