# Supabase Setup for TranscribeChats

This guide configures hosted or local Supabase authentication, database sync, and private media storage for TranscribeChats.

## What Supabase provides

Supabase is used for user accounts, private cross-device synchronization, transcript/task/event storage, and the private `media` storage bucket. Audio transcription and Ollama analysis still run through the Python worker configured by `VITE_WORKER_URL`; Supabase does not replace that worker.

## 1. Install the prerequisites

Install Node.js 22+, Docker Desktop, and the project dependencies:

```powershell
npm.cmd install
npx.cmd supabase --version
```

The Supabase CLI is already included in this project's development dependencies, so a global installation is not required.

## 2. Create a hosted Supabase project

1. Open the Supabase Dashboard and create a project.
2. Save the database password in a password manager. It is used by the CLI when linking or pushing migrations; it does not belong in the browser application.
3. In **Project Settings > API**, copy:
   - Project URL, such as `https://abc123.supabase.co`.
   - Publishable key, beginning with `sb_publishable_`. A legacy `anon` key also works, but a publishable key is preferred.
4. Never put a secret key, `service_role` key, database password, or JWT secret in a `VITE_*` variable. Vite variables are bundled into the public application.

## 3. Configure authentication URLs

In **Authentication > URL Configuration**:

1. Set **Site URL** to the main address users open, for example `https://transcribe.example.com`.
2. Add exact redirect URLs for every supported environment:

```text
http://localhost:4173
http://127.0.0.1:4173
https://transcribe.example.com
```

3. If you deploy previews, add only the required preview pattern. Prefer exact production URLs.
4. Keep the Email provider enabled. The app currently signs users in with a magic link.

The application's magic-link request uses the current browser origin as its redirect target, so that origin must be allowed here.

## 4. Apply the included database migration

The migration at `supabase/migrations/202607110001_initial_schema.sql` creates the tables, personal-workspace function, Row Level Security policies, grants, and private `media` bucket.

Log in, link the local repository to the hosted project, preview the migration, and apply it:

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref YOUR_PROJECT_REF
npx.cmd supabase db push --dry-run
npx.cmd supabase db push
```

`YOUR_PROJECT_REF` is the identifier in the Dashboard URL: `https://supabase.com/dashboard/project/YOUR_PROJECT_REF`.

After the push, verify these objects in the Dashboard:

- Tables: `profiles`, `workspaces`, `workspace_members`, `transcriptions`, `media_assets`, `transcript_segments`, `extracted_items`, `transcription_notes`, and `processing_jobs`.
- Database function: `ensure_personal_workspace`.
- Storage bucket: `media`, marked private.
- Row Level Security enabled on application tables and storage policies present for the `media` bucket.

Do not manually make the `media` bucket public.

## 5. Create the frontend environment file

Copy `.env.example` to `.env.local`:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Set all three frontend variables:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
VITE_WORKER_URL=http://localhost:8787
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | For cloud sync | Hosted or local Supabase project URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | For cloud sync | Public client key. Access is still restricted by authentication and RLS. |
| `VITE_WORKER_URL` | For media transcription and Ollama | URL of the local or remote Python worker. |

Restart the frontend after changing Vite variables. They are read at build/start time:

```powershell
npm.cmd start
```

## 6. Optional worker environment variables

Docker Compose reads optional worker settings from the repository-root `.env` file. These are separate from `.env.local`:

```dotenv
ASR_MODEL=small
ASR_DEVICE=cuda
ASR_COMPUTE_TYPE=float16
MAX_UPLOAD_BYTES=2147483648
CORS_ORIGINS=http://localhost:4173,http://127.0.0.1:4173
OLLAMA_URL=http://host.docker.internal:11434
OLLAMA_MODEL=qwen3.5:9b

INSTALL_DIARIZATION=false
ENABLE_DIARIZATION=false
PYANNOTE_TOKEN=
PYANNOTE_MODEL=pyannote/speaker-diarization-community-1
PYANNOTE_METRICS_ENABLED=false
```

You normally do not need this file because the application has usable defaults. Set it when changing models, upload limits, browser origins, Ollama, or diarization.

For a deployed PWA or a phone connecting over the LAN, add its exact origin to `CORS_ORIGINS`, then rebuild the worker:

```powershell
docker compose up --build -d
```

`INSTALL_DIARIZATION=true` is a Docker build option. `ENABLE_DIARIZATION=true` enables it at runtime, and `PYANNOTE_TOKEN` must have access to the configured Hugging Face model.

## 7. Test authentication and synchronization

1. Open `http://localhost:4173`.
2. Go to **Settings > Account & sync**.
3. Enter your email and request a magic link.
4. Open the link and confirm the app shows the signed-in account.
5. Create or upload a small transcription.
6. Press **Sync now**.
7. In Supabase Table Editor, confirm a personal workspace and transcription rows were created.
8. In Storage, confirm uploaded media is under the private `media` bucket.

If sign-in returns to the wrong page, recheck the Site URL and Redirect URLs. If sync returns an RLS or missing-function error, rerun `npx.cmd supabase db push` and verify that `ensure_personal_workspace` exists.

## 8. Local Supabase instead of hosted Supabase

Start the local stack and apply the included migration:

```powershell
npx.cmd supabase start
npx.cmd supabase db reset
npx.cmd supabase status
```

Use the API URL and publishable/anon key printed by `supabase status`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=PASTE_THE_LOCAL_PUBLISHABLE_OR_ANON_KEY
VITE_WORKER_URL=http://localhost:8787
```

Local Studio is available at `http://127.0.0.1:54323`. Local Supabase uses substantial RAM because it starts several Docker services; use hosted Supabase if running it alongside Whisper and Ollama strains the machine.

## 9. Optional CLI-only variables

These are not application variables and should not be added to `.env.local`:

| Variable | When needed |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Non-interactive CLI/CI authentication instead of `supabase login`. |
| `SUPABASE_DB_PASSWORD` | Non-interactive `supabase link`, `db push`, or `db pull`. Store it only in a secure CI secret manager. |

The application does **not** require `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, or a JWT secret. Adding any of those to the frontend would be unsafe.

## 10. Troubleshooting checklist

```powershell
npx.cmd supabase migration list
npx.cmd supabase db push --dry-run
docker compose ps
curl.exe http://localhost:8787/health/ready
```

- **Supabase is not configured:** `.env.local` is missing the URL or publishable key, or Vite was not restarted.
- **Magic link opens the wrong host:** fix Authentication URL Configuration.
- **RLS denied the sync:** sign in again and verify the included migration/policies were applied.
- **Media upload denied:** verify the private `media` bucket and storage policies were created by the migration.
- **Transcription unavailable:** Supabase is independent of the local worker; check `VITE_WORKER_URL`, Docker, and port `8787`.
- **Changes reappear after deletion:** ensure every device is running the same application version before syncing.
