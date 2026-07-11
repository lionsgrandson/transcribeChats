# TranscribeChats

TranscribeChats is an installable cross-platform PWA for bilingual Hebrew/English transcription, structured meeting analysis, and task/event management.

Project status: functional MVP implementation.

Application version: `0.2.0`

Last updated: 2026-07-11

## Start here

The complete product, architecture, database, API, UX, testing, and delivery plan is in [docs/IMPLEMENTATION_SPECIFICATION.md](docs/IMPLEMENTATION_SPECIFICATION.md).

## Implemented stack

- React 19, TypeScript, Vite, and an installable PWA shell for mobile and desktop.
- Supabase Auth, Postgres, Storage, Realtime, and Edge Functions for identity, sync, media storage, and lightweight orchestration.
- A Dockerized Python worker using `faster-whisper`, FFmpeg, optional `pyannote.audio`, and optional Ollama analysis.
- Dexie/IndexedDB for offline transcripts, media, tasks, events, notes, and preferences.
- A provider-neutral analysis interface supporting a local LLM first and an optional hosted model later.

The repository originally recommended Flutter. The implementation uses the PWA option explicitly allowed by the requirements because Flutter/Dart are not installed in the delivery environment; this route produces a buildable and testable application now and avoids maintaining separate mobile/desktop UI stacks.

## Run the application

Prerequisites: Node.js 22+, npm, and Docker Desktop for real file transcription.

```powershell
npm.cmd install
docker compose up --build -d
npm.cmd run dev
```

Open `http://localhost:4173`. The first real transcription downloads the selected Whisper model into the `transcription-models` Docker volume and will take longer than later requests.

The application works without the worker for manual text, task/event extraction, offline history, exports, and the demo workspace. Recording and uploaded media remain safely stored in IndexedDB when the worker is unavailable and can be retried later.

## Enable Supabase synchronization

Run a local Supabase stack:

```powershell
npx.cmd supabase start
```

Copy `.env.example` to `.env.local`, then set the project URL and publishable/anon key shown by the Supabase CLI:

```text
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_WORKER_URL=http://localhost:8787
```

Restart the Vite server. Sign in with a magic link from Settings, then use Sync now. The migration creates private workspaces, RLS policies, transcript/task/note tables, and a private media bucket.

## Enable speaker diarization

The base worker assigns `Speaker 1`. To enable actual anonymous speaker diarization, obtain access to the configured `pyannote` community model and set:

```powershell
$env:INSTALL_DIARIZATION='true'
$env:ENABLE_DIARIZATION='true'
$env:PYANNOTE_TOKEN='your-token'
docker compose build --no-cache transcription-worker
docker compose up -d
```

Speaker labels remain anonymous until the user renames them. The app never claims biometric identity.

## Optional local LLM analysis

Rules-based Hebrew/English extraction works by default. For higher-quality structured extraction with an existing Ollama server:

```powershell
$env:OLLAMA_URL='http://host.docker.internal:11434'
$env:OLLAMA_MODEL='qwen3:4b'
docker compose up -d
```

## Verification

```powershell
npm.cmd run check
npm.cmd run worker:test
```

For the worker test environment on Windows, initialize it once:

```powershell
python -m venv services\worker_python\.venv
services\worker_python\.venv\Scripts\python.exe -m pip install -r services\worker_python\requirements-test.txt
npm.cmd run worker:test
```

The UI implements blank, filled, success, failure, and skeleton-loading states. Interactive buttons include hover, focus, pressed, disabled, and busy states.

## Feature coverage

- Upload MP3, M4A, MP4, MOV, WAV, WebM, OGG, FLAC, and common media containers.
- Record from the microphone with pause/resume and local recovery.
- Paste manual text and context.
- Hebrew, English, mixed, or automatic language mode.
- Timestamped editable transcript and editable speaker labels.
- Optional speaker diarization.
- Tasks, events, summaries, notes, takeaways, priorities, due dates, reminders, and tags.
- Transcript, task, event timeline, summary, notes, calendar, and searchable-history views.
- ChatGPT clipboard handoff and validated preview-before-commit import.
- TXT, CSV, and browser-native PDF/print export with Hebrew bidi rendering.
- Offline IndexedDB persistence, PWA installation, Supabase authentication, private media storage, RLS, and bidirectional sync.

## Known platform boundary

Browser reminders are delivered while the installed PWA is running. Reliable closed-app mobile/desktop push requires a push-notification provider and is a post-MVP capability. The task and reminder records themselves sync through Supabase.

## Remaining delivery order

1. Configure a hosted Supabase project and apply the included migration.
2. Choose an always-on worker host for mobile processing when no desktop is online.
3. Add push-notification credentials for closed-app reminders.
4. Run the bilingual accuracy corpus and choose production model defaults.
5. Package signed store releases or distribute the installable PWA URL.

## Versioning rule

Once application scaffolding creates `package.json` and `package-lock.json`, every repository change must update both versions using semantic versioning:

- Patch: fixes, copy, tests, documentation, and backward-compatible refinements.
- Minor: backward-compatible features.
- Major: breaking schema, API, sync, or user-workflow changes.

The current `package.json` and `package-lock.json` both track application version `0.2.0`.
