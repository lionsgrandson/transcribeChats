# TranscribeChats (transcription-only edition)

**Status:** proposed feature branch / staging candidate, not a verified production rollout.

A Hebrew/English transcription app with a deliberately limited scope:

- Record from microphone, upload audio, or paste an existing transcript.
- Automatic speech-to-text with Cloudflare Workers AI Whisper Large v3 Turbo (hosted) or the optional local Python/Whisper worker.
- Timestamped segments, editable speaker labels and text, audio playback, searchable offline history.
- Export transcripts to UTF-8 TXT or printable PDF, including Hebrew RTL text.
- Optional Supabase email sign-in and explicit sync of prior local records.
- Local IndexedDB stores recordings and transcripts, including media retained after a failed job for retry.

**No active CRM transfer, Sales Intelligence, tasks/calendar workflow, study module, social audit or billing.** Legacy data remains in its original IndexedDB tables and is **not deleted**. Legacy code is still in the repository for migration safety; it is not linked from the simplified interface.

## Hosted vs local transcription

Set `VITE_CLOUD_TRANSCRIBE_URL` in the frontend build to switch on hosted mode. Hosted mode uses a Cloudflare Worker that verifies Supabase sessions server-side, rate-limits per user, limits uploads to 8 MiB of audio and transcribes in memory. It accepts MP3, M4A, WAV, WebM, OGG, Opus and FLAC audio; video requires the local worker. It does not have cloud multi-speaker diarization, a long-audio processing queue, or a guarantee of finishing if the browser is closed. The existing optional local Python worker supports large recordings and pyannote diarization where correctly configured.

Never put Cloudflare account tokens, AI secrets or Supabase service-role credentials into `VITE_*` variables. `VITE_SUPABASE_PUBLISHABLE_KEY` is intentionally public.

## Development

Node.js 22+:

```sh
npm ci
npm run check
node --test cloudflare/transcribe-worker.node.mjs
```

Configure an ignored `.env.local` using `.env.example`, then use `npm run dev` for the browser UI.

## Production deployment

See **[transcription-only deployment and security requirements](docs/TRANSCRIPTION_ONLY_DEPLOYMENT.md)**.

On Windows, `PUBLISH-CLOUDFLARE.cmd` validates the required public build variables, runs tests and the runtime security audit, deploys the Worker, verifies its health and only then publishes Cloudflare Pages. You must first configure the required Worker secrets and Supabase email auth. The script does **not** provision a Supabase project, set production secrets, implement a daily inference budget or verify live user sign-in on its own.

Do not advertise a production launch until Cloudflare/Supabase resources are verified, a daily cost quota and abuse protections are in place, security checks pass and live E2E confirms both Hebrew and English transcription, mobile recording, editing, export and retry.

The previous larger application, including sales and study features, is preserved in the git history and on `main` until the migration is approved.
