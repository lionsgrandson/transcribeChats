import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { join, resolve } from 'node:path';

const isWindows = process.platform === 'win32';
const rootDir = resolve(process.cwd());
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const gib = (bytes) => bytes / 1024 / 1024 / 1024;
const args = new Set(process.argv.slice(2));
const statusOnly = args.has('--status');
const forceRebuild = args.has('--rebuild');
const fallbackOnly = args.has('--fallback');

function parseDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const fileEnvironment = parseDotEnv(join(rootDir, '.env'));
const configuredEnvironment = { ...fileEnvironment, ...process.env };
const hasPyannoteToken = /^hf_[A-Za-z0-9]+$/.test(configuredEnvironment.PYANNOTE_TOKEN?.trim() || '');

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed.`);
}

function commandWorks(command, commandArgs) {
  return spawnSync(command, commandArgs, { stdio: 'ignore', shell: false }).status === 0;
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

async function fetchJson(url, timeoutMs = 3_000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
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

function strongestLocalModel() {
  const memoryGb = gib(totalmem());
  if (memoryGb >= 170) return 'qwen3:235b';
  if (memoryGb >= 80) return 'gpt-oss:120b';
  if (memoryGb >= 28) return 'qwen3:30b';
  if (memoryGb >= 16) return 'qwen3:14b';
  return 'qwen3:8b';
}

async function verifyPyannoteModelAccess(token, model) {
  if (!token || fallbackOnly) return { state: 'disabled' };
  const path = model || 'pyannote/speaker-diarization-community-1';
  try {
    const response = await fetch(`https://huggingface.co/${path}/resolve/main/config.yaml`, {
      headers: { Authorization: `Bearer ${token}`, Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow'
    });
    if (response.ok || response.status === 206) return { state: 'verified' };
    if (response.status === 401 || response.status === 403) return { state: 'denied', status: response.status };
    return { state: 'unknown', status: response.status };
  } catch {
    return { state: 'offline' };
  }
}

async function ensureDocker() {
  if (commandWorks('docker', ['info'])) return;
  if (!isWindows) throw new Error('Docker is not running. Start the Docker service and run npm start again.');
  const desktop = join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');
  if (!existsSync(desktop)) throw new Error('Docker Desktop is not installed in its standard location.');
  console.log('[SETUP] Starting Docker Desktop...');
  const child = spawn(desktop, [], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  await waitFor(() => commandWorks('docker', ['info']), 'Docker Desktop');
}

async function ensureOllama() {
  const executable = findOllama();
  if (!executable) throw new Error('Ollama is not installed. Install it, then run START-LEARNING.cmd again.');
  if (!(await urlReady('http://127.0.0.1:11434/api/tags'))) {
    console.log('[SETUP] Starting Ollama...');
    const child = spawn(executable, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    await waitFor(() => urlReady('http://127.0.0.1:11434/api/tags'), 'Ollama', 60_000);
  }
  const response = await fetch('http://127.0.0.1:11434/api/tags');
  const installed = (await response.json()).models || [];
  const requested = configuredEnvironment.OLLAMA_MODEL?.trim() || strongestLocalModel();
  if (!installed.some((model) => model.name === requested || model.model === requested)) {
    console.log(`[SETUP] Pulling Ollama model ${requested}...`);
    run(executable, ['pull', requested]);
  }
  console.log(`[OK] Ollama model: ${requested} (${gib(totalmem()).toFixed(0)} GB system memory detected)`);
  return requested;
}

function printWorkerStatus(health, pyannoteAccess = { state: 'unknown' }) {
  if (!health) {
    console.log('[OFFLINE] Transcription worker: not reachable at http://127.0.0.1:8787');
    if (hasPyannoteToken) console.log('[CONFIG] pyannote token: saved in .env (worker is offline, so package status cannot be checked)');
    else console.log('[CONFIG] pyannote token: not configured; acoustic fallback will be used');
    return;
  }

  console.log(`[OK] Whisper worker: ${health.asr_model || 'configured model'} on ${health.device || 'configured device'}`);
  if (fallbackOnly) {
    console.log('[OK] Speaker separation: acoustic fallback (forced for this run)');
  } else if (health.pyannote_available && pyannoteAccess.state === 'verified') {
    console.log('[OK] Speaker separation: pyannote Community-1 ready (high quality)');
  } else if (health.pyannote_available && pyannoteAccess.state === 'denied') {
    console.log('[WARN] Speaker separation: pyannote is installed, but Hugging Face model access is denied; acoustic fallback will be used');
  } else if (health.pyannote_available) {
    console.log('[INFO] Speaker separation: pyannote is installed/configured; online model access is not currently verified, and acoustic fallback remains available');
  } else if (health.diarization_available) {
    console.log('[WARN] Speaker separation: acoustic fallback available; pyannote is not active in the worker');
  } else {
    console.log('[WARN] Speaker separation: unavailable');
  }
}

async function printStatus() {
  const dockerInstalled = commandWorks(isWindows ? 'where.exe' : 'which', ['docker']);
  const dockerRunning = dockerInstalled && commandWorks('docker', ['info']);
  const ollama = await fetchJson('http://127.0.0.1:11434/api/tags');
  const health = await fetchJson('http://127.0.0.1:8787/health/ready');
  const access = await verifyPyannoteModelAccess(configuredEnvironment.PYANNOTE_TOKEN?.trim(), configuredEnvironment.PYANNOTE_MODEL?.trim());

  console.log(`${dockerInstalled ? '[OK]' : '[MISSING]'} Docker CLI: ${dockerInstalled ? 'installed' : 'not found'}`);
  console.log(`${dockerRunning ? '[OK]' : '[OFFLINE]'} Docker engine: ${dockerRunning ? 'running' : 'not running'}`);
  console.log(`${ollama ? '[OK]' : '[OFFLINE]'} Ollama: ${ollama ? `${ollama.models?.length || 0} local model(s) available` : 'not reachable at http://127.0.0.1:11434'}`);
  printWorkerStatus(health, access);

  if (access.state === 'verified') console.log('[OK] Hugging Face: Community-1 model access verified');
  else if (access.state === 'denied') console.log('[WARN] Hugging Face: token/model access denied. Accept the Community-1 terms and update the read token.');
  else if (access.state === 'offline' && hasPyannoteToken) console.log('[INFO] Hugging Face: token is configured, but online model access could not be verified right now');
  else if (!hasPyannoteToken) console.log('[INFO] Hugging Face: no pyannote token configured');
}

if (statusOnly) {
  await printStatus();
  process.exit(0);
}

await ensureDocker();
const ollamaModel = await ensureOllama();

const pyannoteAccess = await verifyPyannoteModelAccess(
  configuredEnvironment.PYANNOTE_TOKEN?.trim(),
  configuredEnvironment.PYANNOTE_MODEL?.trim()
);

if (!fallbackOnly && hasPyannoteToken) {
  if (pyannoteAccess.state === 'verified') {
    console.log('[OK] Hugging Face Community-1 access verified. High-quality speaker separation will be enabled.');
  } else if (pyannoteAccess.state === 'denied') {
    console.log('[WARN] Hugging Face denied Community-1 access. Check that you accepted the model terms and used a valid READ token.');
    console.log('[WARN] Startup will continue; transcription will automatically fall back to local acoustic speaker separation.');
  } else if (pyannoteAccess.state === 'offline') {
    console.log('[INFO] Could not verify Hugging Face access right now. The worker will use pyannote if its cached model is available, otherwise acoustic fallback.');
  }
} else if (!fallbackOnly) {
  console.log('[INFO] No PYANNOTE_TOKEN found. Speaker separation will use the local acoustic fallback.');
}

const serviceEnvironment = {
  ...fileEnvironment,
  ...process.env,
  ASR_MODEL: configuredEnvironment.ASR_MODEL || 'large-v3',
  ASR_DEVICE: configuredEnvironment.ASR_DEVICE || 'cuda',
  ASR_COMPUTE_TYPE: configuredEnvironment.ASR_COMPUTE_TYPE || 'float16',
  OLLAMA_URL: configuredEnvironment.OLLAMA_URL || 'http://host.docker.internal:11434',
  OLLAMA_MODEL: ollamaModel,
  INSTALL_DIARIZATION: configuredEnvironment.INSTALL_DIARIZATION || 'true',
  ENABLE_DIARIZATION: fallbackOnly ? 'false' : (configuredEnvironment.ENABLE_DIARIZATION || 'true'),
  PYANNOTE_TOKEN: fallbackOnly ? '' : (configuredEnvironment.PYANNOTE_TOKEN || ''),
  PYANNOTE_MODEL: configuredEnvironment.PYANNOTE_MODEL || 'pyannote/speaker-diarization-community-1',
  PYANNOTE_DEVICE: configuredEnvironment.PYANNOTE_DEVICE || 'cuda'
};

if (forceRebuild) {
  console.log('[REBUILD] Building transcription-worker without Docker cache...');
  run('docker', ['compose', 'build', '--no-cache', 'transcription-worker'], { env: serviceEnvironment });
  console.log('[START] Starting rebuilt local AI worker...');
  run('docker', ['compose', 'up', '-d'], { env: serviceEnvironment });
} else {
  console.log(`[START] Starting Whisper, ${fallbackOnly ? 'acoustic speaker separation' : 'speaker separation'}, and Ollama model ${ollamaModel}...`);
  run('docker', ['compose', 'up', '--build', '-d'], { env: serviceEnvironment });
}

await waitFor(() => urlReady('http://127.0.0.1:8787/health/ready'), 'Transcription worker', 180_000);
const workerHealth = await fetchJson('http://127.0.0.1:8787/health/ready', 5_000);
printWorkerStatus(workerHealth, pyannoteAccess);

if (!fallbackOnly && hasPyannoteToken && pyannoteAccess.state === 'verified' && !workerHealth?.pyannote_available) {
  console.log('[WARN] Your token is valid, but this worker image does not report pyannote as available.');
  console.log('[TIP] Run START-LEARNING.cmd rebuild once to rebuild the worker with diarization dependencies.');
}

console.log('[OK] Local AI stack is ready.');
console.log('[START] TranscribeChats: http://localhost:4173');
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const frontend = isWindows
  ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${npmCommand} run dev`], { stdio: 'inherit', windowsHide: true, env: serviceEnvironment })
  : spawn(npmCommand, ['run', 'dev'], { stdio: 'inherit', shell: false, env: serviceEnvironment });
frontend.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => frontend.kill('SIGINT'));
process.on('SIGTERM', () => frontend.kill('SIGTERM'));
