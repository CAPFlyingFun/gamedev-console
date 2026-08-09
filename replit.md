# GameDev Console

A fully client-side single-page PWA for prompting multiple AI agents (OpenAI + Claude + a Master synthesizer), browsing/editing GitHub repo files in a CodeMirror editor, previewing HTML games in a sandboxed iframe, and pushing commits back to GitHub — no backend.

## Architecture notes

- Entire app lives in `artifacts/gamedev-console/index.html` (embedded CSS + inline ES module script; user-mandated single-file constraint). The React scaffold in `src/` is unused.
- Service worker is a separate file `artifacts/gamedev-console/public/sw.js` (browsers can't inline SWs); manifest + icon are inline data URIs. It derives its paths from its own scope rather than assuming the site root, because the app is served from `/gamedev-console/`. The app shell is network-first with the cache as the offline fallback; content-hashed bundles under `assets/` are cache-first, since their names change every build and a cached one cannot be stale. api.openai.com / api.anthropic.com / api.github.com are never intercepted.
- API keys (`openaiKey`, `claudeKey`, `githubKey`) live only in localStorage; never hard-coded.
- The prompt runs a three-stage pipeline, not a fan-out: both models write a PLAN in parallel, a master model merges them into one plan and names an assignee (`ASSIGNEE: claude|chatgpt|both`), and the assignee writes the code from that plan. The coder dropdown overrides the assignee; `auto` obeys it. The open file rides along as context, truncated at 60k characters with the cut announced.
- The master call inlines its role into the user turn rather than sending a system message, because OpenAI's reasoning models — the ones worth putting in that field — don't take the same system role as the chat models. No `max_tokens` goes to OpenAI at all, for the same reason (reasoning models want `max_completion_tokens`).
- The model fields are free text backed by datalists filled from each provider's own `/v1/models` (**Load models**), cached in `modelsOpenai` / `modelsClaude`. A list baked into the app is wrong twice: it goes stale as models ship and retire — the Claude field shipped defaulting to a model retired months earlier, so every call 404'd — and it cannot know which models a given key is entitled to. OpenAI's list is filtered to chat-completions models and sorted newest-first; Anthropic's is already all chat models.
- API failures come back as a JSON body, not an exception. `apiError()` pulls out `error.message` and adds a plain sentence for the codes that get misread — above all `insufficient_quota`, where a saved payment method makes billing look configured but OpenAI spends from a prepaid credit balance. Rendering the raw body is what made that unreadable.
- **Browse** lists an owner's repositories to pick from; the repo field stays usable by hand. Which endpoint is correct depends on the owner, and the wrong one fails silently by omitting private repos: your own account must go through `/user/repos` (`affiliation=owner`), an organisation through `/orgs/{owner}/repos`, anyone else through `/users/{owner}/repos`. Nothing in a name distinguishes an org from a user, so the org route is tried first and a 404 means "not an org". Paged 100 at a time, capped at 5 pages. Picking a repo adopts its own `default_branch` rather than the prefilled `main`.
- The owner field self-fills from the token's login (cached in `githubLogin`), and that cache plus the repo list are dropped whenever the GitHub key is saved or cleared — a new token may be a different account.
- `recentRepos` in localStorage holds the last 8 successfully-opened `{owner, repo, branch}` triples, newest first. It backs both the click-to-reload list and the owner/name datalists, and is written only after a tree actually loads — remembering on click would fill it with typos and repos the token can't reach.
- The footer of the left panel shows `v<version> · <commit>`, substituted at build time by `vite.config.ts` (`__BUILD_STAMP__`). The version comes from the artifact's package.json and is bumped by hand; the commit comes from `GITHUB_SHA` (or local git) and cannot be forgotten, which is why the update check compares commits rather than versions.
- The build also emits `version.json` at the site root — **not** under `assets/`, whose filenames are content-hashed and cached hard. The app fetches it `no-store` on load, on window focus, and every 10 minutes; a differing commit reveals a reload button. A tab left open through a deploy would otherwise keep advertising a build that no longer exists.
- A finished pipeline stage folds up when the next begins, so the code card lands near the top instead of below a screen of plans already read. A FAILED stage is never folded — its message is why the run went the way it did. Headers toggle by click.
- Code blocks carry **REPLACE FILE** and **INSERT**. Insert alone is a trap on a whole-file answer: it pastes at the cursor, so a rewrite lands inside the file it was meant to replace. The buttons sit in a bar above the block, not floating over it — floated, they covered the first line and a long line just scrolled underneath.
- Model fields live behind a **Settings** disclosure (`settingsOpen`); the per-run controls (who codes, send-the-file) stay out. On a phone the model rows were most of the panel.
- A saved API key leaves its box **empty** with the state in the placeholder. The old eight asterisks were masked by the browser, and Inter has no glyph for the character iOS masks with, so Safari drew each as a last-resort box with its codepoint inside. Password inputs also get a system font stack for the same reason.
- That empty box then read as *no key stored* — the browser's default placeholder grey measured `rgb(117,117,117)` on a `rgb(9,9,11)` field, near-invisible on a phone, and the first report back was "why did the API keys disappear?". A stored key now turns the border and the placeholder the success green (`input.has-key`), so saved looks saved at arm's length; `::placeholder` also gets an explicit colour rather than the browser's. The text is short enough not to clip at phone width — the field is narrow and a placeholder does not ellipsise, it just cuts off mid-word.
- The mobile `@media (max-width: 1000px)` block must stay **last in the stylesheet**. It originally sat above the `.panel` rule, and since a media query adds no specificity, the later `height: 100dvh` won: every mobile override in it was dead code for its whole life. Each stacked panel stayed a viewport tall inside a 600px grid row, overran it by 65px, and dropped the editor's commit bar on top of the prompt box.
- On a phone the app is a **scrolling page**, not a fixed-height grid: `#app` goes `height: auto; min-height: 100dvh` and the body scrolls. Keeping `100dvh` while stacked makes the three rows compete for one screen — the auto rows collapse to ~150px and `.panel`'s `overflow: hidden` amputates the rest, Execute Prompt included. The editor row is the only one given a height (`minmax(240px, 55vh)`); 600px of mostly-empty editor was a full screen to scroll past before reaching the prompt box. `.file-list` gets a `45vh` cap because the panel no longer bounds it.
- CodeMirror 6 packages are installed as devDependencies and imported via bare imports in the inline module script (Vite resolves them).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The console's build needs **two** environment variables or it fails: `BASE_PATH`
  (Vite bakes asset URLs in at build time, and the app is served from a subpath,
  not the site root) and `PORT` (`vite.config.ts` throws without it even for a
  build that never starts a server). CI sets both — see
  `.github/workflows/deploy-console.yml`.
- Building with the wrong `BASE_PATH` produces a page that looks fine locally and
  404s every script once deployed. The workflow asserts the built `index.html`
  and bundle actually carry the expected path before it uploads anything.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
