# Evidence: photo upload and paste

Spec: `/Users/gary/io/blossom/docs/photo-upload-paste-spec.md`
Spec approval: not obtained (autonomous run). Confidence is lower because the same author wrote the spec and the code.
Source: git HEAD `3f1f481` plus the uncommitted photo-upload diff. Unrelated dirty files were left untouched.
Node: v26.8.2. No new dependencies.

## Behavior map

| Behavior | Check |
|---|---|
| 1. Upload and paste on the artist dialog and album page | `test/discography-browser.test.mjs` runtime test: file input adds a gallery photo; a synthetic paste adds another; a paste on the album title replaces `cover_filename` |
| 2. PNG, JPEG, WebP, `image/jpg`, GIF rejected | `test/uploaded-image.test.mjs` sniff and clipboard tests; studio upload with `image/jpg` returns `image/jpeg` |
| 3. Square album JPEG accepted, wide JPEG rejected | same file, album cover requests return 200 then 400 |
| 4. Second gallery photo does not replace the hero | same file, `selected` stays on the first image |
| 5. Studio upload selects the new cover and artist photo | same file, both responses have `selected: true` and the hero `sourceAssetId` matches |
| 6. Paste routing | browser test for the dialog and the album page. Studio paste uses the same `clipboardImage` and `postImage` helpers; the Studio buttons were not clicked in the browser |
| 7. Text fields are skipped; images are not composited with names | album paste is ignored for `input`, `textarea`, and `select`. No pixel text is drawn |

## Gauntlet

Final run after the last code and test edit:

- `node --test`: 350 pass, 0 fail, duration_ms 7782.316375
- `npm run check`: exit 0 (Node syntax check, including `src/uploaded-image.mjs`, `public/image-paste.js`, and `test/uploaded-image.test.mjs`)
- `node scripts/photo-upload-mutants.mjs`: killed 6/6, exit 0. Mutants: JPEG cover filename rejected again; album cover square check removed; second artist photo replaces the hero; GIF accepted from the clipboard; `image/jpg` not normalized; Studio upload does not select
- `node scripts/photo-upload-mutants.mjs --control`: SURVIVED no-op, exit 1
- Broken control with the survivor exit removed: exit 0. The exit code is the gate. The broken script still printed `killed 1/1`

## Skipped

- Coverage fail-under: this repo has no diff-cover gate. Not reported as a pass.
- Separate linter and typechecker: the project gate is `npm run check`.
- Property tests: dimensions are checked with concrete PNG, JPEG, and WebP fixtures.
- Randomized suite order: not run.
- Bundled production build: Studio is served as static modules. The browser test loaded those modules. No bundler step exists for this app.
- Supply chain: no dependency was added.

## Review rounds

| Round | Skills | Findings | Fixed |
|---|---|---|---|
| 1 | old-coder usable, old-coder-api applicable (existing session plus `X-Blossom-Request: ui`; cover types loosened and sniffed), javascript-review missing | 0 | — |

Known limit: Studio step 4 upload and paste were not clicked in the browser. The HTTP upload for both roles passed, and the shared paste helper passed on the artist dialog and the album page.
