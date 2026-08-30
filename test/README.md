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

## console-shell.mjs

The phone shell: one panel at a time, 44px targets, the folds, and the
keyboard. It drives the same built page at 390x844, and finishes on a
1440x900 context asserting the desktop three-column layout is untouched —
the whole shell is inside one media query, and it would be easy to fix the
phone by breaking the desktop without noticing.

The keyboard case is the one worth understanding. iOS shrinks
`visualViewport` but leaves `window.innerHeight` alone, so `100dvh` stays
full-screen and the bottom of the app — tab bar, commit bar, Send — sits
underneath the keyboard. The test reproduces exactly that asymmetry by
redefining `visualViewport.height` and firing `resize`. It also asserts that
a 12px change moves nothing: iOS fires these continuously through the
toolbar animation, and reacting to every one makes the bar jitter on focus.

Against a pre-shell build the three layout assertions fail as they should,
then the run stops on an element that build does not have. That is expected
for feature tests; `console-github.mjs` is the suite that runs end to end
against both.

## Running

```sh
npm i playwright-core
PORT=5173 BASE_PATH=/gamedev-console/ pnpm --filter @workspace/gamedev-console run build
# serve dist/public AT /gamedev-console/ — the built asset URLs are absolute,
# so serving it at the root 404s the bundle and the page silently renders
# as an inert HTML shell with none of its behaviour attached.
node test/console-github.mjs
```
