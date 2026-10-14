import { execFileSync } from 'node:child_process';
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const patterns = [/AIza[0-9A-Za-z_-]{30,}/, /(?:ghp|gho|github_pat)_[A-Za-z0-9_]{25,}/, /sb_secret_[A-Za-z0-9_-]{20,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
const failures = [];
for (const file of files) {
  if (file.startsWith('.audit/') || /^\.env(?:\.|$)/.test(file) && !['.env.example', '.env.production'].includes(file)) { failures.push(file); continue; }
  const content = execFileSync('git', ['show', ':' + file], { maxBuffer: 20 * 1024 * 1024 }).toString('utf8');
  if (file === '.env.production' && content.split(/\r?\n/).some(line => line.trim() && !line.startsWith('#') && !/^VITE_(RUNTIME_MODE|CLOUD_TRANSCRIBE_URL)=/.test(line))) failures.push(file);
  if (patterns.some((pattern) => pattern.test(content))) failures.push(file);
  for (const jwt of content.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try { if (JSON.parse(Buffer.from(jwt[1], 'base64url').toString()).role === 'service_role') failures.push(file); } catch { /* not a JWT */ }
  }
}
if (failures.length) throw new Error('Potential secret or private artifact in tracked files: ' + [...new Set(failures)].join(', '));
console.log(`Secret-pattern and service-role scan passed for ${files.length} tracked files.`);
