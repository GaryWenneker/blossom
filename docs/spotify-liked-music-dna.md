# Spotify Liked Songs → Blossom Music DNA

## What works

Spotify **Liked Songs** (`https://open.spotify.com/collection/tracks`) is a private Spotify library,
not a public playlist URL. Blossom now provides an official **OAuth 2.0 with PKCE** read-only
connection with scope `user-library-read`, alongside its existing `user-read-private` scope.

Blossom can then fetch Spotify's current-user saved tracks endpoint
`GET https://api.spotify.com/v1/me/tracks?limit=50&offset=0`, advancing until the
`nextOffset` result is `null`. Each page is translated into a source-linked
Music DNA **metadata** reference:

- Spotify track ID and canonical `https://open.spotify.com/track/{id}` URL
- Artist, song, release year, source album, optional ISRC, and save date
- Duplicate prevention by Spotify track URL
- Existing analyzed profiles are left intact
- New references are queued as **metadata-only**, awaiting real audio or an analyst

The same Spotify connection can search the public catalog and add individual recordings.
`GET /api/music-dna/spotify/search?q=` returns at most 8 tracks and 8 albums.
`POST /api/music-dna/spotify/tracks` with `{ "id" }` adds that track.
`POST /api/music-dna/spotify/albums` with `{ "id" }` adds every track on the album.
Albums with more than 500 tracks are refused and import nothing. A repeated add of the
same Spotify track URL is a duplicate, not a second profile. Search does not follow
URLs returned by Spotify. The client sends a Spotify id, never an access token or a URL.

**This import does not download Spotify audio**, measure BPM, determine song key,
separate stems, identify instruments, or invent timed sections. Metadata must not
be falsely labeled as a complete Music DNA analysis. For deeper AX evidence-first
Music DNA, research a track's sourced arrangement or analyze audio that the user
has permission to process. Never claim Spotify's metadata endpoint performed
an audio analysis.

## First-time local setup

1. Run `git pull origin main` and `bash setup.sh --headless`.
2. Sign in to local Blossom at `http://127.0.0.1:8787`.
3. Go to **Connections → Spotify Web API** and enter a Spotify developer app Client ID.
   If you have no Spotify developer app, create one at
   `https://developer.spotify.com/dashboard` and register **exactly**
   `https://blossom.wenneker.dev/callback` as the Spotify Redirect URI
   (HTTPS, same case, no trailing slash). This URL is **not**
   `https://blossom.wenneker.dev/mcp` and it is **not** the ChatGPT OAuth
   callback. The developer Client ID (no Client Secret) is saved under
   local Blossom Connections.
4. Ensure your existing Cloudflare tunnel routes
   `blossom.wenneker.dev` to the local Blossom service on port 8787.
   `GET https://blossom.wenneker.dev/callback` must show
   **Spotify-callback is actief** (without requiring an admin login).
   If Cloudflare Zero Trust Access protects the full hostname, create a
   **narrow bypass for GET /callback** so Spotify's browser redirect
   reaches Blossom; do not open the admin site or other paths publicly.
5. Go to **Music DNA → Spotify · Liked Songs** and choose
   **Connect / reauthorize Spotify Library**.
6. Authorize access to saved content on **accounts.spotify.com**. You may use your
   existing Spotify account's supported sign-in method there. Blossom never asks
   for your Spotify password.
7. Back in Music DNA, click **Import all Liked Songs into Music DNA**. The browser
   invokes the authenticated local import endpoint page by page (50 items per
   request), shows progress, and preserves successful batches if later calls fail.
8. If you've already connected Spotify **before** this release, **reauthorize**:
   the old token was issued for `user-read-private` only and cannot retrieve
   `/me/tracks` without `user-library-read`.

Spotify developer **Development Mode** restrictions since February/March 2026
may require the Spotify app owner to have Premium and have no more than five app
users. A `403` can also mean the old OAuth scope was never granted. Follow the
server's error instead of injecting browser cookies.

## Spotify public HTTPS callback: security

The local Blossom admin at `http://127.0.0.1:8787` starts OAuth only after
local administrator authentication and generates a one-time, random PKCE state.
The Spotify authorize request contains the registered
`redirect_uri=https://blossom.wenneker.dev/callback` and
`user-library-read` scope. After login Spotify redirects to this public
HTTPS URL with a `code` and `state`.

The publicly accessible route uses that state to atomically redeem the
stored encrypted PKCE verifier. It checks that the originating local admin
session is still valid; it does **not** need the browser's localhost session
cookie on the public domain. The app exchanges the authorization code
server-side using the **same registered HTTPS redirect URI**, verifies the
Spotify profile, and stores only the refresh token in the encrypted local
credential vault. The route returns a simple token-free HTML result with
`Cache-Control: no-store`, `Referrer-Policy: no-referrer` and a restrictive
CSP. Replays, unknown states and expired sessions cannot issue fresh tokens.

**Visiting `/callback` directly does not authorize Spotify.** It only
reports that the endpoint exists. The local Connections UI shows the current
server-configured Redirect URI so you can enter precisely the same string in
Spotify's dashboard. In development **without** a public MCP hostname,
Blossom retains its old loopback-only `/auth/spotify/callback` flow.

**Never expose the local admin UI publicly solely for this callback.**
The Cloudflare gateway keeps `/login`, `/api/*` and the Studio endpoints
restricted. Spotify account authorization and ChatGPT/Blossom MCP OAuth are
separate protocols and do not share tokens.

## ChatGPT ↔ Blossom MCP

The existing authenticated Blossom MCP server now advertises:

- `spotify_liked_tracks({offset:0,limit:50})`: list one page as metadata.
- `spotify_liked_import_page({offset:0,limit:50})`: import/deduplicate one page
  and return `total`, `received`, `imported`, `duplicates`,
  `skipped`, `queued`, `profileIds`, and `nextOffset`.
- Repeat `spotify_liked_import_page` with each returned `nextOffset` until
  it becomes `null`; don't guess how many favorites the user has.

The MCP write method requires existing authenticated Blossom write access.
The Spotify authorization is **independent** of connecting the Blossom MCP app
to ChatGPT. ChatGPT may need to refresh/reconnect the custom Blossom app to
discover newly advertised tools after a server update.

## Local REST API

User must be logged into local Blossom; mutations require the standard UI
request header. Admin HTTP routes are blocked from the public MCP-only hostname.

- `GET /api/music-dna/spotify-liked/page?offset=0&limit=50`
- `POST /api/music-dna/spotify-liked/import` with JSON `{"offset":0,"limit":50}`

Per-batch limits, no user-uploaded URLs, and fixed official Spotify endpoint
avoid following untrusted pagination URLs or exposing OAuth refresh tokens.

## Limits

- ChatGPT cannot access a private collection just because its link is supplied.
- Spotify's `GET /me/tracks` provides saved-track metadata, not the waveform.
- Bulk metadata import does **not** satisfy the AX bar-by-bar analysis standard.
- If import is interrupted in the local UI, retry; imported Spotify IDs are
  deduplicated. The running browser tab holds the pagination cursor until reload.
- This code was tested using mocked Spotify OAuth and API responses. Until
  tested against your actual Spotify consent and account it does not establish
  that any favorite song was imported.
