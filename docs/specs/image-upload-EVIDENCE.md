# Evidence: image upload for banners, track art, and album art

Spec: `/Users/gary/io/blossom/docs/specs/image-upload.md`
Spec approval: not obtained (direct implementation request). Tier 2.

## Mapping

| Behavior | Test |
|---|---|
| PNG and JPEG only, 12MB cap, signature must match the type | `uploaded images must be a real PNG or JPEG within 12MB` |
| Banner, album art, and track art stay in separate slots; a later upload does not replace the selected image; a project without an artist cannot take a banner; linked tracks expose both art URLs | `banner, track art, and album art uploads stay in their own slots` |
| The three upload controls are in the screens, and the browser can load `image-upload.js` | `the screens offer an upload for each image` plus the script assertion in the HTTP test |
| Requests without the UI header stay forbidden | same HTTP test, status 403 |

## Gauntlet

Command: `node --test` in `/Users/gary/io/blossom` after the last edit.
Result: 315 pass, 0 fail, duration 6816 ms.
Node: the suite runner is `node --test` from `package.json`. No TypeScript project, so no `tsc`. No project linter is configured, so lint was `node --check` on the edited scripts, exit 0.
Changed-line coverage: no `diff-cover` tool in the repo. The new upload routes, validators, and static script route are executed by `test/image-upload.test.mjs`.
Mutation: no mutmut/Stryker. Three hand edits were killed by `node --test --test-name-pattern` and restored: accepting a non-image as JPEG; always replacing the selected banner; always selecting a newly uploaded project image.
Property tests: skipped. No fast-check dependency. The size and signature cases are concrete examples in the test.
Supply chain: no new dependencies.
Suite order: one clean `node --test` pass. `node --test` has no random-order flag.

## Browser

Throwaway server on `127.0.0.1:8795` with an in-memory database, then stopped.
Signed in, opened Artists, and uploaded a PNG through the Upload banner control. The toast was `Artist banner uploaded and shown` and the hero image URL was an artist-image content route.
Opened News to Song, saved a project for Blue Meadow Quartet, and uploaded album art and track art. Both previews rendered, and the toast was `Track art uploaded`.

## Review

| Round | Finding | Fixed |
|---|---|---|
| 1 | `image-upload.js` was not on the local static file map, so the app stayed on "Loading your label..." | Added `/image-upload.js` and confirmed the script loads with status 200 |

## Known limits

Image width and height are not checked. A square JPEG can be stored as a banner, and a wide PNG can be stored as album or track art.
GIF and WebP are rejected.
Track art and album art on the Tracks page appear after the song is linked from News to Song. Both can be uploaded on the song in News to Song before that link exists.
Restart the Blossom server that is already running so it loads these routes.
