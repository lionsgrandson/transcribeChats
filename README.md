# TranscribeChats

React/PWA for Hebrew and English transcription, meeting follow-ups, tasks, calendar, learning and conversation review. **`main` is the localhost application; `cloudflare` is the hosted release branch.** Cloudflare Pages deploys only `cloudflare`. Do not merge its hosted configuration back over desktop defaults.

- **Desktop:** Python Faster-Whisper on NVIDIA CUDA, audio/video import, optional pyannote speaker separation, explicit Ollama or Gemini analysis, offline IndexedDB storage.
- **Hosted (`cloudflare`):** open the website and start immediately, without signing in, installing Docker or running Python. Cloudflare Workers AI handles speech and Gemini jobs run on the server. Data stays in this browser. An optional account enables private cloud sync; hosted pages never call localhost services.
- **Shared:** editable transcript text and speaker labels, timestamp playback, searchable history, TXT/PDF/CSV exports, tasks with bulk actions, calendar, personal notes, CodeCrafter CRM, ChatGPT export/import, courses and interactive quizzes.

See [implementation and verification report](docs/UNIFICATION_REPORT.md) and [branch reconciliation](docs/BRANCH_AUDIT.md).

## Desktop setup

Use Node.js **22.12 or newer**, npm, Docker Desktop with NVIDIA GPU support, and current NVIDIA drivers. Install Ollama for local AI analysis. Original recordings remain in the browser when processing fails.

```powershell
npm ci
Copy-Item .env.example .env.local
npm start
```

The launcher starts the local services and the frontend at **http://localhost:4173**. Keep `VITE_CLOUD_TRANSCRIBE_URL` and `VITE_RUNTIME_MODE` blank for this desktop configuration. Set the worker's private `GEMINI_API_KEY` in an ignored `.env` file to enable Gemini through the local engine; it is never bundled into the frontend. The tested default is `GEMINI_MODEL=gemini-3.5-flash-lite`; an existing environment override takes precedence. Ollama actions explicitly request Ollama and do not silently send content to Gemini.

For an existing worker, or text-only/offline development:

```powershell
npm run dev
```

Optional speaker separation requires `ENABLE_DIARIZATION=true`, the optional dependencies and an authorized `PYANNOTE_TOKEN` on the Python worker. Review speaker labels; acoustic separation does not prove a person's identity. Models download on first use. Use `npm run start:status` to inspect local readiness.

To run the Python tests in the worker container:

```powershell
docker cp services/worker_python/tests transcribechats-transcription-worker-1:/app/tests
docker exec transcribechats-transcription-worker-1 python -m unittest discover -s /app/tests
```

## Hosted setup

The production application is **https://transcribe-chats.pages.dev/**. The Pages project is linked to `lionsgrandson/transcribeChats`, production branch **`cloudflare`**. This branch includes public `.env.production` defaults for the hosted backend. `npm run build` produces the web app; `npm run preview -- --port 4174` previews it without Docker or Python. Use `main` for the original localhost/Python workflow.

The only required **public** hosted build configuration is already in `.env.production`. Override it in Pages or an ignored `.env.production.local` when using a different Worker:

```dotenv
VITE_CLOUD_TRANSCRIBE_URL=https://transcribechats-unified.your-account.workers.dev
VITE_RUNTIME_MODE=hosted
```

Supabase is optional, for users who want cross-device sync. Set public `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and, if CAPTCHA is enabled, `VITE_TURNSTILE_SITE_KEY`. Allow the production origin in authentication redirects. The application and inference work without these settings; existing accounts and their private databases remain available when configured.

The Worker in `wrangler.transcribe.jsonc` requires `AI`, `RATE_LIMITER`, `GEMINI_RATE_LIMITER`, and the `GEMINI_JOBS` SQLite Durable Object binding. Guest access is explicitly enabled by `ALLOW_GUEST_ACCESS=true`. Required private configuration is `GEMINI_API_KEY` and `ALLOWED_ORIGIN`. `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` support optional accounts. Provision with `scripts/configure-hosted.mjs` only after loading trusted environment values; never put AI keys, Supabase service-role keys or Cloudflare tokens in `VITE_*`.

Guest analysis jobs use a random browser capability stored locally, rather than a shared account. A different browser cannot retrieve them even with the same job ID. Submission limits apply to both the browser and Cloudflare's client-IP digest, so rotating tokens does not reset the IP limit. Existing provider quotas remain in force. Never copy the guest capability into shared logs or URLs.

The new Worker name preserves an independently deployed legacy `transcribechats-whisper` service and its existing D1/R2/queue data. Do not remove that service as part of Git branch cleanup.

Hosted Whisper accepts **8 MiB of audio** per request. Video downloading, YouTube/yt-dlp, acoustic diarization and Ollama use the desktop engine. Hosted study and conversation workspaces save source material and support ChatGPT structured import, quizzes and progress. Gemini meeting analysis is available on the transcript. These limitations are shown in the interface.

## Persistence, recovery and synchronization

Desktop data and guest hosted data keep the existing `transcribeChats` IndexedDB database at their respective origins. Guests on different devices or browser profiles have separate data. Optional accounts use their own database. Signing out or switching accounts reloads the application before another workspace opens. No existing browser data is deleted or silently copied into an account.

Older anonymous hosted browser transcripts are accessible immediately as a guest. To copy them into an optional account, use **Settings → Recover existing browser transcripts** only if those records belong to you. Recovery preserves recordings, progress, IDs and originals, without copying old CRM credentials.

Apply **only** `supabase/migrations/20261014124212_unified_records.sql` to an existing production project. It adds `transcribe_workspaces` and a separate private `transcribe-media` bucket; it does not replace existing profiles, library, billing or job tables. The older initial migration describes the legacy schema and must not be blindly applied over an unrelated existing project.

Cloud synchronization is explicit in Settings. It includes transcripts, segments, follow-ups, notes, study packs, audits and media metadata. Credentials and other preferences are excluded. Audio synchronization is an additional opt-in with a 50 MiB per-file limit; the original recording remains local. Cross-device concurrent edits stop with a conflict message and recovery export rather than overwriting either workspace. Revisions guard against concurrent cloud writes. Settings provides local and recovery JSON exports.

## Connect CodeCrafter CRM

In **Settings → CRM connection**, choose either:

1. **Browser import:** enter your CRM application's HTTPS URL. The supported `#importTasks=` handoff opens the CRM's own sign-in/review/project-selection interface. Finish saving there. TranscribeChats reports the handoff as **awaiting confirmation**, because the existing CRM does not send an import receipt back to the source window.
2. **Workspace API:** in your CodeCrafter CRM, generate an inbound workspace token as an Admin/Manager and copy the `.../functions/v1/crm-ingest` endpoint. Connect from TranscribeChats, then choose the client and project during transfer. Credentials stay in this browser workspace and are not synchronized.

Both methods preserve stable source identifiers. Completed and dismissed tasks are excluded. API transfers require `accepted: true`; errors and authorization failures are reported. Disconnect removes the saved endpoint and token. Other providers require their own verified adapter; no generic CRM API is assumed.

## Tests and release

```powershell
npm ci
npm run check
npm run test:e2e
npm audit
```

`check` runs ESLint, frontend/unit tests, Worker tests, TypeScript, the production Vite build and compiled-output validation. Browser tests use isolated profiles and synthetic data. Run the guest journeys with `E2E_GUEST=true`, `E2E_BASE_URL` set to the hosted preview or production, and `E2E_AUDIO_FIXTURE` pointing to a synthetic WAV. Optional account-sync tests use `E2E_HOSTED=true` and disposable account fixtures. See [Cloudflare release notes](docs/CLOUDFLARE_RELEASE.md) for executed validation.

Pages build settings: **build command `npm ci && npm run check`**, **output directory `dist`**, repository root. `wrangler.jsonc` also declares `dist` as the Pages output. SPA redirects preserve deep links, hashed assets get JavaScript/CSS MIME types, and the service worker must revalidate. Never publish the repository root: its `index.html` references TypeScript source.

Commit and push the hosted changes to `cloudflare`, then publish that exact `origin/cloudflare` commit with the public production environment loaded:

```powershell
npm run deploy
npm run verify:deployment
```

The publisher rejects code that differs from `origin/cloudflare` and dirty tracked changes, checks the compiled output, deploys the unified Worker, verifies guest Whisper/Gemini readiness, and publishes `dist` to the `cloudflare` production branch. It preserves the legacy Worker and its secrets. `PUBLISH-CLOUDFLARE.cmd` loads ignored local production overrides; without overrides use `node --env-file=.env.production scripts/publish.mjs`.
