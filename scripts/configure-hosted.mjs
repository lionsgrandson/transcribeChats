import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Provision the new unified Worker only; preserve the legacy audio-job service.
const required = ['GEMINI_API_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
if (required.some((name) => !process.env[name]?.trim())) throw new Error('Missing configuration: ' + required.filter((name) => !process.env[name]?.trim()).join(', '));
const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'secret', 'bulk', '--config', 'wrangler.transcribe.jsonc'], {
  input: JSON.stringify({ GEMINI_API_KEY: process.env.GEMINI_API_KEY, SUPABASE_URL: process.env.VITE_SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY, ALLOWED_ORIGIN: 'https://transcribe-chats.pages.dev' }),
  encoding: 'utf8', env: process.env
});
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if (result.status !== 0) process.exit(result.status || 1);
