import assert from 'node:assert/strict';

const origin = process.argv[2] || 'https://transcribe-chats.pages.dev';
for (const path of ['/', '/history', '/tasks', '/calendar', '/study', '/social-audit', '/sales', '/settings', '/transcriptions/deep-link-validation']) {
  const response = await fetch(origin + path, { cache: 'no-store' });
  assert.equal(response.status, 200, `${path}: unexpected HTTP status`);
  assert(/text\/html/.test(response.headers.get('content-type')), `${path}: not HTML`);
  const html = await response.text();
  assert(!html.includes('/src/main.tsx'), `${path}: source HTML deployed`);
  for (const [, asset] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const js = await fetch(new URL(asset, origin));
    assert.equal(js.status, 200, `${asset}: missing asset`);
    assert(/(?:application|text)\/javascript/.test(js.headers.get('content-type')), `${asset}: invalid JavaScript MIME type`);
    assert(!(await js.text()).trimStart().startsWith('<'), `${asset}: received HTML`);
  }
  console.log(`PASS ${path}: HTML and compiled JavaScript served correctly`);
}
const sw = await fetch(origin + '/sw.js');
assert.equal(sw.status, 200);
assert(/no-cache|no-store/.test(sw.headers.get('cache-control')), 'Service worker must revalidate');
console.log('PASS service-worker cache headers');
