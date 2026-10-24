# Artist banner prompts follow DNA and the music being made

Status: approved by the user on 2026-10-24. Implementation follows this file.

Tier: 2 (prompt content for an existing image feature).

## Why

Artist banners are generated in two places:

- Artists screen: `POST /api/studio/artists/:id/generate-photo`
- Studio project: `POST /api/studio/projects/:id/generate-art` with `kind: "artist-photo"`

The artist-screen default prompt already includes the artist name, genre, and the free-text Artist DNA (`artists.dna`). A caller-supplied prompt replaces that default, so DNA can disappear from the visual brief. Neither path puts the production of the songs actually being made into that brief. Song extraction already loads analyzed DNA via `profilesForArtist` and `artistMusicTraits`, and Suno style uses `recipeStyle`, but banner generation does not.

A house production must not be pictured as a soft, sweet, innocent portrait. Voice type may decide who is in the photo. It must not decide the aesthetic.

## Behavior

`artistBannerPrompt` in `src/artist-banner-prompt.mjs` returns the string passed as `prompt` to image generation.

Inputs:

- `artist`: `{ name, genre, voice, dna }`
- `songs`: zero or more `{ genre, additionalStyles, style, moods, suggestedGenre }`, newest first, at most 3
- `analyzedStyle`: string from `artistMusicStyle(artistMusicTraits(profilesForArtist(artist.name)))`, or empty
- `projectStyle`: for a Studio project generation only, `recipeStyle(projectId)` (reference traits, no source-artist names), or empty
- `userPrompt`: optional caller text

The returned prompt always contains, in this order:

1. The caller text when present, otherwise `Wide cinematic fictional musician publicity photograph`.
2. A block titled `Artist identity` containing the artist genre, voice, and Artist DNA text.
3. A block titled `Music being made` containing the song fields that are non-empty (`genre`, `additionalStyles`, `style`, `moods`, `suggestedGenre`), then analyzed-recording style when present, then project reference style when present.
4. This binding sentence, unchanged: `Picture wardrobe, setting, age presentation, energy and attitude for this production. A club, house, techno or aggressive electronic production must not look soft, sweet, innocent or acoustic. An intimate acoustic, folk or singer-songwriter production must not look like a club or rave. Voice type chooses who may be pictured; it must not override the production look.`

When `songs`, `analyzedStyle`, and `projectStyle` are all empty, `Music being made` contains exactly: `No finished song yet. Use the artist genre and Artist DNA only. Do not invent a conflicting scene.`

### Scenarios

1. Artist DNA `late-night warehouse house, distorted kicks`, genre `House`, voice `female`, one song `{ genre: "House", style: "melodic house, 124 BPM, club drums", moods: ["driving"], suggestedGenre: "Melodic House" }`. The prompt contains the DNA sentence, `melodic house, 124 BPM, club drums`, `female`, and the binding sentence. It does not contain `soft, sweet portrait` as a requested look.
2. Artist DNA `fingerpicked intimacy`, genre `Indie Folk`, voice `female`, one song `{ style: "quiet acoustic, close vocal", moods: ["tender"], suggestedGenre: "Indie Folk" }`. The prompt contains `quiet acoustic, close vocal` and the binding sentence.
3. Caller prompt `A person standing in a meadow at noon` plus the house song from scenario 1. The prompt starts with that caller sentence and still contains the DNA sentence, `melodic house, 124 BPM, club drums`, and the binding sentence.
4. No songs and no analyzed style. The prompt contains the Artist DNA and `No finished song yet. Use the artist genre and Artist DNA only. Do not invent a conflicting scene.`
5. Analyzed style `saturated club production, approximately 126 BPM` is included under `Music being made`. A reference artist name that existed only on the source profile is absent, because `referenceTraits` already drops source artist names and this function receives only the style string.
6. Project generation for a house project does not include an older folk song. `songs` for that call is that project only, plus `projectStyle` for that project.
7. Artist-screen generation uses up to the three newest projects for that artist. A fourth older project is omitted.
8. The returned string length is at most 4000. Reservation order when trimming: binding sentence, Artist DNA (max 800 characters), music-being-made (max 1000 characters), caller text (whatever remains). Trimming cuts the caller text first, then music-being-made, then DNA, and never the binding sentence.
9. Album cover generation is unchanged. `kind: "cover"` still uses the cover prompt only.

## Must not change

- No artist name, badge, logo, or listener count is drawn into the image. Existing ChatGPT banner instructions stay.
- New banner variants still do not replace the selected hero.
- A project with no artist still returns 409 and does not call image generation.
- No new npm dependency.
- No reference-recording artist names, lyrics, or melodies are copied into the banner prompt.

## Setup

- Isolation: branch `artist-banner-music-prompt` in this checkout. A fresh worktree would not have `node_modules`, and this change needs the existing test runner.
- No new packages.
- Files added: `src/artist-banner-prompt.mjs`, `test/artist-banner-prompt.test.mjs`, this spec.
- Files edited: `src/studio-api.mjs` (both artist-photo generation calls), and `test/artist-banners.test.mjs` only if the HTTP fake must observe the new prompt. `src/chatgpt-images.mjs` instructions stay as they are; the facts live in `prompt`.
- Tests: `node --test test/artist-banner-prompt.test.mjs test/artist-banners.test.mjs`
- No checkpoint commits unless you ask for them.

## Approval

Reply with approval of this file to start the failing test. An answer to a side question is not approval of this spec.
