# Automatic Suno cover and MP3 import

Spec approval: not obtained (autonomous run). Isolation: the current working tree, because Studio and the ignored local database are what the Import button uses.

Tier 2.

## Behavior

- Import selected Suno MP3, in normal Safari, places the selected track art (or album cover) on each finished clip with that exact title, then downloads each MP3. Songs already on the page are included.
- Success requires at least one new file under the home folder that is a real MP3 (ID3 or frame sync, stable size, not a symlink). Zero files is an error. The message does not tell the operator to use Suno's Download menu.
- When the cover dialog never accepts the image, Blossom still downloads the MP3 and reports the cover as missing.
- After Generate, the same rule applies: a harvest with no MP3 is an error, not a finished import of zero songs.
- No cookie copy, no Google sign-in click, and no private Suno API.

## Does not change

- The official Suno Platform API path.
- Artist banners and the public gateway allowlist.

## Setup

No new dependencies. No checkpoint commits.
Files: `src/suno-system-browser.mjs`, `scripts/suno-safari-create.applescript`, `src/studio-api.mjs`, `public/studio.js`, `test/suno-system-browser.test.mjs`.
