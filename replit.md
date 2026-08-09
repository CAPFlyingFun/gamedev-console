# GameDev Console

A fully client-side single-page PWA for prompting multiple AI agents (OpenAI + Claude + a Master synthesizer), browsing/editing GitHub repo files in a CodeMirror editor, previewing HTML games in a sandboxed iframe, and pushing commits back to GitHub — no backend.

## Architecture notes

- Entire app lives in `artifacts/gamedev-console/index.html` (embedded CSS + inline ES module script; user-mandated single-file constraint). The React scaffold in `src/` is unused.
- Service worker is a separate file `artifacts/gamedev-console/public/sw.js` (browsers can't inline SWs); manifest + icon are inline data URIs. SW is cache-first for the app shell, network-only for api.openai.com / api.anthropic.com / api.github.com.
- API keys (openaiKey, claudeKey, githubToken) live only in localStorage; never hard-coded.
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

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
