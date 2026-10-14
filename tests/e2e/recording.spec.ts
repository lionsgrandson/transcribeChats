import { test, expect } from '@playwright/test';

test.use({ permissions: ['microphone'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test('microphone capture survives failure, refresh and retry with its original audio', async ({ page }) => {
  let submissions = 0;
  await page.route('**/v1/jobs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    expect(route.request().postDataBuffer()!.byteLength).toBeGreaterThan(1000);
    submissions++;
    return route.fulfill({ status: 202, json: { job_id: `recording-job-${submissions}`, status: 'queued', progress: 15, stage: 'Queued' } });
  });
  await page.route('**/v1/jobs/recording-job-*', async (route) => route.fulfill({ json: submissions === 1
    ? { job_id: 'recording-job-1', status: 'failed', progress: 20, stage: 'Failed', error: 'Synthetic retryable processing failure' }
    : { job_id: 'recording-job-2', status: 'ready', progress: 100, stage: 'Ready', result: { duration_ms: 2000, detected_languages: ['en'], analysis: null, segments: [{ id: 'recorded-segment', sequence_no: 0, speaker_label: 'Speaker 1', start_ms: 0, end_ms: 2000, text: 'Synthetic microphone validation.', language: 'en' }] } }
  }));
  await page.goto('/new?mode=record');
  await page.getByLabel('Title', { exact: true }).fill('Synthetic microphone validation');
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  // Capture a real MediaRecorder chunk from the synthetic device, not a physical microphone.
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: /Stop/ }).click();
  await expect(page).toHaveURL(/\/transcriptions\//);
  await expect(page.getByText('Synthetic retryable processing failure')).toBeVisible();
  await page.reload();
  await expect(page.locator('audio')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.transcription-segment')).toHaveCount(1);
  expect(submissions).toBe(2);
});
