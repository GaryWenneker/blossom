# Suno album cover

Spec approval: not obtained (autonomous run). Isolation: the running Studio tree, because the next Generate click has to load this code.

## Behavior

- When Generate in Suno runs in Safari, and the project has a selected asset of kind `cover`, Blossom attaches that PNG to the new Suno clip.
- The file is the selected album cover only. An artist photo or banner is never sent.
- Suno's create form has no image field. After Create song, the handoff opens More options, Manage, Song Details on a clip that was not on the page before Create, and chooses the PNG through Safari's file dialog.
- A clip that was already on the page is not opened, even when its title matches.
- If Song Details does not appear, Create still counts as submitted and the note says the cover was not attached.
- If no album cover is selected, generation continues and the note says Suno kept its own image.
- No private Suno request, no cookie copy, and no Google sign-in click.

## Setup

No new dependencies. Files: `src/suno-system-browser.mjs`, `scripts/suno-safari-create.applescript`, `src/studio-api.mjs`, `test/suno-system-browser.test.mjs`.
