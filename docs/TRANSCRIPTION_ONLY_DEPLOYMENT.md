# Transcription-only deployment (not yet live)

This feature branch simplifies TranscribeChats to recording, audio upload, pasted transcript, history, transcript corrections, speaker/timestamp separators and PDF/text export. CRM, Sales Intelligence, study, social audit, calendar and task management are hidden from the product. Existing IndexedDB records are NOT deleted.

## Cloudflare Workers AI transcription

The new API uses `@cf/openai/whisper-large-v3-turbo` with the AI binding and no API key in browser code. Whisper returns text and optional timestamps, not true speaker diarization. Cloud transcription labels everything as Speaker 1 for correction. For reliable multiple speakers and long recordings, the old private CUDA/Python worker remains an optional local mode; do not claim that the cloud worker separates speakers.

Cloud mode accepts audio only (MP3, M4A, WAV, WebM/Opus, OGG, FLAC) up to **8 MiB**, and sends it directly to Workers AI. Larger recordings require compression/splitting or the local worker. It does not persist server-side jobs: closing the browser before processing ends may interrupt the request, but the original file remains in IndexedDB to retry. Do not upload sensitive recordings without an appropriate privacy and consent process.

## Optional Gemini summaries and ChatGPT export

The normal TranscribeChats product keeps Cloudflare Whisper for speech-to-text.
In the transcript detail view, **Summarize with Gemini** is an opt-in action that sends
the transcript text to Google's Gemini API. It uses the stable
`gemini-3.5-flash-lite` model, capped to **120,000 characters** of transcript
and **3,072 generated tokens** per request. A separate Cloudflare rate limiter
allows **one Gemini job submission per minute per verified user, per Cloudflare location**.
The existing Whisper rate limit remains independent.

**Reuse the StudentTranscribe key securely:** Cloudflare Worker secrets cannot
be read back or copied automatically from the StudentTranscribe repository.
Find the same existing key in the owner's Google AI Studio or secret manager and
configure it on this Worker's environment:

```sh
npx wrangler secret put GEMINI_API_KEY --config wrangler.transcribe.jsonc
```

Do not commit the key, pass it in a VITE_* build variable, or create a new
paid API project just for this feature. This only activates Gemini when the
key's Google AI Studio project and model have free-tier availability. Google
enforces RPM, TPM and RPD on the **Google project**, not on individual keys.
Therefore StudentTranscribe and this app can consume the same project's free
quota, and the per-user rate limiter / output cap is **not a hard global daily
quota or a zero-billing guarantee**. Verify the current model quota and the
project's billing status in https://aistudio.google.com/rate-limit and set
project cost guardrails before enabling public users. Gemini HTTP 429 and transient 5xx responses are handled by a Durable Object retry queue. The app shows an estimated retry time; once accepted, a queued summary can complete after the browser closes. Jobs expire after 72 hours or 12 attempts, and completed results are retained for 24 hours. The original local transcript is not deleted. Transcripts above the character cap must be split.
Cloudflare Workers AI (Whisper) may have separate usage costs. Whisper quota responses store the original recording locally and schedule retry when the app is open or reopened; they do not create a server-side audio queue.

**Export to ChatGPT** copies the complete transcript plus an analysis prompt
to the browser clipboard and opens https://chatgpt.com/. The user must paste
and send it manually. This action does not send transcript contents from the
Worker to ChatGPT. The existing TXT/PDF exports remain available.

Before announcing go-live, run `npm run check`,
`node --test cloudflare/transcribe-worker.node.mjs`, confirm the `GEMINI_JOBS` Durable Object binding and `GEMINI_API_KEY`
exists as a Worker secret, deploy using the existing publish script, and
perform end-to-end tests of authenticated Hebrew and English summaries,
Google 429 behavior, ChatGPT copying on desktop/mobile, transcription,
and local export.

## Required production configuration

1. Select an existing Supabase Auth project. Do not reuse credentials from another app by assumption. Enable verified-email sign-in with redirect URI set to the deployed HTTPS frontend. Configure SMTP and CAPTCHA/rate limits. The frontend requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Only publishable keys belong in Vite environment variables.
2. Build and deploy the Cloudflare Worker from a trusted terminal:
   ```sh
   npm ci
   npx wrangler deploy --config wrangler.transcribe.jsonc
   npx wrangler secret put SUPABASE_URL --config wrangler.transcribe.jsonc
   npx wrangler secret put SUPABASE_PUBLISHABLE_KEY --config wrangler.transcribe.jsonc
   npx wrangler secret put ALLOWED_ORIGIN --config wrangler.transcribe.jsonc
   ```
   The `ALLOWED_ORIGIN` value must be the exact frontend HTTPS origin, without a slash at the end. Use `wrangler secret put` instead of committing values.
3. Set `VITE_CLOUD_TRANSCRIBE_URL=https://transcribechats-whisper.<account>.workers.dev` in the frontend **build** environment, together with the two Supabase public variables. Rebuild and deploy Pages:
   ```sh
   npm run check
   npx wrangler pages deploy dist --project-name transcribe-chats --branch main
   ```
   The Pages site must serve SPA history fallback to `index.html`. Check page refresh on `/history` and `/transcriptions/:id`.
4. Test sign-in, 401 for anonymous API calls, disallowed origins, 413 for uploads above 8 MiB, audio format rejection, correct Hebrew/English output, edit/export, retry after network interruption and a mobile microphone.
5. Configure Cloudflare billing alerts and monitor Workers AI usage. The 3-requests/minute rate limit is per user per Cloudflare location, **not** a strict global daily budget; implement daily budget/cost enforcement before opening public signup at scale.

Secrets are only for the Worker and must never be put in `VITE_*` variables. A deployment requires the user's Cloudflare login and working Supabase project. These are not provisioned or verified by this branch.

## Limitations and go-live gate

This branch is a deployable candidate, **not** proof of a production deployment. It has no durable hosted processing queue for long audio, no daily spend quota, no cloud speaker diarization and no verified full E2E. Keep the existing deployed site unchanged until build, integration, browser and security smoke tests pass. Back up IndexedDB data before any migration.
