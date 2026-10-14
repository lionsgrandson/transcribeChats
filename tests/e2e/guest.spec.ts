import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_GUEST !== 'true', 'Run against the Cloudflare build with E2E_GUEST=true.');

test('every workspace opens as a guest without a local service or required login', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  for (const path of ['/', '/new', '/history', '/tasks', '/calendar', '/study', '/social-audit', '/sales', '/settings']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.auth-card')).toHaveCount(0);
  }
  await expect(page.getByText('Works in this browser without sign-in, Docker or a local worker.', { exact: false })).toBeVisible();
  expect(requests.some(url => /^http:\/\/(localhost|127\.0\.0\.1):8787/.test(url))).toBe(false);
  expect(requests.some(url => /\/auth\/v1\//.test(url))).toBe(false);
});

test('guest performs real speech and Gemini analysis, persists after refresh and stays private to this browser', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const calls: string[] = [];
  page.on('request', request => {
    if (/\/v1\/(transcribe|analyze)/.test(request.url())) {
      expect(request.headers().authorization).toBeUndefined();
      expect(request.headers()['x-guest-token']).toMatch(/^[0-9a-f-]{36}$/);
      calls.push(request.url());
    }
  });
  await page.goto('/new?mode=upload');
  await page.getByLabel('Title', { exact: true }).fill('Guest Cloudflare validation');
  await page.locator('input[type=file]').setInputFiles(process.env.E2E_AUDIO_FIXTURE || '.audit/validation.wav');
  await page.locator('.form-actions button.button-primary').click();
  await expect(page).toHaveURL(/\/transcriptions\//);
  await expect(page.locator('.transcription-segment')).not.toHaveCount(0, { timeout: 80_000 });
  await expect(page.getByText('This is a synthetic meeting', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Analyze meeting with Gemini', exact: true }).click();
  await expect(page.locator('.transcription-summary-card')).toBeVisible({ timeout: 100_000 });
  await expect(page.locator('.followup-card.kind-task')).not.toHaveCount(0);
  const url = page.url();
  const guestToken = await page.evaluate(() => localStorage.getItem('transcribeChats:guest-token'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Guest Cloudflare validation', exact: true })).toBeVisible();
  await expect(page.locator('.transcription-summary-card')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('transcribeChats:guest-token'))).toBe(guestToken);
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(url);
  await expect(otherPage.getByText('This transcript was not found on this device.', { exact: true })).toBeVisible();
  const statusUrl = calls.find(url => /\/v1\/analyze\/[0-9a-f-]{36}$/.test(url));
  expect(statusUrl).toBeTruthy();
  const hiddenJob = await other.request.get(statusUrl!, { headers: { Origin: new URL(url).origin, 'X-Guest-Token': crypto.randomUUID() } });
  expect(hiddenJob.status()).toBe(404);
  expect((await hiddenJob.json()).summary).toBeUndefined();
  await other.close();
  expect(calls.some(url => url.endsWith('/v1/transcribe'))).toBe(true);
  expect(calls.some(url => url.endsWith('/v1/analyze'))).toBe(true);
  await page.screenshot({ path: 'test-results/guest-cloudflare.png', fullPage: false });
});
