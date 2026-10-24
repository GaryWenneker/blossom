# SPEC — Music DNA recording sheet

Tier 2. UI only. No new dependency. No API change. Work on the current branch in the existing tree because the screen is verified against the running local library.

## Product

The Music DNA catalog list is a 30px row of dim inherited text: artist, title, BPM, two traits, and a version or Analyze button. Selecting a row paints a strip above the list. Raw DNA and bar blocks sit inside collapsed sections that open into another scroll region. The strip is capped at 32% of the view.

A row click opens one glass sheet that shows the stored recording in a single viewport composition. The list itself uses brighter type and the traits already on the row.

## Sheet

- Native dialog. Backdrop is 50% black-green and blurred. The sheet fill is also about 50% opaque with a backdrop blur, bordered in the recording hue. Labels and values stay full opacity.
- The sheet fits the viewport. It has no collapsed sections and no second document scroll. Bar DNA is one horizontal color strip, not a stack of expandable blocks.
- Close with Escape, the close control, or the backdrop. Focus returns to the row. Analyze and Upload do not open the sheet.
- Cover: a square plate in the recording hue with the artist initials. Blossom does not store track or album art on a Music DNA profile. No image is fetched.
- Lyrics are not rendered. Reference recordings do not store lyrics, and copyrighted lyric text is not fetched or reproduced. The sheet says lyrics are not stored.
- Every stored profile field is visible: artist, title, release year, source kind, source URL, source note, recording SHA-256 when present, created, updated, analysis version, job status.
- Every stored analysis field is visible as a tile: BPM, key, time signature, duration, genres, moods, instruments (name, role, technique, timbre, confidence), vocals, production, sections as a compact list, summary, method, analyzer, confidence, measurements.
- Color is the evidence class, used as the source key:
  - audio observed: green
  - human verified: blue
  - source inferred: amber
  - not analyzed: slate
- A ChatGPT catalog analysis with no audio measurements is source inferred for the whole analysis. Bar blocks use their own status. Missing analysis is not analyzed. The sheet never labels catalog text as heard audio.

## List

- Unselected titles are light, not inherited muted gray. Every row has its hue stripe.
- Second line shows release year and source kind when present.
- The DNA column shows up to two genre chips, otherwise the status pill (Awaiting analysis or Analysis failed).
- Search, clear, count, register, queue, Spotify import, virtualized scrolling, and Analyze stay as they are.
- The empty "Select a recording" strip is removed. The sheet is the inspection surface.

## Must not

- Do not add a lyrics provider, scrape a lyric site, or paste third-party lyric text.
- Do not invent cover art, album art, or Spotify images that are not already on the profile.
- Do not change analysis storage, job queueing, or the public JSON shape.
- Do not make Analyze open the sheet.

## Setup

- Files: `public/music-dna.js`, `public/music-dna.css`, `public/viewport.css` only if the sheet must override the 32% focus cap, and `test/music-dna-catalog.test.mjs`.
- No new packages. No commit unless asked.

## Scenarios

1. Given a profile with artist, title, year, and source kind, the row shows those values in light text and a hue stripe before selection.
2. Given genres, the DNA column shows the first two as chips. Given no analysis, it shows Awaiting analysis. Given a failed job and no analysis, it shows Analysis failed.
3. Activating the row button opens a dialog whose backdrop is semi-transparent and blurred, containing the artist, title, and every stored profile field.
4. Given an analysis, the dialog shows each analysis group as an open tile. Raw DNA is not inside a details element.
5. Given analysisMethod chatgpt-catalog and no measurements, the analysis tiles use the source-inferred color. Given a bar block with status audio_observed, that cell uses the audio-observed color.
6. The dialog text does not contain a lyric body. It contains the line that lyrics are not stored.
7. The cover is a hue plate. No img is requested.
8. Escape closes the dialog. The Analyze button does not.
9. Existing catalog search, register, and Spotify controls still render.
