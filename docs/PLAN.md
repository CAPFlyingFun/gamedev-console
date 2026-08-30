# Running and editing a TypeScript game from a phone

## The decision

**Neither adopt an engine nor write one.**

Two mature three.js codebases already exist — Thronemound (164 TypeScript
files) and TRADDOMIUM (105) — and both are live, device-tested products. The
thing that does not exist is a way to *run* them without Node, npm and Vite.
That gap is a module loader and a second origin, not an engine.

Adopting Phaser, Kaplay or PlayCanvas would orphan roughly 113k lines to gain
nothing that is missing. Writing an engine core is a multi-year project
already started twice. What is missing is ~400 lines.

The "engine" that new games start from is a **template repository** the console
clones — never code the console contains.

## Why not "just use import maps, no build"

Because there are **675 relative imports across the two repos and not one has a
file extension** (403 Thronemound + 272 TRADDOMIUM, verified by count). Native
ESM will never resolve `from '../world/coords'`. A genuinely no-build path
means rewriting 675 imports in two shipped games.

What works instead is a resolver that probes extensions against an in-memory
file map, and it is unambiguous for these repos: **zero `index.ts` files and
zero stray `.js` files** under either `src/`, so `x.ts → x.tsx → x.js →
x/index.ts` has exactly one answer every time.

## Why sucrase, and not esbuild-wasm

The console is itself built by Vite in CI, so the transpiler is an ordinary
bundled dependency — no `init()`, no WebAssembly, no multi-megabyte runtime
download. Measured on the real source: **105/105 TRADDOMIUM files in ~255 ms,
zero failures.**

Rejected, with reasons: `esbuild-wasm` (3.55 MiB gz, plus an unfixed WebKit
failure on repeat transforms in a Safari worker); `@swc/wasm-web` (4.83 MiB
gz); the TypeScript compiler (1.56 MiB gz plus ~3.6 MB of `lib.*.d.ts`, and
type-checking belongs in CI); WebContainers (needs COOP/COEP headers, which
Pages cannot set); `isomorphic-git` (github.com's git-http endpoints send no
CORS, so it needs a server).

## The shape

```
  CONSOLE  capflyingfun.github.io/gamedev-console/   existing repo
     |      holds the PAT and the model keys.
     |      editor, VFS, git, chat, tune, diff.
     |      postMessage: one transferable ArrayBuffer of transpiled sources
     v
  RUNNER   <org>.github.io/run/                      new, ~200 lines
     |      DIFFERENT ORIGIN, so it cannot read the console's keys.
     |      mints its own blobs, injects one import map, imports the entry.
     |      vendors three 0.180.x — no CDN in the hot path.
     v
  ASSETS   capflyingfun.github.io/<game>/            the game's own live deploy
```

See [`spike/README.md`](../spike/README.md) for the working proof of the middle
box, and for why the two origins are not negotiable.

## Milestones

Each one ends in something openable on a phone.

### M0 — Stop the bleeding (one evening)

Four fixes to `index.html` as it stands, no refactor. Worth doing regardless of
whether anything below happens, because two of them lose data:

1. **`replaceEditor` is called at line 1211 and defined nowhere** — only
   `insertToEditor` exists (line 659). REPLACE FILE has thrown a
   ReferenceError on every click since it shipped, and the failure mode it was
   added to prevent is committing a whole-file rewrite pasted *inside* the file
   it was meant to replace.
2. **`decodeB64UTF8` never checks `data.encoding`** (line 1098). Over 1 MB the
   contents API returns `content:""` with `encoding:"none"`; `atob('')` yields
   an empty document — but line 1099 still captures a *valid* sha, so Push
   Commit then writes emptiness over the real file. There are 22 such files
   across the two game repos. Route reads through `GET /git/blobs/{sha}` and
   refuse anything non-base64.
3. **Binaries are `TextDecoder`d into mojibake** and committed back as
   replacement characters. Classify by extension, hold as `Uint8Array`, never
   open them in the editor.
4. `currentFile.isNew = false` at 1141 precedes `if (currentFile.isNew)` at
   1145, so the file list never refreshes after a new file. Also URI-encode
   paths — `#`, `?` and `+` break today.

### M1 — Make it a phone app (about a week of evenings)

Delete the dead weight: `artifacts/gamedev-console/src/` (63 React files that
`index.html` never imports), `artifacts/api-server/` (a server that cannot
exist on Pages), `lib/*`, `scripts/`, the Replit config, and ~55 dependencies.
Repoint `tsconfig.json`'s `include`, which currently points at the dead React
app — so `typecheck` has never once looked at the module that actually ships.

Then the shell. Measured on the current build at 390x844: every interactive
control is **28 px tall** (`+ New` is 17), against a 44 px minimum, and the
page is **1160 px against an 844 px viewport**, so the editor sits below a
screen and a half of setup chrome.

- five bottom tabs (Files · Edit · Run · Tune · Chat), full-screen panels
  rather than split panes
- 44 px targets, 16 px inputs, and drop `maximum-scale=1` — it exists only to
  suppress the iOS focus-zoom that the 12 px input rule causes
- action bar pinned by a `--kb` property driven by `visualViewport`
  resize+scroll (WebKit does not support `interactive-widget`, so this is the
  only working fix). Reuse TRADDOMIUM's `src/ui/viewportFit.ts` — 93 lines,
  zero imports, and its `SETTLE_FRAMES`/`NOISE_PX` constants exist because iOS
  fires `visualViewport` events throughout the toolbar animation.
- `EditorView.lineWrapping` (missing today — long lines scroll sideways in a
  390 px column), and `javascript({typescript:true, jsx:true})`, because every
  `.ts` file currently gets plain-JS highlighting
- filenames truncated from the **left**: `src/scenes/antKinds.ts` renders today
  as `src/scenes/antKind…`, cutting off the only part being scanned for
- a visible `×` instead of `opacity:0` + `:hover` — there is no hover on a phone

### M2 — VFS and one atomic multi-file commit (about a week)

`Map<path, {text|bytes, sha, dirty}>` replacing the single `currentFile`.
Tree listing with a **visible banner** on `truncated` (today a `console.warn`,
so a partially-listed repo looks identical to a complete one), blobs by sha at
8-way concurrency, IndexedDB cache keyed by sha — blob shas are immutable, so a
warm reopen fetches only what changed.

Commit via the Git Data API: blobs → tree with `base_tree` → commit → `PATCH`
the ref. ~70 lines, one atomic commit for N files. **The console physically
cannot commit more than one file at a time today**, which is why every
multi-file AI answer is currently unshippable.

### M3 — The runner origin and the loader (three to four weeks) ★

The real work, and the proven part. Create the free org and its
`<org>.github.io` Pages site, deploy the runner bootstrap plus vendored
three 0.180.4, and build `resolve.ts` / `transpile.ts` / `link.ts` /
`preview.ts` / `project.ts` in the console.

**Target TRADDOMIUM first** — it has zero CSS imports, so it needs the fewest
shims to prove the mechanism. Thronemound's 12 CSS imports and 40
root-absolute `url()` refs come after.

*Proof:* open TRADDOMIUM on the phone, tap RUN, and the island renders with the
virtual stick working — code straight from the editor, assets streaming from
the live deploy. Change a constant in `FollowCamera.ts`, tap RUN, see the
camera move.

### M4 — Create from scratch (under a week)

Build `capflyingfun/tsge-starter-3d` by hand and mark it a template repository.
`src/engine/` is ~1,400 lines of which ~1,300 is **copied verbatim** from the
existing games — TRADDOMIUM's `src/input/{MoveStick, LookDrag, ActionPad,
autoRun}` and `viewportFit`, Thronemound's `contextGuard`, `playerIntent`,
`devicePrefs`. New: `app.ts`, `loop.ts`, `params.ts`.

Copies, never a shared package: both games are live, and a shared dependency
means a starter bug can take down two shipped products at once. The duplication
is ~1,300 lines and that is cheap.

**Keep every comment during the copy.** `contextGuard.ts` and `pwa.ts` are each
~100 lines wrapped around a recorded device bug, the measurement that found it,
and the wrong fix tried first. Tidying that away is how the bug comes back in a
year with no record it was ever solved.

Then `POST /repos/{template}/generate` — one call creates a repo with its Pages
workflow already in it.

### M5 — Tune and Diff (two to three weeks)

`defineParams()` returning a live proxy, and a typed inspector protocol
(`hello / params / setParam / pause / step / capture / log / error`) — one
versioned door replacing `window.__island`'s 450 untyped lines.

The Tune tab renders 44 px sliders and enum chips; dragging mutates the proxy
in place, no reload. **Bake** rewrites the literal in the `.ts` by key path (not
by a byte offset captured at module-eval, which goes stale) and stages it.

This is the highest-value phone feature: most of what anyone wants to change on
a phone is a number, and this is the whole interaction for it, with zero
characters typed. Thronemound's `devicePrefs.ts` already has exactly the
defaults/range/sanitize shape the schema needs.

## The risks worth writing down

- **Safari ITP deletes all script-writable storage for an origin at once** —
  `localStorage`, IndexedDB, Cache API and the service-worker registration
  together — after seven days without interaction, unless the site is installed
  to the Home Screen. That is the PAT, both model keys, the sha cache and any
  unpushed work, vanishing simultaneously, and it presents as a random logout
  rather than as data loss. GitHub is the only real storage in this design, and
  the UI must make unpushed work visibly alarming.
- **The token is more powerful than it looks.** Repo creation needs
  `Administration: write`, which is not per-repository, so the console's token
  must be scoped to all repositories. The cross-origin runner is the entire
  mitigation.
- **Memory is the most likely thing to force a redesign.** Measure it on device
  before building a shell around one answer; if an iframe will not hold it, the
  preview becomes a separate top-level tab and the shell design changes.
- **Scope drift into "a game engine."** If `src/engine/` grows past the eight
  harvested files before M4 ships, this project has failed in the specific way
  it was designed to prevent.
- **Realistically two to three months of evenings**, not a few weekends. M0 is
  one evening and fixes live data loss — it is worth doing this week either way.
