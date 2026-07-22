import { readFile } from 'node:fs/promises';
import { assert, test } from './runner.js';

const ROOT = new URL('../', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, ROOT), 'utf8');
}

test('mobile gestures: every page uses the shared gesture policy', async () => {
  for (const page of ['index.html', 'multiplayer.html']) {
    const html = await read(page);
    assert(
      html.includes('href="src/styles/base.css"'),
      `${page} must load the shared base stylesheet`,
    );
  }
});

test('mobile gestures: double-tap zoom is disabled without blocking pan or pinch', async () => {
  const css = await read('src/styles/base.css');
  assert(
    /html\s*{[^}]*touch-action:\s*manipulation\s*;/s.test(css),
    'the document root must use touch-action: manipulation',
  );
  assert(!/touch-action:\s*none\b/.test(css), 'touch-action: none would block native gestures');
});

test('mobile gestures: viewport remains user-scalable on every page', async () => {
  for (const page of ['index.html', 'multiplayer.html']) {
    const html = await read(page);
    const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i)?.[1] ?? '';
    assert(viewport.includes('width=device-width'), `${page} must remain responsive`);
    assert(!/user-scalable\s*=\s*no/i.test(viewport), `${page} must not disable user scaling`);
    assert(!/maximum-scale\s*=\s*1(?:\.0+)?(?:\s|,|$)/i.test(viewport), `${page} must allow zoom`);
  }
});

test('mobile gestures: multiplayer code fields do not trigger Safari focus zoom', async () => {
  const css = await read('src/styles/multiplayer.css');
  assert(
    /\.mp-code-input\s*{[^}]*font-size:\s*1rem\s*;/s.test(css),
    'code fields must render at Safari’s 16px focus-zoom threshold',
  );
});
