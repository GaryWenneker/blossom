# Evidence: artist create dialog and photo focus

Tier 2. Spec approval: obtained (user: "approved.").
Spec: `/Users/gary/io/blossom/docs/specs/artist-create-dialog-and-photo-focus.md`
Isolation: this working tree. No checkpoint commits. No new dependencies.
Source state: git `7967d76` plus uncommitted work. Other dirty files in this tree (countries, artist edit, seed, domain, storage, Suno, viewport tests) were not part of this change and were not reverted.
Node: v26.8.2. Command: `node --test` from `/Users/gary/io/blossom`.

## What changed after approval

The admin Content-Security-Policy is `style-src 'self'` (`src/server.mjs`). A `style="object-position:…"` attribute is left in the DOM and ignored, so the banner stayed at the stylesheet crop `center 35%`. Saved points are now `data-focus-x` / `data-focus-y` on `data-photo-focus` images. After each render, `applyPhotoFocus` sets `element.style.objectPosition`. That CSSOM write is applied. The focus dialog already set the preview the same way.

## Spec mapping

| Behavior | Test |
|---|---|
| Drag down 100px in a 1600×900 frame over an 800×1200 photo at 50/35 yields 50/28 | `Dragging down inside a portrait crop moves the focus toward the top` |
| Drags past the edges clamp to 0 or 100 | `A drag past either edge clamps the focus to 0 or 100` |
| Zero slack leaves that axis unchanged | `A drag does nothing when the photo already fills that axis` |
| Linked studio photo uses the saved point; missing point is 50/35 | `A studio asset uses the linked artist photo focus, otherwise 50/35` |
| New photo and selected banner default to 50/35; a second save keeps the point; selecting updates the banner | `A new photo starts at focus 50/35 and a saved point is returned with the banner` |
| A table created before the columns reads back 50/35 | `An artist photo table from before focus columns gains the default crop` |
| POST focus returns the photo list; 20.5 is 400; wrong artist is 404; banners include the point; scripts require a session | `Focus endpoint saves one photo and rejects a bad point or the wrong artist` |
| Create artist is a button; the form is inside the dialog; each photo has Set focus; markup does not use a style attribute | `Artists page opens create in a dialog and offers a focus control per photo` |
| Studio preview carries the linked point as data attributes, not a style attribute | `Studio artist preview uses the linked photo focus` |
| Valid 20/15 is painted; a missing point is 50/35; 101 and 20.5 fall back to 50/35 | `Saved focus is painted with the CSSOM so the crop is not dropped` |
| Dialog CSS and the render call `applyPhotoFocus(view)` | `Focus preview dialog can be dragged and is styled as a crop frame` |

Negative constraints: album covers are not given `data-photo-focus`. Removing a gallery photo still uses the existing delete route. No package was added. Public MCP and OAuth routes were not changed.

## Gauntlet

| Layer | Result |
|---|---|
| Full suite | `node --test` — 273 pass, 0 fail, 6130.807959 ms. This run is after the last edit, including mutant restore. |
| Syntax | `node --check` exit 0 on `public/artist-focus.js`, `public/artists.js`, `public/studio.js`, `public/app.js`, `src/studio.mjs`, `src/studio-api.mjs`, `src/server.mjs` |
| Types | Skipped. These files are plain JavaScript. No typecheck script applies to them. |
| Lint | Skipped. No ESLint (or other linter) is configured for these files. |
| Coverage | Skipped. No coverage tool is configured, so there is no fail-under gate to run. |
| Mutation | Manual. No mutmut/Stryker in the project. See below. |
| Property tests | Skipped. No fast-check dependency. The spec's drag case is one concrete example, and that example is a test. |
| Real execution | Browser on a throwaway server at `http://127.0.0.1:8796` (memory database). Server stopped afterward. Port 8796 is closed. |
| Supply chain | No dependency change. |
| Suite order | Skipped randomized order. `node --test` has no random-order flag in this run. One clean pass. |

### Mutants killed, then restored

- Drop the 0–100 ceiling in `percentAttribute`. The CSSOM test failed: actual `101% 35%`, expected `50% 35%`.
- Remove `applyPhotoFocus(view)` from `render`. The crop-frame test failed: `app.js` no longer matched `applyPhotoFocus(view)`.
- Earlier in this same task, before the context break, these were killed and the files restored: skip the photo-owner check inside `setArtistImageFocus`; default focus Y of 50; drop the drag clamp; banner query omitting focus; create form rendered outside the dialog.

A negative control was the live page before this fix: the hero attribute was `object-position:50% 27%` and `getComputedStyle` was still `50% 35%`. After the CSSOM paint, both the hero and the gallery thumb computed `50% 27%`.

## Browser

Throwaway admin, user `admin`, artist Evan Mercer, one uploaded portrait.

- Create artist opened the dialog (name field, close, submit). Close left the roster at one artist.
- Set focus opened the crop. A pointer drag moved the unsaved point from 35 to 27. Cancel left the hero at `50% 35%` and the button at `data-focus-y="35"`.
- Save posted the point, closed the dialog, and the toast was `Photo focus saved`. Banners and images both returned `focusX: 50`, `focusY: 27`.
- After a real reload, hero and thumb computed `object-position: 50% 27%`. The focus dialog preview computed the same value. The wide preview showed the light top of the portrait inside the banner.

The user's Blossom on port 8787 was not restarted. Restart it so the new scripts load and `StudioStore` adds `focus_x` / `focus_y` to the existing database. Until that restart, the running process still has the old page.

## Review rounds

| Round | Skills | Findings | Fixed |
|---|---|---|---|
| 1 | `old-coder` usable, `old-coder-api` usable, `javascript-review` missing | 1 minor: `percentAttribute` rejected values outside 0–100 and non-integers with no test (`public/artist-focus.js`) | R1-1, assertion for `101` and `20.5` |
| 2 | same | 0 | — |

API review of `POST /api/studio/artists/{artistId}/images/{imageId}/focus`: internal, existing HTTP RPC style, additive `focusX`/`focusY`. Same session and origin check as select/delete. Wrong artist is 404. Setting an absolute point is idempotent. No breaking change. No API finding.

No frontend bundle. The admin page loads these scripts directly. Production build does not apply.

## Known limits

The string check that `render` calls `applyPhotoFocus(view)` fails if that call is deleted. It does not execute the browser. The browser check above is the execution evidence, and it is not re-run by `node --test`.

## Drag follow-up

The preview image was a native drag source, so the browser took the gesture, and each move snapped to a whole percent. The preview now follows the pointer in fractions. Releasing the pointer stores the rounded integer. The same 100px portrait case still saves focus Y 28.

`node --test` after this edit: 281 pass, 0 fail. In the browser, a 4px drag moved 35% to 34.5077%, and a 120px drag released at 20%. The face sat in the banner. Cancel did not save.
