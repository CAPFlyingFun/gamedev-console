import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve as pres } from 'node:path';
import { transform } from 'sucrase';

const ROOT = process.argv[2] || '/home/user/TRADDOMIUM-Micro-Battle';
const ASSET_BASE = process.argv[3] || 'http://127.0.0.1:8804/';

// ---- 1. read the VFS (what the console would hold from the GitHub tree) ----
const vfs = new Map();
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p))
      vfs.set(p.slice(ROOT.length + 1), readFileSync(p, 'utf8'));
  }
})(join(ROOT, 'src'));

// ---- 2. resolver: extension probing against the VFS ----
const CAND = (b) => [`${b}.ts`, `${b}.tsx`, `${b}.js`, `${b}/index.ts`, `${b}/index.js`, b];
function resolveSpec(spec, fromPath) {
  const b = pres('/' + dirname(fromPath), spec).slice(1);
  for (const c of CAND(b)) if (vfs.has(c)) return c;
  return null;
}

// ---- 3. shims, applied before transform ----
const DEFINES = {
  __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8')).version),
  __BUILD_COMMIT__: '"preview"',
  __BUILD_DATE__: '"preview"',
};
function shim(src) {
  let s = src
    .replace(/import\.meta\.env\.BASE_URL/g, JSON.stringify(ASSET_BASE))
    .replace(/import\.meta\.env\.DEV/g, 'true')
    .replace(/import\.meta\.env\.PROD/g, 'false')
    .replace(/import\.meta\.env\.MODE/g, '"development"');
  return s;
}
// Defines must run AFTER type-stripping: `declare const __APP_VERSION__: string;`
// is an ambient declaration, and replacing the identifier there yields
// `declare const "0.0.127": string;` — a syntax error. Sucrase deletes the
// declaration outright, so post-transform only real value usages remain.
function applyDefines(js) {
  let s = js;
  for (const [k, v] of Object.entries(DEFINES)) s = s.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
  return s;
}

// ---- 4. rewrite every internal specifier to a bare ~key ----
const SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)(['"])(\.[^'"]*)\2/gm;
const unresolved = [];
function link(src, path) {
  return src.replace(SPEC_RE, (m, pre, q, spec) => {
    const r = resolveSpec(spec, path);
    if (!r) { unresolved.push({ path, spec }); return m; }
    return `${pre}${q}~${r}${q}`;
  });
}

// ---- 5. run it ----
const t0 = process.hrtime.bigint();
const modules = {};
const failures = [];
let bytesIn = 0;
for (const [path, raw] of vfs) {
  bytesIn += raw.length;
  try {
    const linked = link(shim(raw), path);
    const { code } = transform(linked, {
      transforms: ['typescript', ...(path.endsWith('.tsx') ? ['jsx'] : [])],
      filePath: path,
    });
    modules['~' + path] = applyDefines(code);
  } catch (e) { failures.push({ path, err: String(e.message).slice(0, 160) }); }
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

// ---- 5b. the SHELL shim the plan omitted -------------------------------
// The entry does `document.getElementById('app')` and throws without it.
// A game is its index.html *and* its modules: the runner must reproduce the
// document the entry expects, minus the <script type=module> that boots it.
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const bodyInner = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [,''])[1]
  .replace(/<script\b[^>]*type=["']module["'][\s\S]*?<\/script>/gi, '');
const headStyles = (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n');
// root-absolute asset refs in inline CSS must be rebased onto the live deploy
const rebase = (css) => css.replace(/url\((['"]?)\/(?!\/)/g, (m, q) => `url(${q}${ASSET_BASE}`);

const payload = {
  entry: '~src/main.ts',
  body: bodyInner,
  css: rebase(headStyles.replace(/<\/?style[^>]*>/gi, '')),
  modules,
  imports: {
    three: 'http://127.0.0.1:8802/vendor/three/build/three.module.js',
    'three/examples/jsm/': 'http://127.0.0.1:8802/vendor/three/examples/jsm/',
  },
};
writeFileSync(new URL('./console/payload.json', import.meta.url), JSON.stringify(payload));
const outBytes = Object.values(modules).reduce((a, s) => a + s.length, 0);
console.log(JSON.stringify({
  files: vfs.size, transpiled: Object.keys(modules).length, failures,
  unresolvedCount: unresolved.length, unresolvedSample: unresolved.slice(0, 8),
  inKB: (bytesIn/1024)|0, outKB: (outBytes/1024)|0, ms: Math.round(ms),
}, null, 2));
