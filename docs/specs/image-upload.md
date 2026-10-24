# SPEC — Upload artist banners, track art, and album art

Status: spec approval not obtained (direct implementation request). Tier 2.

## Behavior

- An authenticated local admin can upload a PNG or JPEG of at most 12MB.
- `POST /api/studio/artists/:id/upload-banner` stores an artist-owned banner. The first banner becomes the selected hero. A later upload stays in the gallery and leaves the selected hero in place.
- `POST /api/studio/projects/:id/upload-image/cover` stores album art on that song project.
- `POST /api/studio/projects/:id/upload-image/track-art` stores track art on that song project, separate from album art.
- `POST /api/studio/projects/:id/upload-image/artist-photo` stores a banner on the project and links it to the project's artist. It is rejected with 409 when the project has no artist. It does not replace an already selected artist banner unless no banner is selected yet.
- The first image of a kind on a project becomes the selected image of that kind. A later track-art or artist-banner upload does not replace that selection. A later album-cover upload does replace the selected cover. See `docs/specs/artist-default-cover.md`.
- Bytes that do not match the declared `image/png` or `image/jpeg` type are rejected. Other content types are rejected. The file name is a generated id, not the browser's name.
- `GET /api/studio/artwork` maps each catalog track that is linked to a song project to that project's id and selected track-art and album-art URLs, so the track list can upload before any image exists.
- News to Song shows Upload album art, Upload track art, and Upload artist banner. Artists shows Upload banner. A linked track row shows Track art and Album art uploads.

## Does not change

- ChatGPT image generation, Suno audio upload, and the public gateway allowlist.
- Square album covers are not copied into the artist banner library.
- Deleting a project image still does not delete an independently owned artist banner file.
- Requests without the UI protection header stay forbidden. Unauthenticated API calls stay unauthorized.

## Setup

- Isolation: the current working tree. A fresh worktree would not contain the ignored local database the running app uses, and this change is the app the user opens.
- No new dependencies. No checkpoint commits unless asked.
- Files: `src/image-bytes.mjs`, `src/studio.mjs`, `src/studio-api.mjs`, `src/suno-system-browser.mjs`, `public/image-upload.js`, `public/studio.js`, `public/artists.js`, `public/app.js`, `public/studio.css`, `test/image-upload.test.mjs`, this spec, and one sentence in `docs/OPERATIONS.md`.
