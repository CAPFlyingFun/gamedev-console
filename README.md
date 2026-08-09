# GameDev Console

A developer cockpit that puts two AI models side by side against the same prompt,
lets you edit what comes back, and pushes the result straight to a repository.

**Live: https://capflyingfun.github.io/gamedev-console/**

Ask a question once and it goes to OpenAI and Claude in parallel; a third pass
synthesizes their answers. Load any repository you have access to, open a file in
the editor, preview an HTML game in a sandboxed frame, and commit — all from the
one page.

## There is no server

The whole app is a single static page. Nothing you type is proxied through
anything: the browser talks directly to `api.openai.com`, `api.anthropic.com` and
`api.github.com`.

That has one consequence worth understanding. **Your API keys are stored in the
browser's `localStorage`**, on the machine that entered them, and are sent only to
the API each one belongs to. They are not in this repository and never travel
through a backend, because there isn't one. But `localStorage` is shared across
everything on `capflyingfun.github.io`, so don't host code you don't trust on that
domain. Use the *Clear* buttons to remove a key, and prefer GitHub tokens scoped
to just the repositories you intend to edit.

## Layout

The entire application is one file — `artifacts/gamedev-console/index.html` — with
its CSS embedded and its logic in an inline ES module. The React scaffold under
`src/` is left over from the project template and unused. The only separate piece
is `public/sw.js`, because a service worker cannot be inlined.

## Building it

It needs a bundler only because the editor is imported by package name:

```sh
pnpm install
PORT=5173 BASE_PATH=/gamedev-console/ pnpm --filter @workspace/gamedev-console run build
```

`BASE_PATH` must match the URL path the app will be served from — Vite writes the
asset URLs into `index.html` at build time, so getting it wrong yields a page that
works locally and 404s everywhere else. `PORT` is required by `vite.config.ts`
even for a build that never starts a server.

## Deploying it

Pushing to `main` is the whole process. `.github/workflows/deploy-console.yml`
builds the app, checks the base path actually landed in the output, and publishes
it to GitHub Pages. Nothing generated is committed to this repository.
