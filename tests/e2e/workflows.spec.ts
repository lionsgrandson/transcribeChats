import { test, expect, type Page } from '@playwright/test';

async function createTranscript(page: Page) {
  await page.goto('/new?mode=text');
  await page.getByLabel('Title', { exact: true }).fill('Unification validation — בדיקה');
  await page.locator('textarea').fill('I will send the final report tomorrow.\nאני אשלח את הקובץ מחר.');
  await page.locator('.form-actions button.button-primary').click();
  await expect(page).toHaveURL(/\/transcriptions\//);
  await expect(page.locator('.transcription-segment')).toHaveCount(2);
}

test('manual transcript, speaker correction, follow-ups, export and deep-link persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await createTranscript(page);
  const url = page.url();
  await page.locator('.transcription-segment').first().getByRole('button', { name: /edit/i }).click();
  await page.getByLabel('Speaker', { exact: true }).fill('Dana / דנה');
  await page.getByLabel('Transcript text', { exact: true }).fill('I will send the corrected report tomorrow.');
  await page.locator('.transcription-segment').first().getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Extract explicit follow-ups' }).click();
  await expect(page.locator('.followup-card.kind-task')).not.toHaveCount(0);
  await expect(page.locator('.followup-card.kind-task')).not.toHaveCount(0);
  await page.getByLabel('New note').fill('A personal note / הערה');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'TXT', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('.txt');
  await page.reload();
  await expect(page.getByText('Dana / דנה', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('A personal note / הערה', { exact: true })).toBeVisible();
  await page.goto('/history');
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Unification validation — בדיקה' })).toBeVisible();
  await page.screenshot({ path: 'test-results/transcript-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('bulk acceptance and completion persist after refresh', async ({ page }) => {
  await createTranscript(page);
  await page.getByRole('button', { name: 'Extract explicit follow-ups' }).click();
  await expect(page.locator('.followup-card.kind-task')).not.toHaveCount(0);
  await page.goto('/tasks?filter=review');
  await expect(page.locator('.task-row')).not.toHaveCount(0);
  const count = await page.locator('.task-row').count();
  await page.getByLabel('Select all shown').check();
  await page.getByRole('button', { name: /Accept selected/ }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(count);
  await page.getByRole('button', { name: 'Mark selected done' }).click();
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.locator('.task-row.is-completed')).toHaveCount(count);
  await page.reload();
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.locator('.task-row.is-completed')).toHaveCount(count);
  await expect(page.getByRole('button', { name: 'Send to CRM', exact: true }).first()).toBeDisabled();
});

test('CRM browser handoff requires confirmation and preserves stable Unicode source identifiers', async ({ page, context }) => {
  await context.route('https://crm.example/**', (route) => route.fulfill({ body: '<h1>CRM import review</h1>', contentType: 'text/html' }));
  await createTranscript(page);
  await page.getByRole('button', { name: 'Extract explicit follow-ups' }).click();
  await expect(page.locator('.followup-card.kind-task')).not.toHaveCount(0);
  await page.goto('/settings');
  await page.getByLabel('Your CRM application URL', { exact: true }).fill('https://crm.example/');
  await page.getByRole('button', { name: 'Connect / reconnect' }).click();
  await expect(page.getByText('Browser destination saved.', { exact: false })).toBeVisible();
  await page.goto('/tasks?filter=review');
  const popup = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Send to CRM', exact: true }).first().click();
  const crm = await popup;
  await expect(crm).toHaveURL(/#importTasks=/);
  const encoded = new URL(crm.url()).hash.slice('#importTasks='.length);
  const tasks = JSON.parse(Buffer.from(decodeURIComponent(encoded), 'base64').toString('utf8'));
  expect(tasks).toHaveLength(1);
  expect(tasks[0].sourceId).toBeTruthy();
  expect(tasks[0].projectName).toContain('בדיקה');
  await expect(page.getByText(/Import is not yet confirmed/)).toBeVisible();
});

test('authenticated CRM API project mapping and rejection handling', async ({ page }) => {
  const imports: Array<Record<string, unknown>> = [];
  let accepted = false;
  await page.route('https://crm.example/functions/v1/crm-ingest', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { accepted: true, clients: [{ id: 'client-1', name: 'Test client' }], projects: [{ id: 'project-1', name: 'Test project', clientIds: ['client-1'] }] } });
    imports.push(request.postDataJSON());
    return route.fulfill({ status: accepted ? 200 : 403, json: accepted ? { accepted: true, tasksCreated: 1 } : { accepted: false, error: 'Workspace authorization rejected' } });
  });
  await createTranscript(page);
  await page.getByRole('button', { name: 'Extract explicit follow-ups' }).click();
  await expect(page.locator('.followup-card.kind-task')).not.toHaveCount(0);
  await page.goto('/settings');
  await page.getByLabel('Connection method').selectOption('api');
  await page.getByLabel('CodeCrafter inbound endpoint', { exact: true }).fill('https://crm.example/functions/v1/crm-ingest');
  await page.getByLabel('Workspace API token', { exact: true }).fill('synthetic-test-token');
  await page.getByRole('button', { name: 'Connect / reconnect' }).click();
  await expect(page.getByText('Authorized workspace connected.', { exact: false })).toBeVisible();
  await page.goto('/tasks?filter=review');
  await page.getByRole('button', { name: 'Send to CRM', exact: true }).first().click();
  await page.getByLabel('Client', { exact: true }).selectOption('client-1');
  await page.getByRole('button', { name: 'Existing project', exact: true }).click();
  await page.getByLabel('Project', { exact: true }).selectOption('project-1');
  await page.getByRole('button', { name: /Send to CRM|Sync to CRM/ }).last().click();
  await expect(page.getByText('Workspace authorization rejected')).toBeVisible();
  expect(imports[0].destination).toEqual({ contactId: 'client-1', projectId: 'project-1' });
  expect(imports[0].tasks).toHaveLength(1);
  accepted = true;
  await page.getByRole('button', { name: /Send to CRM|Sync to CRM/ }).last().click();
  await expect(page.getByText('CRM confirmed 1 task(s) created.')).toBeVisible();
});

test('Hebrew RTL navigation and mobile layout remain usable', async ({ page }) => {
  await createTranscript(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'עברית', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'Close navigation' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  for (const path of ['/history', '/tasks', '/calendar', '/study', '/social-audit', '/sales']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflows, path).toBe(false);
  }
  await page.screenshot({ path: 'test-results/mobile-hebrew.png', fullPage: true });
});

test('manual dated event appears in calendar and retains its local date on edit', async ({ page }) => {
  await createTranscript(page);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Item type', { exact: true }).selectOption('event');
  await page.getByLabel('Title', { exact: true }).fill('Synthetic calendar validation');
  await page.getByRole('button', { name: 'Save item', exact: true }).click();
  const event = page.locator('.followup-card.kind-event');
  await expect(event).toBeVisible();
  await event.getByRole('button', { name: 'Edit', exact: true }).click();
  await event.getByLabel('Event date and time', { exact: true }).fill('2026-10-15T14:30');
  await event.getByRole('button', { name: 'Save', exact: true }).click();
  await event.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(event.getByLabel('Event date and time', { exact: true })).toHaveValue('2026-10-15T14:30');
  await page.goto('/calendar');
  await expect(page.locator('.calendar-event').filter({ hasText: 'Synthetic calendar validation' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.calendar-event').filter({ hasText: 'Synthetic calendar validation' })).toBeVisible();
});
