# Guest Cloudflare release

2026-10-14. Requested follow-up to the initial unification release.

## Branches and runtime

- `main`: original desktop/localhost application with the local Python/CUDA workflow.
- `cloudflare`: hosted application; Cloudflare Pages production follows this branch. No Docker, Python service or user sign-in is required to use transcription, Gemini, tasks, calendar or CRM.
- The release script publishes only the exact committed remote `cloudflare` head. Shared React components and business logic remain in the repository; the hosted defaults live in this branch's public `.env.production`.

The actual StudentTranscribe repository was inspected (`worker/index.js`, `worker/security.js`, `src/auth.ts` and deployment configuration). Its useful reference is browser-to-Cloudflare processing with private server configuration and background jobs. Its current authenticated/billing access model was not copied: this app explicitly supports guests. StudentTranscribe code, database, billing and deployment were not modified.

## Access, persistence and protection

The application opens directly into the browser workspace. Speech uses Workers AI and Gemini uses the existing durable analysis queue. A random browser token scopes guest jobs; a matching job ID alone cannot retrieve another browser's result. IP and owner submission limits remain active. Malformed explicit account credentials are rejected instead of silently downgraded, and CORS remains restricted to the configured frontend.

Recordings, transcripts, tasks and CRM settings persist in this origin's IndexedDB, including existing anonymous transcripts. Different browser profiles/devices have separate guest workspaces. Existing signed-in accounts keep their private database; sign-in is optional for manual cross-device sync. Optional auth failure cannot leave the application at a login gate. No table grants, RLS policies, existing accounts or user content were changed.

Guest data does not automatically travel to another device. Export a workspace/transcript backup before clearing browser data. Existing audio limits, provider quotas, bounded Gemini retries and job expiry remain in force. Local-only video/YouTube/Ollama operations remain on the desktop runtime and are described accurately in the hosted interface.

## Verification and deployment

Before publication: TypeScript, ESLint, production Vite/PWA build and compiled-output checks passed; 57 frontend/unit tests and 22 Worker tests passed; npm audit found zero vulnerabilities. Eight browser journeys passed on the compiled hosted preview, including real guest Whisper/Gemini, persistence, CRM mapping/confirmation/errors, rapid bulk updates, calendar dates and Hebrew mobile layout. No authentication fixtures were used and no localhost Python requests were made.

The compatible Worker guest release `94e060bc-69d9-4075-919a-a8b34ad26025` reports transcription ready, Gemini ready and guest access enabled. Existing account access and secrets were retained. Final Pages deployment and production-domain guest results are recorded after verification.
