import { DomainError } from "./domain.mjs";

const ID = /^[A-Za-z0-9]{22}$/;
const DEVICE = /^[A-Za-z0-9]{8,64}$/;
const IMAGE = /^https:\/\/(?:i\.scdn\.co|mosaic\.scdn\.co|[a-z0-9-]+\.spotifycdn\.com)\//i;

const text = (value, max) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";

export function safeImageUrl(value) {
  return typeof value === "string" && IMAGE.test(value) ? value : "";
}

export function imageUrl(images, { hero = false } = {}) {
  if (!Array.isArray(images)) return "";
  const urls = images.map(image => safeImageUrl(image?.url)).filter(Boolean);
  if (!urls.length) return "";
  return hero ? urls[0] : urls[urls.length - 1];
}

export function mapTrack(track, imageFallback = "") {
  if (!track || track.is_local || !ID.test(track.id || "")) return null;
  const artist = text(track.artists?.[0]?.name, 180);
  const title = text(track.name, 180);
  if (!artist || !title) return null;
  return {
    id: track.id,
    title,
    artist,
    album: text(track.album?.name, 180),
    durationMs: Number.isInteger(track.duration_ms) && track.duration_ms >= 0 ? track.duration_ms : 0,
    imageUrl: imageUrl(track.album?.images) || safeImageUrl(imageFallback)
  };
}

export function mapPlaylist(playlist) {
  if (!playlist || !ID.test(playlist.id || "")) return null;
  const title = text(playlist.name, 180);
  if (!title) return null;
  return {
    id: playlist.id,
    title,
    imageUrl: imageUrl(playlist.images),
    owner: text(playlist.owner?.display_name, 180)
  };
}

export function mapArtist(artist) {
  if (!artist || !ID.test(artist.id || "")) return null;
  const name = text(artist.name, 180);
  if (!name) return null;
  return { id: artist.id, name, imageUrl: imageUrl(artist.images) };
}

export function mapAlbum(album) {
  if (!album || !ID.test(album.id || "")) return null;
  const title = text(album.name, 180);
  const artist = text(album.artists?.[0]?.name, 180);
  if (!title || !artist) return null;
  const albumType = ["album", "single", "compilation"].includes(album.album_type) ? album.album_type : "";
  return { id: album.id, title, artist, imageUrl: imageUrl(album.images), albumType };
}

export function playPayload(kind, id) {
  if (!ID.test(id || "")) throw new DomainError("Invalid Spotify id", 400);
  if (kind === "track") return { uris: ["spotify:track:" + id] };
  if (kind === "album" || kind === "playlist") return { context_uri: "spotify:" + kind + ":" + id };
  throw new DomainError("Invalid Spotify play target", 400);
}

function assertDevice(deviceId) {
  if (typeof deviceId !== "string" || !DEVICE.test(deviceId))
    throw new DomainError("Invalid Spotify device", 400);
  return deviceId;
}

function assertOffset(offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000)
    throw new DomainError("Offset must be 0–1000000", 400);
  return offset;
}

function nextOffset(body, offset) {
  return body.next && body.items.length > 0 && offset + body.items.length < body.total
    ? offset + body.items.length : null;
}

function pageOrThrow(body) {
  if (!body || !Array.isArray(body.items) || !Number.isInteger(body.total) || body.total < 0 || body.items.length > 50)
    throw new DomainError("Spotify returned an invalid response", 502);
  return body;
}

export class SpotifyPlayer {
  constructor(spotify) { this.spotify = spotify; }

  async home() {
    const { accessToken: token } = await this.spotify.playerGrant();
    const recent = new URL("https://api.spotify.com/v1/me/player/recently-played");
    recent.searchParams.set("limit", "8");
    const playlists = new URL("https://api.spotify.com/v1/me/playlists");
    playlists.searchParams.set("limit", "8");
    const artists = new URL("https://api.spotify.com/v1/me/top/artists");
    artists.searchParams.set("limit", "8");
    artists.searchParams.set("time_range", "medium_term");
    const albums = new URL("https://api.spotify.com/v1/me/albums");
    albums.searchParams.set("limit", "8");
    const [recentBody, playlistBody, artistBody, albumBody] = await Promise.all([
      this.spotify.spotifyJson(recent, { token }),
      this.spotify.spotifyJson(playlists, { token }),
      this.spotify.spotifyJson(artists, { token }),
      this.spotify.spotifyJson(albums, { token })
    ]);
    return {
      recent: (recentBody.items || []).map(item => mapTrack(item.track)).filter(Boolean).slice(0, 8),
      playlists: (playlistBody.items || []).map(mapPlaylist).filter(Boolean).slice(0, 8),
      artists: (artistBody.items || []).map(mapArtist).filter(Boolean).slice(0, 8),
      albums: (albumBody.items || []).map(item => mapAlbum(item.album || item)).filter(Boolean).slice(0, 8)
    };
  }

  async library({ kind, offset = 0, after = "" } = {}) {
    if (!["playlists", "artists", "albums"].includes(kind))
      throw new DomainError("Invalid library kind", 400);
    const { accessToken: token } = await this.spotify.playerGrant();
    if (kind === "artists") {
      if (after && !ID.test(after)) throw new DomainError("Invalid Spotify id", 400);
      const url = new URL("https://api.spotify.com/v1/me/following");
      url.searchParams.set("type", "artist");
      url.searchParams.set("limit", "50");
      if (after) url.searchParams.set("after", after);
      const body = await this.spotify.spotifyJson(url, { token });
      const page = body.artists;
      if (!page || !Array.isArray(page.items) || page.items.length > 50)
        throw new DomainError("Spotify returned an invalid response", 502);
      const cursor = page.cursors?.after;
      return {
        kind,
        items: page.items.map(mapArtist).filter(Boolean).slice(0, 50),
        nextOffset: null,
        nextCursor: page.next && ID.test(cursor || "") ? cursor : null
      };
    }
    assertOffset(offset);
    const url = new URL(kind === "playlists"
      ? "https://api.spotify.com/v1/me/playlists"
      : "https://api.spotify.com/v1/me/albums");
    url.searchParams.set("limit", "50");
    url.searchParams.set("offset", String(offset));
    const body = pageOrThrow(await this.spotify.spotifyJson(url, { token }));
    const items = kind === "playlists"
      ? body.items.map(mapPlaylist).filter(Boolean)
      : body.items.map(item => mapAlbum(item.album || item)).filter(Boolean);
    return { kind, offset, limit: 50, total: body.total, items, nextOffset: nextOffset(body, offset), nextCursor: null };
  }

  async tracks(offset) {
    assertOffset(offset);
    await this.spotify.playerGrant();
    const page = await this.spotify.likedTracksPage({ offset, limit: 50 });
    return {
      offset: page.offset,
      limit: page.limit,
      total: page.total,
      nextOffset: page.nextOffset,
      tracks: page.items.map(item => mapTrack(item.track)).filter(Boolean)
    };
  }

  async playlist(id, offset = 0) {
    this.spotify.assertSpotifyId(id);
    assertOffset(offset);
    const { accessToken: token } = await this.spotify.playerGrant();
    const tracks = new URL("https://api.spotify.com/v1/playlists/" + id + "/tracks");
    tracks.searchParams.set("limit", "50");
    tracks.searchParams.set("offset", String(offset));
    const [meta, page] = await Promise.all([
      this.spotify.spotifyJson(new URL("https://api.spotify.com/v1/playlists/" + id), { token }),
      this.spotify.spotifyJson(tracks, { token })
    ]);
    pageOrThrow(page);
    const cover = imageUrl(meta.images, { hero: true });
    return {
      id,
      title: text(meta.name, 180) || "Playlist",
      owner: text(meta.owner?.display_name, 180),
      imageUrl: cover,
      total: page.total,
      offset,
      limit: 50,
      nextOffset: nextOffset(page, offset),
      tracks: page.items.map(item => mapTrack(item.track, cover)).filter(Boolean)
    };
  }

  async artist(id) {
    this.spotify.assertSpotifyId(id);
    const { accessToken: token } = await this.spotify.playerGrant();
    const top = new URL("https://api.spotify.com/v1/artists/" + id + "/top-tracks");
    top.searchParams.set("market", "from_token");
    const albums = new URL("https://api.spotify.com/v1/artists/" + id + "/albums");
    albums.searchParams.set("include_groups", "album,single");
    albums.searchParams.set("limit", "10");
    const [profile, topBody, albumBody] = await Promise.all([
      this.spotify.spotifyJson(new URL("https://api.spotify.com/v1/artists/" + id), { token }),
      this.spotify.spotifyJson(top, { token }),
      this.spotify.spotifyJson(albums, { token })
    ]);
    const mapped = mapArtist(profile);
    if (!mapped) throw new DomainError("Spotify returned an invalid response", 502);
    const followers = Number.isInteger(profile.followers?.total) && profile.followers.total >= 0
      ? profile.followers.total : 0;
    return {
      ...mapped,
      imageUrl: imageUrl(profile.images, { hero: true }),
      followers,
      topTracks: (topBody.tracks || []).map(track => mapTrack(track)).filter(Boolean).slice(0, 10),
      albums: (albumBody.items || []).map(mapAlbum).filter(Boolean).slice(0, 10)
    };
  }

  async album(id, offset = 0) {
    this.spotify.assertSpotifyId(id);
    assertOffset(offset);
    const { accessToken: token } = await this.spotify.playerGrant();
    const tracks = new URL("https://api.spotify.com/v1/albums/" + id + "/tracks");
    tracks.searchParams.set("limit", "50");
    tracks.searchParams.set("offset", String(offset));
    const [meta, page] = await Promise.all([
      this.spotify.spotifyJson(new URL("https://api.spotify.com/v1/albums/" + id), { token }),
      this.spotify.spotifyJson(tracks, { token })
    ]);
    const mapped = mapAlbum(meta);
    if (!mapped) throw new DomainError("Spotify returned an invalid response", 502);
    pageOrThrow(page);
    const cover = imageUrl(meta.images, { hero: true });
    const releaseDate = /^\d{4}(-\d{2}-\d{2})?$/.test(meta.release_date || "") ? meta.release_date : "";
    return {
      ...mapped,
      imageUrl: cover,
      releaseDate,
      total: page.total,
      offset,
      limit: 50,
      nextOffset: nextOffset(page, offset),
      tracks: page.items.map(track => mapTrack({ ...track, album: { name: mapped.title, images: meta.images } }, cover)).filter(Boolean)
    };
  }


  async token() {
    const grant = await this.spotify.playerGrant();
    return { accessToken: grant.accessToken, expiresIn: grant.expiresIn };
  }

  async control(path, { deviceId, payload, query }) {
    assertDevice(deviceId);
    const { accessToken: token } = await this.spotify.playerGrant();
    const url = new URL("https://api.spotify.com/v1/me/player/" + path);
    url.searchParams.set("device_id", deviceId);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
    await this.spotify.spotifyJson(url, {
      method: "PUT",
      ...(payload ? { payload } : {}),
      token,
      missing: "Blossom Player is not ready yet. Wait a moment and try again.",
      denied: "Spotify refused playback. Premium is required, or this grant cannot control playback."
    });
  }

  async play({ deviceId, kind, id }) {
    const payload = playPayload(kind, id);
    await this.control("play", { deviceId, payload });
    return { started: true };
  }

  async shuffle({ deviceId, state }) {
    if (typeof state !== "boolean") throw new DomainError("Invalid shuffle state", 400);
    await this.control("shuffle", { deviceId, query: { state: state ? "true" : "false" } });
    return { shuffle: state };
  }

  async repeat({ deviceId, state }) {
    if (!["off", "context", "track"].includes(state)) throw new DomainError("Invalid repeat state", 400);
    await this.control("repeat", { deviceId, query: { state } });
    return { repeat: state };
  }
}

function readOffset(url) {
  const raw = url.searchParams.get("offset");
  if (raw === null || raw === "") return 0;
  if (!/^\d+$/.test(raw)) throw new DomainError("Offset must be 0–1000000", 400);
  const offset = Number(raw);
  if (offset > 1_000_000) throw new DomainError("Offset must be 0–1000000", 400);
  return offset;
}

async function readJson(req) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json"))
    throw new DomainError("Expected application/json", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8000) throw new DomainError("JSON payload too large", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new DomainError("Invalid JSON", 400); }
}

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

const CATALOG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function searchQuery(query) {
  const q = typeof query === "string" ? query.trim() : "";
  if (!q) throw new DomainError("Enter a search query", 400);
  if (q.length > 100) throw new DomainError("Search query is too long", 400);
  return q;
}

function likeNeedle(value) {
  return "%" + value.toLocaleLowerCase().replace(/[\\%_]/g, match => "\\" + match) + "%";
}

function catalogId(value) {
  return CATALOG_ID.test(value || "") ? value : "";
}

function coverUrl(row) {
  return row.cover_filename && catalogId(row.id) ? "/api/albums/" + row.id + "/cover" : "";
}

function entryAudio(row) {
  if ((!row.audio_ref && !row.audio_filename) || !catalogId(row.album_id) || !catalogId(row.id)) return "";
  return "/api/albums/" + row.album_id + "/entries/" + row.id + "/audio";
}

function albumType(kind) {
  if (kind === "single" || kind === "compilation" || kind === "ep") return kind;
  return "album";
}

function pushTrack(tracks, seen, track, limit) {
  const key = (track.artist + "\n" + track.title).toLocaleLowerCase();
  if (!track.title || seen.has(key) || tracks.length >= limit) return;
  seen.add(key);
  tracks.push(track);
}

export function blossomSearch(db, musicDna, query) {
  const q = searchQuery(query);
  const needle = likeNeedle(q);
  const artists = db.prepare(
    `SELECT id, name, genre FROM artists
     WHERE lower(name) LIKE ? ESCAPE '\\' OR lower(genre) LIKE ? ESCAPE '\\'
     ORDER BY name LIMIT 8`
  ).all(needle, needle).map(row => ({ id: row.id, name: row.name, genre: row.genre, imageUrl: "" }));
  const albums = db.prepare(
    `SELECT albums.id, albums.title, albums.kind, albums.cover_filename, artists.name AS artist
     FROM albums JOIN artists ON artists.id = albums.artist_id
     WHERE lower(albums.title) LIKE ? ESCAPE '\\' OR lower(artists.name) LIKE ? ESCAPE '\\'
     ORDER BY albums.title LIMIT 8`
  ).all(needle, needle).map(row => ({
    id: row.id, title: row.title, artist: row.artist, albumType: albumType(row.kind), imageUrl: coverUrl(row)
  }));
  const tracks = [];
  const seen = new Set();
  if (/[\p{L}\p{N}]/u.test(q)) {
    for (const row of musicDna.search({ q, limit: 8 }))
      pushTrack(tracks, seen, { id: row.id, title: row.title, artist: row.artist, album: "", durationMs: 0, imageUrl: "", audioUrl: "" }, 8);
  }
  const entries = db.prepare(
    `SELECT album_tracks.id, album_tracks.title, album_tracks.album_id, album_tracks.audio_ref, album_tracks.audio_filename,
            albums.title AS album, artists.name AS artist
     FROM album_tracks
     JOIN albums ON albums.id = album_tracks.album_id
     JOIN artists ON artists.id = albums.artist_id
     WHERE lower(album_tracks.title) LIKE ? ESCAPE '\\' OR lower(albums.title) LIKE ? ESCAPE '\\' OR lower(artists.name) LIKE ? ESCAPE '\\'
     ORDER BY album_tracks.title LIMIT 8`
  ).all(needle, needle, needle);
  for (const row of entries)
    pushTrack(tracks, seen, {
      id: row.id, title: row.title, artist: row.artist, album: row.album, durationMs: 0,
      imageUrl: "", audioUrl: entryAudio(row)
    }, 8);
  const projects = db.prepare(
    `SELECT p.id, p.title, COALESCE(a.name, '') AS artist
     FROM studio_projects p LEFT JOIN artists a ON a.id = p.artist_id
     WHERE lower(p.title) LIKE ? ESCAPE '\\' OR lower(COALESCE(a.name, '')) LIKE ? ESCAPE '\\'
     ORDER BY p.updated_at DESC LIMIT 8`
  ).all(needle, needle);
  for (const row of projects)
    pushTrack(tracks, seen, { id: row.id, title: row.title, artist: row.artist || "Unknown artist", album: "", durationMs: 0, imageUrl: "", audioUrl: "" }, 8);
  return { query: q, source: "blossom", tracks, albums, artists };
}

function requireCatalogId(id) {
  if (!catalogId(id)) throw new DomainError("Invalid catalog id", 400);
}

export function blossomArtist(db, id) {
  requireCatalogId(id);
  const artist = db.prepare("SELECT id, name, genre FROM artists WHERE id=?").get(id);
  if (!artist) throw new DomainError("Artist not found", 404);
  const albums = db.prepare(
    `SELECT albums.id, albums.title, albums.kind, albums.cover_filename, artists.name AS artist
     FROM albums JOIN artists ON artists.id = albums.artist_id
     WHERE albums.artist_id=? ORDER BY albums.title LIMIT 20`
  ).all(id).map(row => ({
    id: row.id, title: row.title, artist: row.artist, albumType: albumType(row.kind), imageUrl: coverUrl(row)
  }));
  const tracks = [];
  const seen = new Set();
  const profiles = db.prepare(
    "SELECT id, artist, title FROM music_dna_profiles WHERE lower(artist)=lower(?) ORDER BY updated_at DESC LIMIT 20"
  ).all(artist.name);
  for (const row of profiles)
    pushTrack(tracks, seen, { id: row.id, title: row.title, artist: row.artist, album: "", durationMs: 0, imageUrl: "", audioUrl: "" }, 20);
  const entries = db.prepare(
    `SELECT album_tracks.id, album_tracks.title, album_tracks.album_id, album_tracks.audio_ref, album_tracks.audio_filename,
            albums.title AS album, artists.name AS artist
     FROM album_tracks
     JOIN albums ON albums.id = album_tracks.album_id
     JOIN artists ON artists.id = albums.artist_id
     WHERE artists.id=? ORDER BY album_tracks.title LIMIT 20`
  ).all(id);
  for (const row of entries)
    pushTrack(tracks, seen, {
      id: row.id, title: row.title, artist: row.artist, album: row.album, durationMs: 0, imageUrl: "", audioUrl: entryAudio(row)
    }, 20);
  return { id: artist.id, name: artist.name, genre: artist.genre, imageUrl: "", albums, topTracks: tracks };
}

export function blossomAlbum(db, id) {
  requireCatalogId(id);
  const album = db.prepare(
    `SELECT albums.id, albums.title, albums.kind, albums.release_date, albums.cover_filename, artists.name AS artist
     FROM albums JOIN artists ON artists.id = albums.artist_id WHERE albums.id=?`
  ).get(id);
  if (!album) throw new DomainError("Album not found", 404);
  const tracks = db.prepare(
    `SELECT id, title, album_id, audio_ref, audio_filename FROM album_tracks WHERE album_id=? ORDER BY position, id`
  ).all(id).map(row => ({
    id: row.id, title: row.title, artist: album.artist, album: album.title, durationMs: 0, imageUrl: coverUrl(album), audioUrl: entryAudio(row)
  }));
  return {
    id: album.id, title: album.title, artist: album.artist, albumType: albumType(album.kind),
    releaseDate: album.release_date || "", imageUrl: coverUrl(album), tracks
  };
}

export class SpotifyPlayerApi {
  constructor(spotify, catalog = {}) {
    this.player = new SpotifyPlayer(spotify);
    this.catalog = catalog;
  }

  async handle(req, res, path, url) {
    const method = req.method;
    if (path === "/api/player/home" && method === "GET")
      return send(res, 200, await this.player.home());
    if (path === "/api/player/library" && method === "GET")
      return send(res, 200, await this.player.library({
        kind: url.searchParams.get("kind") || "",
        offset: readOffset(url),
        after: url.searchParams.get("after") || ""
      }));
    if (path === "/api/player/tracks" && method === "GET")
      return send(res, 200, await this.player.tracks(readOffset(url)));
    if (path === "/api/player/search" && method === "GET")
      return send(res, 200, blossomSearch(this.catalog.db, this.catalog.musicDna, url.searchParams.get("q") || ""));
    const catalogArtist = path.match(/^\/api\/player\/catalog\/artists\/([0-9a-f-]{36})$/i);
    if (catalogArtist && method === "GET")
      return send(res, 200, blossomArtist(this.catalog.db, catalogArtist[1]));
    const catalogAlbum = path.match(/^\/api\/player\/catalog\/albums\/([0-9a-f-]{36})$/i);
    if (catalogAlbum && method === "GET")
      return send(res, 200, blossomAlbum(this.catalog.db, catalogAlbum[1]));
    if (path === "/api/player/token" && method === "GET")
      return send(res, 200, await this.player.token());
    const playlist = path.match(/^\/api\/player\/playlists\/([A-Za-z0-9]{22})$/);
    if (playlist && method === "GET")
      return send(res, 200, await this.player.playlist(playlist[1], readOffset(url)));
    const artist = path.match(/^\/api\/player\/artists\/([A-Za-z0-9]{22})$/);
    if (artist && method === "GET")
      return send(res, 200, await this.player.artist(artist[1]));
    const album = path.match(/^\/api\/player\/albums\/([A-Za-z0-9]{22})$/);
    if (album && method === "GET")
      return send(res, 200, await this.player.album(album[1], readOffset(url)));
    if (/^\/api\/player\/(?:playlists|artists|albums)\//.test(path) && method === "GET")
      throw new DomainError("Invalid Spotify id", 400);
    if (path === "/api/player/play" && method === "PUT") {
      const body = await readJson(req);
      return send(res, 200, await this.player.play({ deviceId: body?.deviceId, kind: body?.kind, id: body?.id }));
    }
    if (path === "/api/player/shuffle" && method === "PUT") {
      const body = await readJson(req);
      return send(res, 200, await this.player.shuffle({ deviceId: body?.deviceId, state: body?.state }));
    }
    if (path === "/api/player/repeat" && method === "PUT") {
      const body = await readJson(req);
      return send(res, 200, await this.player.repeat({ deviceId: body?.deviceId, state: body?.state }));
    }
    const allowed = method === "GET" || method === "PUT";
    throw new DomainError(allowed ? "Not found" : "Method not allowed", allowed ? 404 : 405);
  }
}
