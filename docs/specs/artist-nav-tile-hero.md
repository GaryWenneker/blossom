# Artist navigation, tiles, and header frame

Spec approval: not obtained (autonomous run).
Tier: 2. Isolation: current checkout, because the running local UI is what this change has to affect.

## Behaviors

1. Clicking Artists in the main navigation clears any open artist and any open release and shows the artist roster.
2. Clicking an artist tile, including its photo and name, opens that artist's discography. Generate banner and Manage photos still do only their own actions. The Open discography button still works.
3. On viewports wider than 600px, the artist-page photo frame is 16:9, matching the generated banner, so the subject is not sliced into a short top strip. At 600px and below, the frame stays `height: clamp(265px, 76vw, 340px)`.

## Must not change

- Album cards stay buttons that open the release.
- Saved focus values and the focus editor stay as they are.
- Phone artist-page framing stays the current taller crop.

## Setup

- No new dependencies.
- No git commits unless asked.
- Files: `public/discography.js`, `public/app.js`, `public/discography.css`, `public/viewport.css`, `test/discography-ui.test.mjs`, `test/discography-browser.test.mjs`.
