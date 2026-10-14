import { spawnSync } from 'node:child_process';
const windows = process.platform === 'win32';
const result = spawnSync(windows ? process.env.ComSpec || 'cmd.exe' : 'npm', windows ? ['/d', '/s', '/c', 'npm run deploy'] : ['run', 'deploy'], { stdio: 'inherit', env: process.env });
process.exit(result.status || (result.error ? 1 : 0));
