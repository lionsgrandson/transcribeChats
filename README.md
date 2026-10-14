# TranscribeChats

React/PWA for Hebrew and English transcription, meeting follow-ups, tasks, calendar, learning and conversation review. **`main` is the localhost/desktop application. The separate `cloudflare` branch is the hosted web app.**

- **Desktop:** Python Faster-Whisper on NVIDIA CUDA, audio/video import, optional pyannote speaker separation, explicit Ollama or Gemini analysis, offline IndexedDB storage.
- **Hosted (`cloudflare`):** open https://transcribe-chats.pages.dev/ without signing in, installing Docker or running Python. Cloudflare handles speech and Gemini. See the [hosted branch setup](https://github.com/lionsgrandson/transcribeChats/tree/cloudflare).
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

## Cloudflare web app

Cloudflare Pages production follows **`cloudflare`**, not `main`. The hosted app runs directly in the browser with Cloudflare Workers AI and Gemini; it does not need sign-in, Docker or localhost services. Guest records stay in the browser, and account sync is optional.

For hosted development and publishing, check out [the cloudflare branch](https://github.com/lionsgrandson/transcribeChats/tree/cloudflare) in a separate checkout and follow its README. Its public hosted defaults live in `.env.production`. This desktop branch deliberately blocks production publishing.

## Persistence, recovery and synchronization

Desktop data keeps the existing `transcribeChats` IndexedDB database. On the hosted branch, guests use browser-local storage at the production origin; optional signed-in accounts use separate private databases. Signing out or switching accounts reloads the application before another workspace opens.

Older anonymous hosted browser data opens directly as a guest. Optional **Settings → Recover existing browser transcripts** copies records into a signed-in account only after ownership confirmation. It preserves recordings, progress, IDs and originals, without copying old CRM credentials.

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

`check` runs ESLint, frontend/unit tests, Worker tests, TypeScript, the production Vite build and compiled-output validation. Browser tests use an isolated browser profile and synthetic data. Hosted tests require explicitly supplied disposable account fixtures; normal runs skip them. See the report for the tests actually executed against live services.

Pages build settings: **build command `npm ci && npm run check`**, **output directory `dist`**, repository root. `wrangler.jsonc` also declares `dist` as the Pages output. SPA redirects preserve deep links, hashed assets get JavaScript/CSS MIME types, and the service worker must revalidate. Never publish the repository root: its `index.html` references TypeScript source.

Publish the website from the `cloudflare` branch only. `npm run deploy` on main exits before contacting Cloudflare. Keep local worker, CUDA, video and Ollama changes on main.
