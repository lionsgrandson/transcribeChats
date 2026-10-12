import { execFileSync } from 'node:child_process';
const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_CLOUD_TRANSCRIBE_URL'];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error('Missing frontend build variables: ' + missing.join(', '));
  process.exit(1);
}
const cloudUrl = process.env.VITE_CLOUD_TRANSCRIBE_URL.replace(/\/$/, '');
const supabaseUrl = process.env.VITE_SUPABASE_URL.replace(/\/$/, '');
if (!/^https:\/\/[^/]+$/.test(cloudUrl) || !/^https:\/\/[^/]+$/.test(supabaseUrl)) {
  console.error('Frontend cloud endpoints must be valid HTTPS origins.');
  process.exit(1);
}
if (process.env.VITE_SUPABASE_PUBLISHABLE_KEY.includes('service_role')) {
  console.error('Only the Supabase publishable/anon key may be used in VITE_*.');
  process.exit(1);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
function run(program, args) {
  console.log('Running: ' + program + ' ' + args.join(' '));
  execFileSync(program, args, { stdio: 'inherit', env: process.env });
}
try {
  run(npm, ['ci']);
  run(npm, ['run', 'check']);
  run('node', ['--test', 'cloudflare/transcribe-worker.node.mjs']);
  run(npm, ['audit', '--omit=dev', '--audit-level=high']);
  console.log('Deploying hosted Whisper API; required Worker secrets must already be configured.');
  run(npx, ['wrangler', 'deploy', '--config', 'wrangler.transcribe.jsonc']);
  let ready = false;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(cloudUrl + '/health/ready', { signal: AbortSignal.timeout(8000) });
      const status = await res.json();
      ready = res.ok && status.status === 'ready' && status.gemini === true;
      if (ready) break;
    } catch { /* Retry transient deployment propagation. */ }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!ready) throw new Error('Hosted transcription or Gemini background queue is not healthy. Verify GEMINI_API_KEY secret, GEMINI_JOBS Durable Object migration, ALLOWED_ORIGIN and Supabase Worker settings. Pages was NOT deployed.');
  console.log('Worker and Gemini queue configuration health OK. Publishing compiled frontend to existing Cloudflare Pages project.');
  run(npx, ['wrangler', 'pages', 'deploy', 'dist', '--project-name', 'transcribe-chats', '--branch', 'main']);
  console.log('Pages command completed. Verify sign-in, audio transcription, TXT/PDF export and mobile recording before announcing launch.');
} catch (error) {
  console.error('Publish FAILED:', error?.message ?? error);
  process.exitCode = 1;
}
