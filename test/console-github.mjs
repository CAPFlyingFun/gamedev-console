/**
 * Drives the BUILT console against an intercepted api.github.com.
 * See README.md for what each case is guarding and why.
 */
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const URL_BASE = process.env.CONSOLE_URL || 'http://127.0.0.1:8898/gamedev-console/index.html';
const MB = 1024 * 1024;

function launchArgs() {
  const dir = '/opt/pw-browsers';
  const c = readdirSync(dir).find(d => d.startsWith('chromium-'));
  return c ? { executablePath: `${dir}/${c}/chrome-linux/chrome` } : {};
}

const TREE = [
  { type: 'blob', path: 'src/ok.ts',         sha: 'sha-ok',   size: 20 },
  { type: 'blob', path: 'src/huge.ts',       sha: 'sha-huge', size: 5 * MB },   // text, but huge
  { type: 'blob', path: 'public/water.png',  sha: 'sha-png',  size: 900 },      // small, but binary
  { type: 'blob', path: 'src/we#ird+file.ts',sha: 'sha-odd',  size: 40 },
  { type: 'blob', path: 'a b&c.md',          sha: 'sha-sp',   size: 20 },
  // Small enough to pass the size gate, so the encoding guard is what has to
  // catch it. Without this row that guard is never executed by the suite.
  { type: 'blob', path: 'src/weird.ts',      sha: 'sha-noenc',size: 40 },
  { type: 'blob', path: 'models/scene.gltf', sha: 'sha-gltf', size: 40 },  // JSON, not binary
];

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({ ...launchArgs(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const puts = [];
const gets = [];
await ctx.route('https://api.github.com/**', async route => {
  const u = new URL(route.request().url());
  const method = route.request().method();
  const json = b => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

  if (method === 'PUT') {
    puts.push({ path: u.pathname, body: JSON.parse(route.request().postData() || '{}') });
    return json({ content: { sha: 'sha-new' }, commit: { html_url: 'http://example/commit' } });
  }
  gets.push(u.pathname);
  if (u.pathname.includes('/git/trees/')) return json({ truncated: true, tree: TREE });
  // The shape that caused the loss: 200, a valid sha, and no content.
  if (u.pathname.includes('/git/blobs/sha-huge')) return json({ encoding: 'none', content: '' });
  if (u.pathname.includes('/git/blobs/sha-noenc')) return json({ encoding: 'none', content: '' });
  if (u.pathname.includes('/git/blobs/')) return json({ encoding: 'base64', content: btoa('hello\n') });
  return json({});
});

const page = await ctx.newPage();
const dialogs = [];
page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
await page.addInitScript(() => localStorage.setItem('githubKey', 'ghp_test'));
await page.goto(URL_BASE, { waitUntil: 'load' });

check('the app booted (built asset actually loaded)',
  await page.evaluate(() => typeof window.insertToEditor) === 'function',
  'if this fails, the bundle 404d — serve dist/public at /gamedev-console/');

check('replaceEditor is defined',
  await page.evaluate(() => typeof window.replaceEditor) === 'function');

await page.evaluate(() => {
  document.getElementById('repo-owner').value = 'o';
  document.getElementById('repo-name').value = 'r';
});
await page.click('#btn-load-repo');
await page.waitForTimeout(800);

check('a truncated listing says so on screen',
  await page.evaluate(() => [...document.querySelectorAll('#file-list .error-text')]
    .some(e => /truncated/i.test(e.textContent))));

const open = async path => {
  /*
   * dataset.path first, textContent as a fallback: the fallback is what lets
   * this suite drive the PRE-FIX build too. Without it no file is ever
   * clicked there, and two of the assertions below pass by doing nothing —
   * which is the failure mode a regression test exists not to have.
   */
  await page.evaluate(p => ([...document.querySelectorAll('.file-item')]
    .find(e => e.dataset.path === p) ||
    [...document.querySelectorAll('.file-item')]
    .find(e => e.textContent === p))?.click(), path);
  await page.waitForTimeout(400);
  return page.evaluate(() => document.getElementById('current-file-path').textContent);
};

check('a >1MB TEXT file is refused, not shown empty',
  /not editable/.test(await open('src/huge.ts')),
  'guards the read half of the data loss');

const before = puts.length;
const refusedLabel = await page.evaluate(() => document.getElementById('current-file-path').textContent);
await page.click('#btn-push-commit');
await page.waitForTimeout(300);
check('pushing while a refused file is open commits nothing',
  puts.length === before && /not editable/.test(refusedLabel),
  'guards the write half. The label check keeps this honest: against the '
  + 'pre-fix build nothing is refused, so it fails there rather than passing '
  + 'because no file was ever opened. Note the size guard refuses BEFORE any '
  + 'request, so there is deliberately no read to assert on here.');

check('a binary file is refused',
  /not editable/.test(await open('public/water.png')));

check('an ordinary file still opens',
  (await open('src/ok.ts')) === 'src/ok.ts');

check('reads never touch the contents API',
  gets.some(p => p.includes('/git/blobs/')) && !gets.some(p => p.includes('/contents/')),
  'that endpoint is the one that goes empty past 1MB. Requires a blob read to '
  + 'have happened, so it cannot pass vacuously');

check('a path with # and + opens',
  (await open('src/we#ird+file.ts')) === 'src/we#ird+file.ts');

check('a blob returned with encoding != base64 is refused',
  /not editable/.test(await open('src/weird.ts')),
  'reaches the guard the size gate would otherwise short-circuit');

check('.gltf opens — it is JSON, and the null-byte check covers one that lies',
  (await open('models/scene.gltf')) === 'models/scene.gltf',
  'the extension list guards genuinely binary formats, not text ones that sit near them');

await open('a b&c.md');
await page.evaluate(() => { document.getElementById('commit-message').value = 'test'; });
await page.click('#btn-push-commit');
await page.waitForTimeout(500);
check('a pushed path is URI-encoded per segment',
  puts.some(p => p.path.endsWith('/contents/a%20b%26c.md')),
  puts.map(p => p.path).join(', '));

// --- the regression the adversarial review caught -----------------------
// Reading by the tree's sha makes the listing a snapshot. Before the fix,
// re-opening a file after pushing it served the pre-commit blob forever.
const shaBefore = await page.evaluate(() =>
  document.querySelector('.file-item[data-path="src/ok.ts"]')?.dataset.sha);
await open('src/ok.ts');
await page.evaluate(() => { document.getElementById('commit-message').value = 'x'; });
await page.click('#btn-push-commit');
await page.waitForTimeout(500);
const shaAfter = await page.evaluate(() =>
  document.querySelector('.file-item[data-path="src/ok.ts"]')?.dataset.sha);
check('the listing sha is corrected after a push, so a re-open is not stale',
  shaBefore === 'sha-ok' && shaAfter === 'sha-new',
  `before=${shaBefore} after=${shaAfter}`);

await browser.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
