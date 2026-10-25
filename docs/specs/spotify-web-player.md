# SPEC — Spotify-style player

- Tier: 3
- Spec approval: obtained by confirming the plan "Spotify-style Player page"
- Isolation: none. The user asked to implement this in the current Blossom workspace.
- Setup plan:
  - Tools to install: none
  - Git: no commits unless the user asks
  - Files added: `src/spotify-player.mjs`, `public/player.js`, `public/player.css`, `public/player-playback.js`, `test/spotify-player.test.mjs`, `test/player-ui.test.mjs`, this spec
  - Files updated: `public/route.js`, `public/app.js`, `public/index.html`, `src/spotify.mjs`, `src/server.mjs`, `test/route.test.mjs`, `test/spotify-liked.test.mjs`, `test/spotify-public-callback.test.mjs`, `test/public-gateway.test.mjs`
  - New dependencies: none. Playback uses Spotify's hosted Web Playback SDK script, loaded only after `#player` opens.
- Failure model:
  - Access token leaked in HTML, logs, `localStorage`, or the public gateway
  - Open proxy that fetches a caller-supplied URL
  - Playback of a URI the client invents instead of an allowlisted id
  - Public hostname serves the player or `/api/player/*`
  - Markup injection through artist or track names
  - A grant without `streaming` silently starts playback

## Product

`#player` is a full-viewport page in the local Blossom app. It follows the Spotify web player's regions: top bar, library, main view, now-playing column, and transport bar. The wordmark is Blossom. Copy is English. Album art is an `https` image URL from Spotify's CDN, not a file in this repo.

The page lists and plays the connected Spotify account through the official Web API and the Web Playback SDK. Spotify Premium is required to hear audio. A free account can browse and sees a Premium message.

Daily Mix, radio, DJ, lyrics, similar videos, podcasts, Create, follow, like, and playlist edits are out of scope. `user-library-modify`, `user-follow-modify`, and playlist-modify scopes are not requested.

## Routes

`#studio` and the other existing page hashes stay unchanged. `#music-dna/extra` and `#playerish` still open News to Song.

| Hash | View |
|---|---|
| `#player` | Home |
| `#player/collection/tracks` | Liked Songs |
| `#player/playlist/{id}` | Playlist |
| `#player/artist/{id}` | Artist |
| `#player/album/{id}` | Album or single |
| `#player/search?q=` | Search |

`{id}` is a 22-character Spotify id. Anything else under `#player` stays on the player page and shows "That player link is not valid." Optional `offset` is an integer from 0 through 1000000.

## API contract

Internal only. The signed-in local Blossom UI is the only consumer. Routes are new. Existing Spotify Liked Songs and catalog routes stay as they are.

Authentication is the existing browser session. PUT also requires the existing `X-Blossom-Request: ui` header and a same-origin check. The client sends a Spotify id, never an access token and never a URL, except `GET /api/player/token`, which returns the short-lived access token the Web Playback SDK requires. That response is `Cache-Control: no-store`. The browser keeps it in the SDK callback only. It is not written to `localStorage`, HTML, or logs.

The server builds `https://api.spotify.com/v1/...` itself. Any other host is rejected with `400` `Invalid Spotify id` and the fetcher is not called. Spotify `next` URLs are never requested or returned.

Playback needs every scope in `PLAYER_SCOPES` (streaming, user-read-email, user-read-private, user-read-playback-state, user-modify-playback-state, user-read-recently-played, user-top-read, user-follow-read, playlist-read-private, playlist-read-collaborative, user-library-read). A refresh grant missing any of them returns `409` `Reconnect Spotify in Connections. The current grant cannot play in Blossom.` Liked Songs import keeps working on the older grant.

### GET `/api/player/home`

`200`:

```json
{
  "recent": [{ "id": "1111111111111111111111", "title": "One Thing", "artist": "The Fixx", "imageUrl": "https://i.scdn.co/image/abc" }],
  "playlists": [{ "id": "2222222222222222222222", "title": "Liked Songs stand-in", "imageUrl": "", "owner": "Ada" }],
  "artists": [{ "id": "3333333333333333333333", "name": "The Fixx", "imageUrl": "" }],
  "albums": [{ "id": "4444444444444444444444", "title": "Reach the Beach", "artist": "The Fixx", "imageUrl": "" }]
}
```

At most 8 items in each list. Local tracks are omitted. `imageUrl` is empty unless it is `https` on `i.scdn.co`, `mosaic.scdn.co`, or `*.spotifycdn.com`.

### GET `/api/player/library?kind=playlists|artists|albums`

Unknown `kind` → `400` `Invalid library kind`. Playlists and albums use `offset` (default 0, max 1000000) and `limit` 50. Artists use Spotify's followed-artists cursor: optional `after` must be a Spotify id or absent. `next` URLs are not returned. `nextOffset` or `nextCursor` is computed locally.

### GET `/api/player/tracks?offset=`

Liked Songs, same paging bounds as the existing importer. `200`: `{ "offset", "limit", "total", "nextOffset", "tracks": [...] }`.

### GET `/api/player/playlists/{id}?offset=`

### GET `/api/player/artists/{id}`

### GET `/api/player/albums/{id}?offset=`

Bad id → `400` `Invalid Spotify id`. Spotify 404 → `404` `Spotify item was not found`. Track lists are at most 50 items.

### GET `/api/player/search?q=`

This route reads Blossom only: artists, albums, Music DNA profiles, album entries, and Studio projects. It does not call Spotify and does not require a playback grant. Empty → `400` `Enter a search query`; longer than 100 → `400` `Search query is too long`. `200`: `{ "query", "source": "blossom", "tracks", "albums", "artists" }` with at most 8 of each. Result links are `#player/catalog/artist/{uuid}` and `#player/catalog/album/{uuid}`.

### GET `/api/player/catalog/artists/{uuid}`

### GET `/api/player/catalog/albums/{uuid}`

Blossom catalog pages for a search result. Bad id → `400` `Invalid catalog id`. Missing row → `404` `Artist not found` or `Album not found`. These routes do not call Spotify.

### GET `/api/player/token`

`200`: `{ "accessToken", "expiresIn" }`. No refresh token. `Cache-Control: no-store`.

### PUT `/api/player/play`

Body `{ "deviceId", "kind": "album"|"playlist"|"track", "id" }`. Extra fields, including a client-supplied URI, are ignored. `deviceId` must match `^[A-Za-z0-9]{8,64}$`. The server sends `spotify:track:{id}` or `spotify:{kind}:{id}` to `PUT https://api.spotify.com/v1/me/player/play?device_id=`. `200`: `{ "started": true }`. Device not ready → `404` `Blossom Player is not ready yet. Wait a moment and try again.` Playback refused → `403` `Spotify refused playback. Premium is required, or this grant cannot control playback.`

### PUT `/api/player/shuffle`

Body `{ "deviceId", "state": true|false }`. `200`: `{ "shuffle": true }`.

### PUT `/api/player/repeat`

Body `{ "deviceId", "state": "off"|"context"|"track" }`. `200`: `{ "repeat": "off" }`.

Not connected → the existing `409` reconnect message from token refresh. Spotify `429` → the existing retry message.

### API gates (accepted)

- Boring: plural resources under `/api/player`, camelCase like the rest of Blossom.
- Compatibility: additive. Authorize scope string grows; Liked Songs still requests `user-library-read` and still refuses modify scopes.
- Auth: existing session. The playback token is the one exception, and only on `/api/player/token`.
- Authorization: server builds Spotify URLs from a checked id. Public host never reaches these routes.
- Idempotency: play, shuffle, and repeat set a state. A retry repeats the same Spotify call. Duplicate play is acceptable. No idempotency key.
- Blast radius: home is four Spotify reads. Library and track pages are one read, limit 50. No new app-level limiter; Spotify `429` is surfaced. One caller looping home costs four Spotify calls per request, same class as opening the page.
- Pagination: offset for playlists, albums, and liked tracks. Followed artists use Spotify's `after` cursor because that endpoint has no offset. `next` URLs are not exposed.
- Expensive fields: responses omit raw Spotify JSON, audio features, and lyrics.
- Leakage: no refresh token, no Spotify `next` URL, no internal vault fields.

## UI

The admin sidebar, top bar, and footer are hidden while `body[data-view=player]`. A Player nav item opens `#player`. Studio remains a link in the player top bar.

Home is a card grid of recently played, playlists, top artists, and saved albums. Liked Songs, playlist, artist, and album/single show a header and a track table. Search results are four groups. The now-playing column shows art, title, and artist from the SDK. Transport: previous, play/pause, next, seek, shuffle, repeat, volume. Device name is `Blossom Player`.

The SDK script `https://sdk.scdn.co/spotify-player.js` is inserted only when the player view is shown. `index.html` does not reference it. Starting playback calls `PUT /api/player/play` from a click. Names are escaped like discography. A name `A <img` renders as text.

The public hostname `blossom.wenneker.dev` keeps the gateway response for `/` and returns 404 for `/player.js`, `/player-playback.js`, and `/api/player/token`. The gateway response CSP does not allow `sdk.scdn.co`. The local app CSP allows that script, Spotify image hosts, and Spotify connect/WebSocket hosts, and does not allow `unsafe-inline` or `unsafe-eval` scripts.

## Out of scope

Lyrics, DJ, videos, podcasts, library edits, and unofficial Spotify website calls.
