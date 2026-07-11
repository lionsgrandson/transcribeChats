import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
}

function commandWorks(command, args) {
  return spawnSync(command, args, { stdio: 'ignore', shell: false }).status === 0;
}

async function waitFor(check, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(1_000);
  }
  throw new Error(`${label} did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`);
}

async function urlReady(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok; }
  catch { return false; }
}

function findOllama() {
  if (commandWorks(isWindows ? 'where.exe' : 'which', ['ollama'])) return 'ollama';
  const candidates = isWindows ? [
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    join(process.env.LOCALAPPDATA || '', 'Ollama', 'ollama.exe'),
    join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe')
  ] : ['/usr/local/bin/ollama', '/usr/bin/ollama'];
  return candidates.find(existsSync);
}

async function ensureDocker() {
  if (commandWorks('docker', ['info'])) return;
  if (!isWindows) throw new Error('Docker is not running. Start the Docker service and run npm start again.');
  const desktop = join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');
  if (!existsSync(desktop)) throw new Error('Docker Desktop is not installed in its standard location.');
  console.log('Starting Docker Desktop…');
  const child = spawn(desktop, [], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  await waitFor(() => commandWorks('docker', ['info']), 'Docker Desktop');
}

async function ensureOllama() {
  const executable = findOllama();
  if (!executable) throw new Error('Ollama is not installed. Install it, then run npm start again.');
  if (!(await urlReady('http://127.0.0.1:11434/api/tags'))) {
    console.log('Starting Ollama…');
    const child = spawn(executable, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    await waitFor(() => urlReady('http://127.0.0.1:11434/api/tags'), 'Ollama', 60_000);
  }
  const response = await fetch('http://127.0.0.1:11434/api/tags');
  const installed = (await response.json()).models || [];
  const requested = process.env.OLLAMA_MODEL || installed[0]?.name || 'qwen3.5:9b';
  if (!installed.some((model) => model.name === requested || model.model === requested)) {
    console.log(`Pulling Ollama model ${requested}…`);
    run(executable, ['pull', requested]);
  }
  return requested;
}

await ensureDocker();
const ollamaModel = await ensureOllama();
const serviceEnvironment = {
  ...process.env,
  ASR_DEVICE: process.env.ASR_DEVICE || 'cuda',
  ASR_COMPUTE_TYPE: process.env.ASR_COMPUTE_TYPE || 'float16',
  OLLAMA_URL: process.env.OLLAMA_URL || 'http://host.docker.internal:11434',
  OLLAMA_MODEL: ollamaModel
};

console.log(`Starting GPU transcription worker and Ollama model ${ollamaModel}…`);
run('docker', ['compose', 'up', '--build', '-d'], { env: serviceEnvironment });
await waitFor(() => urlReady('http://127.0.0.1:8787/health/ready'), 'Transcription worker', 120_000);

console.log('Starting TranscribeChats at http://localhost:4173');
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const frontend = isWindows
  ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${npmCommand} run dev`], { stdio: 'inherit', windowsHide: true, env: serviceEnvironment })
  : spawn(npmCommand, ['run', 'dev'], { stdio: 'inherit', shell: false, env: serviceEnvironment });
frontend.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => frontend.kill('SIGINT'));
process.on('SIGTERM', () => frontend.kill('SIGTERM'));
