# Regression tests

These drive the **built** console in a real browser with `api.github.com`
intercepted, because the bugs they cover were all in the seam between the app
and that API — a unit test with a hand-made fixture would have reproduced none
of them.

Two of the four destroy files, so they are worth keeping honest:

- **A file over 1 MB read as empty, then committed.** The contents API answers
  200 with a valid sha and `content:""`, `encoding:"none"`. `atob('')` is `''`,
  so the editor showed an empty document for a healthy file and Push Commit
  wrote that back over it. Twenty-two files across the two game repos are over
  that line. Reads now go through `GET /git/blobs/{sha}`, which carries content
  to 100 MB, and anything not base64 is refused.
- **Binaries decoded as UTF-8.** A 6 MB normal map is one tap from the editor;
  as text it becomes replacement characters and committing it destroys the
  asset. Refused by extension, by size, and by a null-byte check for anything
  that lies about its extension.
- **`replaceEditor` was called and never defined**, so REPLACE FILE threw on
  every click — leaving the exact trap it exists to prevent (a whole-file
  rewrite pasted *inside* the file) as the only available action.
- **`isNew` was cleared one line before it was read**, so the file list never
  refreshed after creating a file.

A refusal must also *disarm the commit path*, not merely warn: `pushAfterRefusal`
asserts zero PUTs. A warning that still let the push through would be the
original bug wearing a label.

## Running

```sh
npm i playwright-core
PORT=5173 BASE_PATH=/gamedev-console/ pnpm --filter @workspace/gamedev-console run build
# serve dist/public AT /gamedev-console/ — the built asset URLs are absolute,
# so serving it at the root 404s the bundle and the page silently renders
# as an inert HTML shell with none of its behaviour attached.
node test/console-github.mjs
```
