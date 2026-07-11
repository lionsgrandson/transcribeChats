# TranscribeChats

TranscribeChats is an installable cross-platform PWA for bilingual Hebrew/English transcription, structured meeting analysis, and task/event management.

Project status: functional MVP implementation.

Application version: `0.4.0`

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

Prerequisites: Node.js 22+, npm, Docker Desktop, an NVIDIA GPU with current drivers, and Ollama. The default worker now uses CUDA and `float16` on the GPU.

```powershell
npm.cmd install
npm.cmd start
```

That single command starts Docker Desktop when necessary, starts Ollama, ensures an installed Ollama model is available, builds and starts the CUDA transcription worker, waits for its health check, and starts the frontend at `http://localhost:4173`. The first build downloads CUDA and Whisper dependencies and is much slower than later starts.

To use another local Ollama model:

```powershell
$env:OLLAMA_MODEL='qwen3.5:9b'
npm.cmd start
```

The startup command does not stop Docker or Ollama when you close the frontend because those may be used by other applications.

If `npm run dev` says `Port 4173 is already in use`, a development server is already running. Do not start a second copy; open `http://localhost:4173` in the browser. To deliberately stop the existing server and start it again in PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 4173 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess }
npm.cmd run dev
```

If the page is blank after the development server was restarted, open `http://localhost:4173` rather than switching between `localhost` and `127.0.0.1`, then press `Ctrl+Shift+R` once. Version 0.2.2 also displays a recovery screen instead of remaining blank when a page module is stale.

The application works without the worker for manual text, task/event extraction, offline history, exports, and the demo workspace. Recording and uploaded media remain safely stored in IndexedDB when the worker is unavailable and can be retried later.

### Transcription time and progress

Media file size is not a reliable estimate of transcription time; recording duration matters much more. A 27 MB video is not unusually large, but it can still contain a long recording. Version 0.3.0 runs faster-whisper on NVIDIA CUDA by default and uses GPU VRAM instead of placing the model workload on the CPU. FFmpeg decoding and application housekeeping can still use some CPU and system RAM.

While the local engine runs, the progress percentage between upload and finalization is explicitly marked as an estimate and the app shows elapsed time. Ollama does not perform speech-to-text. It runs only when you press **Send to Ollama** after Whisper has produced a transcript, and the Whisper model is released first to avoid both models competing for GPU memory.

Automatic extraction is deliberately conservative. It creates review suggestions only for explicit commitments such as “Dana will send the file” and explicit meeting proposals such as “Let’s have a meeting.” An undated meeting stays in review and does not appear on the calendar until you add a date/time and accept it. Advice, predictions, and ordinary conversation are not converted to tasks. Tasks and events support individual editing/deletion plus checkbox-based multi-select deletion.

Starting with version 0.2.4, new media uploads use resumable background jobs. The app saves the worker job ID locally and reconnects to it after a page refresh, so Docker can continue transcribing independently. If Docker itself restarts, the locally saved media remains available and the app presents a Retry action.

## Mobile Setup

Use this path when you want to run the app directly on an Android phone or tablet for development. The mobile browser runs the React/PWA app, while heavier transcription work should usually run on a desktop, server, or hosted worker that the phone can reach over the network.

1. Install the mobile tools.

   On Android, install Termux from F-Droid, then run:

   ```sh
   pkg update
   pkg upgrade
   pkg install git nodejs-lts
   ```

   On iOS, use a cloud development machine, GitHub Codespaces, or another remote Linux/macOS shell. iOS does not provide the same local package/runtime access as Termux.

2. Clone or open the project folder.

   ```sh
   git clone <your-repository-url> transcribeChats
   cd transcribeChats
   npm install
   ```

3. Configure environment variables.

   ```sh
   cp .env.example .env.local
   nano .env.local
   ```

   For mobile-only manual text, demo data, offline history, and task management, you can leave Supabase and the worker blank. For full sync and transcription, set these values:

   ```text
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   VITE_WORKER_URL=http://<desktop-or-server-lan-ip>:8787
   ```

4. Start the mobile development server.

   ```sh
   npm run dev -- --host 0.0.0.0
   ```

   Open `http://127.0.0.1:4173` in the mobile browser. If another device needs to reach the phone, use `http://<phone-lan-ip>:4173`.

5. Run the transcription worker on a stronger machine.

   On your desktop or server, start Docker and run:

   ```powershell
   docker compose up --build -d
   ```

   If the phone opens the app from `http://<phone-lan-ip>:4173`, allow that origin in the worker:

   ```powershell
   $env:CORS_ORIGINS='http://<phone-lan-ip>:4173,http://127.0.0.1:4173,http://localhost:4173'
   docker compose up -d
   ```

   Then open Settings on mobile, set Local worker URL to `http://<desktop-or-server-lan-ip>:8787`, and press Check.

6. Install the mobile PWA.

   In Chrome or Edge on Android, open the app, choose the browser menu, then select Install app or Add to Home screen. Give microphone permission when recording for the first time.

7. Use mobile features from the interface.

   Open Settings to switch English/Hebrew, enable reminders, check the local worker, sign in to Supabase, and press Sync now. Uploading large audio/video files from mobile works best when the worker is on Wi-Fi and the phone is not in battery-saver mode.

## Desktop App Setup

The implemented desktop path is an installable PWA: after installation, users launch it from the Start menu, Dock, launcher, or desktop shortcut like a normal app. Developers still use the CLI to start local services, but day-to-day users control app features from the graphical Settings page.

1. Install prerequisites.

   - Node.js 22 or newer.
   - Docker Desktop with WSL 2 integration for local audio/video transcription.
   - An NVIDIA GPU, current NVIDIA drivers, and Docker GPU support. This project is configured for CUDA 12 and cuDNN 9.
   - A modern Chromium-based browser such as Edge or Chrome for PWA installation.
   - Ollama for the **Send to Ollama** button.
   - Optional: Supabase CLI for local sync testing.

2. Install dependencies and start the app stack.

   ```powershell
   npm.cmd install
   npm.cmd start
   ```

   Open `http://localhost:4173`. This one command starts Docker Desktop, Ollama, the GPU worker, and the frontend. If your browser was already open, refresh once after startup completes.

3. Install TranscribeChats as a desktop app.

   In Edge or Chrome, open the browser app menu and choose Install TranscribeChats, Install app, or Apps > Install this site as an app. After that, launch TranscribeChats from the operating system app launcher instead of returning to the terminal.

4. Configure the transcription engine from the graphical interface.

   Open Settings > Transcription engine. The “engine” (previously called the “worker”) is the Python service that runs Whisper and converts media into transcript text.

   - If Docker is running on the same computer as the app, press **Use this computer**. The address is `http://localhost:8787`.
   - Press **Check connection**. “Engine is ready” means uploaded media can be transcribed.
   - A **remote engine** is the same Docker/Python service running on another computer, such as a desktop reached from a phone over Wi-Fi or an always-on server. Enter an address such as `http://192.168.1.50:8787` only when that other computer is configured to accept the connection.
   - If the engine is unavailable, manual text, offline history, exports, and task/event extraction from pasted transcripts still work.

5. Verify GPU-powered transcription.

   Run `npm.cmd start`, then use **Check connection** in Settings > Transcription engine. The status should report `cuda / float16`. The first build and first transcription download large model/runtime files, so leave the terminal and Docker running until they finish.

   You can also verify the GPU from PowerShell:

   ```powershell
   docker compose exec transcription-worker nvidia-smi
   curl.exe http://localhost:8787/health/ready
   ```

6. Use local LLM analysis.

   `npm.cmd start` starts Ollama and selects an installed model automatically. To choose a specific model, stop the frontend with `Ctrl+C`, then run:

   ```powershell
   $env:OLLAMA_MODEL='qwen3.5:9b'
   npm.cmd start
   ```

   Open a completed transcription and press **Send to Ollama**. LLM extraction is never automatic. Press **Send to ChatGPT** to copy/open the ChatGPT handoff instead. Ollama unloads the model after the response to reduce idle RAM and VRAM use.

7. Control available features from the graphical Settings page.

   Open Settings:

   - Language and direction: choose English or Hebrew.
   - Cloud sync: sign in with magic link, then press Sync now.
   - Reminders: switch task reminders on or off.
   - Transcription engine: choose this computer or enter another engine address, then press Check connection.
   - Install app: press the install button if the browser exposes the PWA install prompt.

   The installed PWA cannot directly start privileged operating-system services, so `npm.cmd start` is the master switch for Docker, Ollama, the worker, and the frontend. The in-app buttons choose when to send a transcript to ChatGPT or Ollama; they do not keep either LLM running continuously.

8. Optional native desktop packaging with Tauri.

   The repository currently ships as a PWA. If you want a signed native installer later, Tauri is the recommended wrapper because it keeps the existing Vite app and uses the OS WebView instead of bundling a full browser.

   ```powershell
   rustup default stable
   npm.cmd install --save-dev @tauri-apps/cli @tauri-apps/api
   npm.cmd exec tauri init
   npm.cmd exec tauri dev
   npm.cmd exec tauri build
   ```

   During `tauri init`, use Vite settings: development URL `http://localhost:4173`, frontend build command `npm.cmd run build`, and frontend output directory `dist`. Keep Docker, Supabase, and Ollama as external services so users can turn them on or off independently.

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

## Manual local LLM analysis

Strict rules-based Hebrew/English extraction works by default. Ollama analysis happens only when you press **Send to Ollama**. Start the complete local stack with:

```powershell
$env:OLLAMA_MODEL='qwen3.5:9b'
npm.cmd start
```

The worker releases Whisper from GPU memory before calling Ollama, and asks Ollama to unload its model after the response. This keeps peak GPU and system-memory use more predictable on an 8 GB GPU.

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
- Auto and mixed modes keep Whisper multilingual, label each segment as Hebrew, English, or mixed, and avoid forcing the entire file into one detected language.
- Timestamped editable transcript and editable speaker labels.
- Optional speaker diarization.
- Conservative review-first tasks/events, editable and deletable task records, accepted calendar events, summaries, notes, takeaways, priorities, due dates, reminders, and tags.
- Transcript, task, event timeline, summary, notes, calendar, and searchable-history views.
- ChatGPT clipboard handoff, manual Ollama analysis, and validated preview-before-commit import.
- Clickable source links jump to and highlight transcript evidence; timestamp play buttons seek the saved source media.
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

The current `package.json` and `package-lock.json` both track application version `0.4.0`.
