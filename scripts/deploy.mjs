import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { verifyBuild } from './verify-build.mjs';

const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_CLOUD_TRANSCRIBE_URL'];
if (required.some((name) => !process.env[name]?.trim())) throw new Error('Set public hosted build configuration: ' + required.join(', '));
for (const name of ['VITE_SUPABASE_URL', 'VITE_CLOUD_TRANSCRIBE_URL']) {
  const url = new URL(process.env[name]);
  if (url.protocol !== 'https:' || url.origin !== process.env[name].replace(/\/$/, '')) throw new Error(name + ' must be an HTTPS origin.');
}
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (key.startsWith('sb_secret_')) throw new Error('A secret Supabase key must never be bundled.');
if (key.split('.').length === 3) {
  const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (claims.role !== 'anon') throw new Error('Only a publishable or legacy anon key is allowed.');
}
if (!process.env.npm_execpath) throw new Error('Run this guarded publisher with npm run deploy.');
const runNode = (args) => execFileSync(process.execPath, args, { stdio: 'inherit', env: process.env });
const npm = (args) => runNode([process.env.npm_execpath, ...args]);
const wrangler = (args) => runNode([resolve('node_modules/wrangler/bin/wrangler.js'), ...args]);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const main = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8' }).split(/\s/)[0];
if (head !== main) throw new Error('Publish only the reviewed and merged origin/main commit.');
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) throw new Error('Tracked changes must be committed before publishing.');
npm(['ci']);
npm(['run', 'check']);
npm(['audit', '--audit-level=moderate']);
verifyBuild();
wrangler(['deploy', '--config', 'wrangler.transcribe.jsonc', '--keep-vars']);
const response = await fetch(process.env.VITE_CLOUD_TRANSCRIBE_URL.replace(/\/$/, '') + '/health/ready');
const health = await response.json();
if (!response.ok || health.status !== 'ready' || health.gemini !== true) throw new Error('Hosted transcription and Gemini must be ready before Pages publication.');
wrangler(['pages', 'deploy', 'dist', '--project-name', 'transcribe-chats', '--branch', 'main', '--commit-hash', head]);
runNode(['scripts/verify-deployment.mjs']);
