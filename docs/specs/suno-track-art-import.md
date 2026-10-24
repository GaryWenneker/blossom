# Suno track art and both generated songs

Spec approval: not obtained (autonomous run). Isolation: the current working tree, because the running Studio server and the ignored local database are what Generate uses.

Tier 2.

## Behavior

- After Generate in Suno clicks Create, Blossom waits until the two new clips for that exact title are complete. Clips that were already on the page stay untouched.
- It then places the project's selected track art on each of those two clips through Safari's file window (More options, Manage, Song Details, Save). When no track art is selected, it uses the selected album cover. An artist banner is never sent.
- It downloads the MP3 for each of those two clips and stores both in the project. Both become catalog tracks for the same artist, and both show that project's track art and album art.
- A second harvest does not create a third track.
- An MP3 from outside the home folder, a symlink, or a file that is not an MP3 is not stored.
- No cookie copy, no Google sign-in click, and no private Suno API.

## Does not change

- The official Suno Platform API path.
- Artist banners and the public gateway allowlist.

## Setup

No new dependencies. No checkpoint commits.
Files: `src/suno-system-browser.mjs`, `scripts/suno-safari-create.applescript`, `src/studio.mjs`, `src/studio-api.mjs`, `public/studio.js`, `test/suno-system-browser.test.mjs`.
