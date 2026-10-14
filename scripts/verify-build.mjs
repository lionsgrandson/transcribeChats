import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyBuild(directory = 'dist') {
  const root = resolve(directory);
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  assert(!/\/src\/|\.tsx?\b/.test(html), 'Refusing to publish source HTML. Run the Vite production build first.');
  const modules = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  assert(modules.length > 0, 'No compiled JavaScript entry was found.');
  for (const asset of modules) {
    assert(/^\/assets\/.+\.js$/.test(asset), `Unexpected JavaScript entry: ${asset}`);
    assert(existsSync(resolve(root, asset.slice(1))), `Missing compiled asset: ${asset}`);
  }
  assert(existsSync(resolve(root, '_headers')), 'Missing Pages asset headers.');
  assert(!existsSync(resolve(root, 'src')) && !readdirSync(root).some((name) => name.startsWith('.env')), 'Source or environment files found in publish output.');
  console.log('Verified compiled JavaScript references, Pages headers and publish directory.');
  return modules;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyBuild(process.argv[2]);
