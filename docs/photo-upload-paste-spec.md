# Photo upload and paste

Tier 2. Isolation: the current checkout, because the browser test and the local server read this tree.
Spec approval: not obtained (autonomous run).

## Behaviors

1. A PNG, JPEG, or WebP file can be chosen or pasted on the artist photo dialog, on an open album, and on Studio step 4.
2. Bytes are sniffed. The declared content type must match. `image/jpg` is JPEG. GIF and other types are rejected.
3. Album covers must be square, from 1 to 12000 pixels, and at most 20 MB. JPEG and WebP covers are stored, not only PNG.
4. An artist-dialog upload is added to that artist's gallery and does not replace the current hero when one is already selected.
5. A Studio upload of album art or an artist photo becomes the selected image for that role. The artist photo is also the artist's hero.
6. Paste goes to the open artist dialog first. On Studio step 4, a paste in the artist prompt is the artist photo and any other paste is the album cover. On an open release, a paste outside a text field replaces the cover.
7. Text paste into a field still inserts text. Names and listener counts are not drawn into the image.

## Must not

- Album covers and artist photos stay separate libraries.
- Generating a new variant still does not silently replace a selected Studio image. Only an explicit upload or paste selects it.
- No new dependency and no new authentication scheme. The existing session and `X-Blossom-Request: ui` stay required.
