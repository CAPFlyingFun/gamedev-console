/**
 * The phone shell: one panel at a time, thumb-sized targets, and a layout that
 * survives the software keyboard. Drives the BUILT page at 390x844.
 */
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';

const URL_BASE = process.env.CONSOLE_URL || 'http://127.0.0.1:8898/gamedev-console/index.html';
const PANELS = ['left-panel', 'middle-panel', 'right-panel'];

function launchArgs() {
  const dir = '/opt/pw-browsers';
  const c = readdirSync(dir).find(d => d.startsWith('chromium-'));
  return c ? { executablePath: `${dir}/${c}/chrome-linux/chrome` } : {};
}

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const TREE = ['src/main.ts', 'src/scenes/antKinds.ts', 'src/world/heightfield.ts',
  'public/water-normal.png', 'README.md']
  .map((path, i) => ({ type: 'blob', path, sha: 'sha' + i, size: 900 }));

const browser = await chromium.launch({ ...launchArgs(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });

// ---------- phone ----------
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.route('https://api.github.com/**', r => {
  const u = new URL(r.request().url());
  const json = b => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
  if (u.pathname.includes('/git/trees/')) return json({ truncated: false, tree: TREE });
  if (u.pathname.includes('/git/blobs/')) return json({ encoding: 'base64', content: btoa('export const x = 1;\n') });
  return json({});
});
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('githubKey', 'ghp_t'));
await page.goto(URL_BASE, { waitUntil: 'load' });
await page.waitForTimeout(400);

const shown = () => page.evaluate(p => p.filter(i => !document.getElementById(i).hidden), PANELS);

check('exactly one panel is visible on a phone',
  (await shown()).length === 1, (await shown()).join(','));

/*
 * The page itself must not scroll. Stacked, it was 1160px against an 844px
 * viewport, which is why the editor sat below a screen and a half of setup.
 */
const pageScroll = await page.evaluate(() => ({
  scrollH: document.documentElement.scrollHeight, innerH: window.innerHeight,
}));
check('the page does not scroll as a page',
  pageScroll.scrollH <= pageScroll.innerH + 1,
  `${pageScroll.scrollH} vs ${pageScroll.innerH}`);

// 44px is Apple's minimum; the build before this one was at 28 throughout.
const small = await page.evaluate(() =>
  [...document.querySelectorAll('button,a,input,select,[role=button],.file-item')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; })
    .map(e => (e.id || e.className) + ':' + Math.round(e.getBoundingClientRect().height)));
check('every visible control is at least 44px tall', small.length === 0, small.slice(0, 6).join(' '));

const overflow = await page.evaluate(() => [...document.querySelectorAll('*')]
  .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).length);
check('nothing overflows horizontally', overflow === 0, String(overflow));

// The config folds itself once satisfied, so the file panel is mostly files.
check('the keys section folds itself when a key is already stored',
  await page.evaluate(() => document.getElementById('sec-keys').classList.contains('folded')));
check('a folded section still says what it holds',
  await page.evaluate(() => /GitHub/.test(document.getElementById('keys-summary').textContent)));

await page.evaluate(() => {
  document.getElementById('repo-owner').value = 'o';
  document.getElementById('repo-name').value = 'r';
});
await page.click('#btn-load-repo');
await page.waitForTimeout(500);

check('loading a repo folds the picker away',
  await page.evaluate(() => document.getElementById('sec-repo').classList.contains('folded')));

// The filename must survive truncation; the directory is what gets clipped.
check('a path renders as dimmed directory + full filename',
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.file-item')].find(e => e.dataset.path === 'src/scenes/antKinds.ts');
    return el?.querySelector('.fi-dir')?.textContent === 'src/scenes/'
        && el?.querySelector('.fi-name')?.textContent === 'antKinds.ts';
  }));

await page.fill('#file-filter', 'antk');
await page.waitForTimeout(200);
check('the filter narrows the list',
  await page.evaluate(() => [...document.querySelectorAll('#file-list .file-item')]
    .filter(e => !e.hidden).map(e => e.dataset.path).join() === 'src/scenes/antKinds.ts'));
await page.fill('#file-filter', '');

await page.evaluate(() => [...document.querySelectorAll('.file-item')]
  .find(e => e.dataset.path === 'src/main.ts')?.click());
await page.waitForTimeout(500);
check('opening a file switches to the code panel',
  (await shown()).join() === 'middle-panel');
check('the editor gets real height once shown',
  await page.evaluate(() => (document.querySelector('.cm-editor')?.getBoundingClientRect().height || 0) > 300));

/*
 * THE KEYBOARD. iOS shrinks visualViewport but not window.innerHeight, so
 * 100dvh stays full-screen and the bottom of the app goes under the keyboard.
 * Simulate exactly that asymmetry.
 */
const tabbarBottom = () => page.evaluate(() =>
  Math.round(document.getElementById('tabbar').getBoundingClientRect().bottom));
const idle = await tabbarBottom();
await page.evaluate(() => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, 'height', { value: 844 - 336, configurable: true });
  vv.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(250);
const raised = await tabbarBottom();
check('the tab bar rides above the keyboard',
  raised <= 844 - 336 + 1 && raised < idle, `idle=${idle} raised=${raised}`);

// iOS fires these continuously during the toolbar animation; small deltas must
// not move anything or the bar jitters on every focus.
await page.evaluate(() => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, 'height', { value: 844 - 12, configurable: true });
  vv.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(200);
check('toolbar-sized noise is ignored',
  await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kb').trim() === '0px'));

// ---------- desktop must be untouched ----------
const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const dpage = await dctx.newPage();
await dpage.goto(URL_BASE, { waitUntil: 'load' });
await dpage.waitForTimeout(400);
check('desktop still shows all three panels at once',
  await dpage.evaluate(p => p.every(i => !document.getElementById(i).hidden), PANELS));
check('desktop has no tab bar',
  await dpage.evaluate(() => getComputedStyle(document.getElementById('tabbar')).display === 'none'));

await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
