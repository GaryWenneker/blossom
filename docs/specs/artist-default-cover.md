# Artist default album cover

Status: direct bugfix request on 2026-10-24. Spec approval was not a separate reply.

Tier: 2.

## Why

On No Name on the Receipt, the selected album cover is an older ChatGPT image for Evan Mercer. Later Norrlight uploads, including the sleeve titled No Name on the Receipt, are stored with `selected=0`. The artwork panel shows the selected cover, so the other artist's image stays.

Album covers are square artwork. They stay separate from the wide artist banner.

## Behavior

- `POST /api/studio/projects/:id/upload-image/cover` selects the new cover and clears the previous cover selection on that project. The previous file stays in the project library.
- `POST /api/studio/projects/:id/generate-art` with `kind: "cover"` does the same.
- The new cover records the project's artist id. A project with no artist records an empty artist id.
- Selecting a cover that already belongs to a different artist returns 409 and does not change selection.
- The Studio album preview shows the project's selected cover only when that cover belongs to the assigned artist, or when the project has no artist. Otherwise it shows that artist's default cover: the newest selected cover recorded for that artist. If the artist has none, the preview is empty.
- `GET /api/studio/artists/covers` returns that default per artist as `{ assetId, url, createdAt }`.
- Suno handoff uses the same cover: the project's matching selected cover, otherwise the artist's default file.
- On startup, for an artist who has no cover yet, the newest untagged cover on that artist's project becomes their cover and is selected. Older untagged covers are left unselected and untagged. This runs once per artist and does not retag a cover that already has an artist.

## Does not change

- A later artist-banner upload still does not replace the selected banner.
- A later track-art upload still does not replace the selected track art.
- Square covers are not copied into the artist banner library.
- Deleting a project image still does not delete an artist banner file.

## Setup

- Isolation: this working tree. The running app uses the ignored local database, which a fresh worktree would not have.
- No new packages. No checkpoint commits unless asked.
- Files: `src/studio.mjs`, `src/studio-api.mjs`, `src/suno-system-browser.mjs`, `public/studio.js`, `public/app.js`, `test/image-upload.test.mjs`, `docs/specs/image-upload.md`, this file.
- Tests: `node --test test/image-upload.test.mjs test/suno-system-browser.test.mjs`
