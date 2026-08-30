# The runner spike

This directory answers one question, and it is the question the whole
"edit a game on a phone" idea rests on:

> Can a TypeScript game with hundreds of extensionless relative imports be
> transpiled and run in a browser, on a phone, with no build step and no server?

**Yes.** This spike does it, end to end, with TRADDOMIUM's real 105-file
source tree. It is kept here because it is cheap to re-run and because the
next person to doubt the mechanism should be able to see it work in a minute
rather than re-derive it.

## What it proves

Run it and you get TRADDOMIUM's actual Kauaʻi start-picker rendering from
elevation data, with zero build step. Along the way it establishes:

- **Cross-origin `postMessage` handshake.** The console and the runner are
  different origins on purpose (see "Why two origins" below).
- **Blob URLs minted *inside* the runner** carry the runner's origin, so the
  frame can import them. Blobs minted by the *parent* into an opaque sandbox
  cannot be fetched at all — that is the trap this design exists to avoid.
- **A dynamically injected import map is honoured**, provided it is injected
  from a *classic* script before any module has loaded. A `type=module`
  bootstrap has already started a module graph and the map is ignored.
- **Cycles resolve.** Every internal specifier is rewritten to a bare
  `~path/to/file.ts` key. Bare keys have no scheme and no leading `./`, so the
  import map owns them completely and modules can be created in any order —
  no topological sort, which matters because a 164-file game certainly has
  cycles. `console/payload-cycle.json` is a deliberate a↔b cycle.
- **The transferable payload detaches** (`byteLength` becomes 0), so 1.2 MB of
  transpiled source is moved rather than structured-cloned.
- **Assets stream from the game's own live Pages deploy** over CORS, so no
  asset pipeline is needed and nothing large is downloaded to the phone.

## Why two origins

The console holds a GitHub PAT. Creating a repository needs
`Administration: write`, which is not a per-repository permission, so that
token must be scoped to *all* repositories. A token that powerful sits on a
page that also renders LLM-authored code.

The only real isolation from a powerful token is a **different origin**. The
runner therefore lives on its own origin and gets `allow-same-origin`
legitimately — which is also what lets `localStorage` and IndexedDB work
untouched for the game, and what gives the preview its own process (and so its
own memory budget) under site isolation.

**The preview never moves to the console origin**, whatever convenience asks
for it — not save games, not a devtools bridge, not an asset uploader.

## Running it

```sh
npm i sucrase three@0.180.0          # 0.180 is what both games pin
node link.mjs /path/to/TRADDOMIUM-Micro-Battle http://127.0.0.1:8804/
# vendor three onto the runner origin
cp -r node_modules/three/build node_modules/three/examples runner/vendor/three/
python3 -m http.server 8801 --directory console &   # the "console" origin
python3 -m http.server 8802 --directory runner &    # the "runner" origin
python3 cors-server.py &                            # assets, with CORS, as Pages sends
# open http://127.0.0.1:8801/
```

## What `link.mjs` actually does

1. **Reads a VFS** — the map of path → source the console would hold from a
   GitHub tree.
2. **Resolves specifiers by probing extensions** against that VFS:
   `x.ts`, `x.tsx`, `x.js`, `x/index.ts`, `x/index.js`, `x`. This is the answer
   to 675 extensionless relative imports across the two games, and it is
   unambiguous for them: neither repo has a single `index.ts` or a stray `.js`
   under `src/`, so exactly one candidate ever matches.
3. **Applies shims** for the things Vite would otherwise have done.
4. **Rewrites every internal specifier to a `~key`** and transpiles with
   sucrase.

### The shims, and the one that is easy to get wrong

- `import.meta.env.BASE_URL` → the **absolute** live-deploy URL. Do *not* read
  `base` from the repo's `vite.config.ts`: TRADDOMIUM sets `base: './'`, which
  inside the runner document would resolve every asset against the *runner*
  origin and 404.
- `import.meta.env.DEV` → `true`, which skips the service-worker registration
  that would otherwise try to register a cross-origin URL and reject.
- **Build defines must be applied AFTER transpiling, not before.** This is the
  one the design originally got backwards. `src/build.ts:10` is
  `declare const __APP_VERSION__: string;` — replacing the identifier *before*
  type-stripping produces `declare const "0.0.127": string;`, a syntax error.
  Sucrase deletes the ambient declaration outright, so after the transform only
  real value usages remain. Applied in the wrong order this fails 1 file in
  105; applied correctly, 0.
- **The game's `index.html` body is part of the game.** The entry does
  `document.getElementById('app')` and throws without it, so the runner
  reproduces the game's document (minus its `<script type=module>`) alongside
  the modules. Inline CSS gets root-absolute `url(/...)` refs rebased onto the
  asset base — a `<base href>` tag does not affect root-absolute URLs.

Anything outside this list must **fail with a named error**, never pass
through silently. `import.meta.glob`, `?url`/`?raw`/`?worker`, `new Worker(`,
`const enum`, `namespace` and wasm/JSON imports are all currently zero in both
games, so that guard is a tripwire rather than work — but a silent
pass-through is exactly the failure class of shipping a build that passed every
check against something the device was not running.

## Measured here

| | TRADDOMIUM | Thronemound |
|---|---|---|
| Files transpiled | 105 / 105 | 163 / 163 |
| Failures | 0 | 0 |
| Unresolved imports | 0 | 12 — all `.css`, exactly the set shim 4 covers |
| Source in → JS out | 1239 → 1164 KB | 3331 → 3196 KB |
| Transpile + link | ~255 ms | ~530 ms |

Desktop numbers; budget 2-4× on a phone, so call a cold open of Thronemound
1.5-2.5 s plus the GitHub blob fetches. The sha-keyed cache makes warm opens
nearly free, and a content-hash transpile cache makes a one-line edit
re-transpile one file.

Booting TRADDOMIUM end to end: 1.21 MB payload posted as a transferable,
~14 MB JS heap once running, 0 failed requests.

Thronemound's 12 unresolved specifiers are the useful result here: every one is
a side-effect `.css` import and there is nothing else outstanding, which is what
makes the CSS shim the only remaining work between this spike and the second
game.

## What is still unverified

This ran in **Chromium**. The three uncertain behaviours — dynamic import-map
injection, blob-module imports inside a cross-origin frame, and the
`postMessage` handshake — are all supported in Safari 16.4+ by spec, but they
have not been observed composing in one document on a real iPhone. That is a
30-minute test and it gates everything after it.

If it fails on iOS, the fallback is `data:text/javascript;base64,` module URLs
instead of blobs — they carry no origin check at all — at the cost of ~4.4 MB
of base64 inside the import map for Thronemound, which is workable but slower
and changes the memory story.

Memory is the other thing to measure on device, not here: TRADDOMIUM streams
33 MB of Kauaʻi tiles, and an iPhone SE kills a page at roughly 100 MB. Site
isolation should give the runner its own budget, which is the strongest
argument for the separate origin beyond security — but measure it before
building a shell around one answer.
