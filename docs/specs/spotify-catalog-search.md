# SPEC — Spotify catalog search and add

- Tier: 2
- Isolation: none. The Music DNA page the user is running already has uncommitted UI changes; a clean worktree would not contain them and could not show this feature on that page.
- Setup plan:
  - Tools to install: none
  - Git: no commits unless the user asks
  - Files the gauntlet will add: `test/spotify-catalog.test.mjs` (new). Markup assertions extend `test/music-dna-catalog.test.mjs`. No mutation runner package. Manual mutants are applied and restored in the working tree; no `tools/gauntlet.sh` (the repo has no such entry point; the evidence report will name the exact `node --test` commands).
  - New dependencies: none

## Product

The library search box keeps filtering recordings already in Music DNA. The Spotify block gains its own search. A query returns up to 8 tracks and 8 albums. Adding a track imports that one recording. Adding an album imports every track on it. Profiles are metadata-only, same as Liked Songs. Spotify audio is never downloaded.

## API contract

Internal only. The signed-in Blossom UI is the only consumer. New routes are additive. Existing `/api/music-dna/spotify-liked/*` requests and responses stay as they are.

Authentication stays the existing browser session and CSRF header. The client sends a Spotify id, never an access token and never a URL. The server builds `https://api.spotify.com/v1/...` itself and refuses any other host. Spotify ids must match the id check already used for Liked Songs; anything else is `400` with message `Invalid Spotify id` and the Spotify fetcher is not called.

### GET `/api/music-dna/spotify/search?q=`

`q` is trimmed. Empty → `400` `Enter a Spotify search query`. Longer than 100 characters → `400` `Spotify search query is too long`.

`200` body, camelCase, at most 8 tracks and 8 albums:

```json
{
  "query": "the fixx",
  "tracks": [{ "id": "1111111111111111111111", "artist": "The Fixx", "title": "One Thing Leads to Another", "album": "Reach the Beach", "releaseYear": 1983 }],
  "albums": [{ "id": "2222222222222222222222", "artist": "The Fixx", "title": "Reach the Beach", "releaseYear": 1983, "trackCount": 10 }]
}
```

`releaseYear` is omitted when Spotify has no 4-digit year from 1850 through 2200. Local Spotify tracks are omitted. No `next` URL from Spotify is returned or followed. One Spotify search call, `type=track,album`, `limit=8`, `market=from_token`.

### POST `/api/music-dna/spotify/tracks`

Body `{ "id": "<spotify id>" }`. `200`:

```json
{
  "imported": 1,
  "duplicates": 0,
  "queued": 1,
  "skipped": 0,
  "profileIds": ["<uuid>"],
  "analysisStatus": "queued_for_verified_audio_or_review",
  "note": "Spotify does not supply full audio; no measure-level or vocal/instrument analysis has been asserted."
}
```

The profile uses `sourceKind: "metadata"` and `sourceUrl: "https://open.spotify.com/track/<id>"`. Source note starts with `Imported from Spotify search; metadata only, no audio analyzed.` A second POST of the same id returns `imported: 0`, `duplicates: 1`, the same profile id, and does not create another profile. A local track or a track with no artist or title → `400` `Spotify track cannot be imported` and no profile.

### POST `/api/music-dna/spotify/albums`

Body `{ "id": "<spotify id>" }`. Same summary as a track, plus `trackCount` (Spotify's count) and `truncated: false`.

Every non-local album track becomes one profile. Source note starts with `Imported from Spotify album; metadata only, no audio analyzed.` Album name and release year come from the album. ISRC is omitted. Pages are requested with `limit=50` and a locally computed offset. Spotify `next` URLs are never requested.

If `trackCount` is greater than 500, respond `400` `This album has <n> tracks. Import is limited to 500.` and create nothing.

A retry imports nothing new (`duplicates` equals the importable track count).

Not connected → the existing `409` reconnect message. Spotify `429` → the existing retry message. Missing integration → `503` `Spotify library integration unavailable`.

### API gates (accepted)

- Boring: new routes sit beside `spotify-liked`; field names match this API's camelCase.
- Compatibility: additive only.
- Auth: existing session. No token in the browser.
- Authorization: server builds Spotify URLs from a checked id.
- Idempotency: Spotify track URL dedupe already in `importBatch`. No extra idempotency key. A mid-album failure can leave earlier tracks saved, same as Liked Songs; retry is safe.
- Blast radius: search is one Spotify call. Album import stops at 500 and otherwise refuses. No new app-level rate limiter; Spotify `429` is surfaced. Same exposure class as Liked Songs paging.
- Pagination: search is capped at 8 and 8. No cursor.
- Expensive fields: search does not include audio features or raw Spotify JSON.
- Leakage: no access token, no Spotify `next` URL.

## UI

Inside the existing Spotify block, under the Liked Songs controls:

- Text field placeholder `Search Spotify tracks and albums`.
- Button `Search Spotify`.
- Track row: artist, title, album, button `Add`.
- Album row: artist, title, track count, button `Add album`.
- A status line separate from `No sync started yet.`
- Without a Spotify Client ID, the search button is disabled and the existing hint stays.
- After a successful add, the catalog reloads. Status examples: `Added 1 recording.` `Already in the library.` `Added 10 recordings. 2 were already in the library.`

## Scenarios

Feature: Search Spotify and add tracks or albums

Scenario: Search returns tracks and albums
  Given a connected Spotify account whose search fixture contains one track and one album for "Reach the Beach"
  When the client calls GET /api/music-dna/spotify/search?q=Reach%20the%20Beach
  Then the response is 200 and contains that track and album, each list length at most 8

Scenario: Empty and overlong queries are refused
  Given a connected account
  When q is empty or 101 characters
  Then the response is 400, the body error is `Enter a Spotify search query` or `Spotify search query is too long`, and Spotify is not called

Scenario: Add one track
  Given Spotify returns The Fixx / One Thing Leads to Another with id 1111111111111111111111
  When POST /api/music-dna/spotify/tracks with that id
  Then one metadata profile exists for https://open.spotify.com/track/1111111111111111111111 and imported is 1

Scenario: Adding the same track again is a duplicate
  Given that profile already exists
  When the same POST is repeated
  Then imported is 0, duplicates is 1, and the profile count is unchanged

Scenario: Add an album imports each track
  Given an album of 2 tracks
  When POST /api/music-dna/spotify/albums with its id
  Then two profiles exist, trackCount is 2, truncated is false, and a repeat returns duplicates 2 and imported 0

Scenario: An album over 500 tracks imports nothing
  Given Spotify reports trackCount 501
  When POST /api/music-dna/spotify/albums
  Then the response is 400 `This album has 501 tracks. Import is limited to 500.` and the profile count is unchanged

Scenario: A bad id never leaves api.spotify.com
  Given id `https://evil.example/track`
  When search is not involved and POST tracks or albums is called
  Then the response is 400 `Invalid Spotify id` and the fetcher receives no request

Scenario: The library page offers Spotify search without removing Liked Songs
  Given the Music DNA library view with a Spotify Client ID
  When the view renders
  Then the HTML contains `Search Spotify tracks and albums`, `Import Liked Songs`, and the library placeholder `Search instruments, techniques, moods, song titles...`

## Must NOT

- Change Liked Songs routes, OAuth scopes, progress text, or the library search placeholder and filter behavior.
- Download or analyze Spotify audio, or write BPM, key, instruments, or sections from metadata.
- Add an MCP tool.
- Follow a URL supplied by Spotify or by the client.
- Add a dependency.
- Create a second profile for the same Spotify track URL.

## Files

- `src/spotify.mjs` — search, get track, list album tracks. URLs built locally.
- `src/spotify-catalog.mjs` — map and import. `src/spotify-liked.mjs` stays the Liked Songs path.
- `src/music-dna-api.mjs` — three routes, optional `spotifyCatalog` beside `spotifyLiked`.
- The call site that already passes `spotifyLiked` into `MusicDnaAPI`.
- `public/music-dna.js`, `public/music-dna.css` — search field, results, add buttons.
- `public/app.js` only if that is where the Liked Songs click is dispatched.
- `package.json` `check` script — `node --check` the new module and test.
- `docs/MUSIC_DNA.md` and `docs/spotify-liked-music-dna.md` — the three routes and the album cap, in English.

## Revisions

- 2026-10-24: Initial spec from the chosen Spotify search panel. Album add means every track on the album, capped at 500 with no partial import.
