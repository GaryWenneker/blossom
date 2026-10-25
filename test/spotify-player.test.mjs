import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Buffer } from "node:buffer";
import { Store } from "../src/storage.mjs";
import { Vault } from "../src/security.mjs";
import { createAppServer } from "../src/server.mjs";
import { SpotifyOAuth } from "../src/spotify.mjs";
import { playPayload, safeImageUrl } from "../src/spotify-player.mjs";

const vaultKey = Buffer.alloc(32, 19).toString("base64");
const password = "very-secure-blossom-password";
const id = "1111111111111111111111";
const id2 = "2222222222222222222222";
const fullScope = [
  "streaming", "user-read-email", "user-read-private", "user-read-playback-state",
  "user-modify-playback-state", "user-read-recently-played", "user-top-read",
  "user-follow-read", "playlist-read-private", "playlist-read-collaborative", "user-library-read"
].join(" ");

function track(name = "One Thing") {
  return {
    id, name, is_local: false, duration_ms: 200000,
    artists: [{ name: "The Fixx <img>" }],
    album: { name: "Reach the Beach", images: [{ url: "https://i.scdn.co/image/abc" }, { url: "javascript:alert(1)" }] }
  };
}

function fixture(url) {
  const path = url.pathname;
  if (path === "/v1/me/player/recently-played") return { items: [{ track: track() }, { track: { ...track(), is_local: true } }] };
  if (path === "/v1/me/playlists") return {
    items: [{ id: id2, name: "Night", images: [{ url: "https://mosaic.scdn.co/abc" }], owner: { display_name: "Ada" } }],
    total: 1, next: "https://evil.example/next"
  };
  if (path === "/v1/me/top/artists") return { items: [{ id, name: "The Fixx", images: [] }] };
  if (path === "/v1/me/albums" || path === "/v1/artists/" + id + "/albums") return {
    items: [{ album: { id, name: "Reach the Beach", album_type: "album", artists: [{ name: "The Fixx" }], images: [{ url: "https://i.scdn.co/image/album" }] } }],
    total: 1, next: null
  };
  if (path === "/v1/me/following") return { artists: { items: [{ id, name: "The Fixx", images: [] }], next: null, cursors: {} } };
  if (path === "/v1/me/tracks") return { items: [{ track: track() }], total: 1, offset: 0, limit: 50, next: null };
  if (path === "/v1/playlists/" + id2) return { id: id2, name: "Night", owner: { display_name: "Ada" }, images: [{ url: "https://i.scdn.co/image/pl" }] };
  if (path === "/v1/playlists/" + id2 + "/tracks") return { items: [{ track: track() }], total: 1, next: null };
  if (path === "/v1/artists/" + id) return { id, name: "The Fixx", images: [{ url: "https://i.scdn.co/image/art" }], followers: { total: 10 } };
  if (path === "/v1/artists/" + id + "/top-tracks") return { tracks: [track()] };
  if (path === "/v1/albums/" + id) return { id, name: "Reach the Beach", album_type: "single", artists: [{ name: "The Fixx" }], images: [{ url: "https://i.scdn.co/image/album" }], release_date: "1983-05-01" };
  if (path === "/v1/albums/" + id + "/tracks") return { items: [{ id, name: "One Thing", artists: [{ name: "The Fixx" }], duration_ms: 180000 }], total: 1, next: null };
  if (path === "/v1/search") return {
    tracks: { items: [track()] }, albums: { items: [] }, artists: { items: [] }, playlists: { items: [] }
  };
  if (path === "/v1/me/player/play" || path === "/v1/me/player/shuffle" || path === "/v1/me/player/repeat")
    return null;
  throw Error("Unexpected Spotify endpoint " + url);
}

function playerBackend({ scope = fullScope, httpStatus = 0 } = {}) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, method: options.method || "GET", body: options.body || "", authorization: options.headers?.Authorization || "" });
    if (target === "https://accounts.spotify.com/api/token")
      return { ok: true, status: 200, json: async () => ({ access_token: "token-secret", expires_in: 3600, scope }) };
    if (httpStatus) return { ok: false, status: httpStatus, headers: { get: () => "7" }, json: async () => ({}) };
    const parsed = new URL(target);
    if (parsed.origin !== "https://api.spotify.com") throw Error("fetcher saw " + parsed.origin);
    if (parsed.pathname.startsWith("/v1/me/player/") && (options.method || "GET") === "PUT")
      return { ok: true, status: 204, json: async () => { throw Error("204 has no json"); } };
    return { ok: true, status: 200, json: async () => fixture(parsed) };
  };
  return { fetcher, calls };
}

async function withPlayer(t, backend, run) {
  const store = new Store(":memory:");
  const vault = new Vault(store.db, vaultKey);
  vault.setSetting("spotify_client_id", "a".repeat(32));
  vault.save("spotify_refresh_token", "Test", "refresh");
  const server = createAppServer({
    store, vaultKey, spotifyFetcher: backend.fetcher,
    provider: { available: () => false }, password
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const request = async (method, path, { cookie, body } = {}) => fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json", "x-blossom-request": "ui" } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const login = await request("POST", "/auth/login", { body: { username: "admin", password } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  await run({ request, cookie, calls: backend.calls, base });
}

test("a non-Spotify URL cannot be fetched", async () => {
  const oauth = new SpotifyOAuth({
    vault: { read() { return "refresh"; }, getSetting() { return "client"; }, save() {}, list() { return {}; } },
    sessions: {},
    fetcher: () => { throw Error("fetcher must not run"); }
  });
  await assert.rejects(() => oauth.spotifyJson(new URL("https://evil.example/v1/me")), /Invalid Spotify id/);
  assert.deepEqual(playPayload("track", id), { uris: ["spotify:track:" + id] });
  assert.equal(playPayload("album", id).context_uri, "spotify:album:" + id);
  assert.throws(() => playPayload("show", id), /Invalid Spotify play target/);
  assert.equal(safeImageUrl("javascript:alert(1)"), "");
  assert.equal(safeImageUrl("https://evil.example/cover.jpg"), "");
});

test("player home, token, and play stay on the official API", async t => {
  const backend = playerBackend();
  await withPlayer(t, backend, async ({ request, cookie, calls }) => {
    const home = await request("GET", "/api/player/home", { cookie });
    assert.equal(home.status, 200);
    assert.equal(home.headers.get("cache-control"), "no-store");
    const homeBody = await home.json();
    assert.equal(homeBody.recent.length, 1);
    assert.equal(homeBody.recent[0].artist, "The Fixx <img>");
    assert.equal(homeBody.recent[0].imageUrl, "https://i.scdn.co/image/abc");
    assert.equal(homeBody.playlists[0].id, id2);
    assert.equal(JSON.stringify(homeBody).includes("evil.example"), false);
    assert.equal(JSON.stringify(homeBody).includes("token-secret"), false);

    const badKind = await request("GET", "/api/player/library?kind=podcasts", { cookie });
    assert.equal(badKind.status, 400);
    assert.match((await badKind.json()).error, /Invalid library kind/);

    const badId = await request("GET", "/api/player/albums/not-an-id", { cookie });
    assert.equal(badId.status, 400);

    const token = await request("GET", "/api/player/token", { cookie });
    assert.equal(token.status, 200);
    assert.equal(token.headers.get("cache-control"), "no-store");
    const tokenBody = await token.json();
    assert.equal(tokenBody.accessToken, "token-secret");
    assert.equal(tokenBody.expiresIn, 3600);
    assert.equal(Object.hasOwn(tokenBody, "refresh_token"), false);

    const played = await request("PUT", "/api/player/play", {
      cookie, body: { deviceId: "device1234", kind: "album", id, uri: "spotify:track:evil" }
    });
    assert.equal(played.status, 200);
    assert.deepEqual(await played.json(), { started: true });
    const playCall = calls.find(call => call.url.includes("/v1/me/player/play"));
    assert.equal(new URL(playCall.url).origin, "https://api.spotify.com");
    assert.equal(new URL(playCall.url).searchParams.get("device_id"), "device1234");
    assert.deepEqual(JSON.parse(playCall.body), { context_uri: "spotify:album:" + id });
    assert.equal(playCall.authorization, "Bearer token-secret");
    assert.equal(calls.some(call => call.url.includes("evil")), false);
  });
});

test("a grant without streaming must reconnect and does not read the library", async t => {
  const backend = playerBackend({ scope: "user-read-private user-library-read" });
  await withPlayer(t, backend, async ({ request, cookie, calls }) => {
    const home = await request("GET", "/api/player/home", { cookie });
    assert.equal(home.status, 409);
    assert.match((await home.json()).error, /Reconnect Spotify in Connections/);
    assert.equal(calls.some(call => call.url.includes("/v1/me/")), false);
  });
});

test("local player responses allow the playback SDK and hide the token from other bodies", async t => {
  const backend = playerBackend();
  await withPlayer(t, backend, async ({ request, cookie }) => {
    const page = await request("GET", "/player.js", { cookie });
    assert.equal(page.status, 200);
    const csp = page.headers.get("content-security-policy");
    assert.match(csp, /https:\/\/sdk\.scdn\.co/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    const search = await request("GET", "/api/player/search?q=", { cookie });
    assert.equal(search.status, 400);
    const empty = await search.json();
    assert.match(empty.error, /Enter a search query/);
    assert.doesNotMatch(empty.error, /Spotify/);
    assert.equal(JSON.stringify(empty).includes("token-secret"), false);
  });
});

test("player search reads the Blossom catalog and does not call Spotify", async t => {
  const backend = playerBackend();
  await withPlayer(t, backend, async ({ request, cookie, calls }) => {
    const artist = await request("POST", "/api/artists", { cookie, body: {
      name: "Kralle", genre: "Doom Metal", language: "de", countries: ["DE"], voice: "male", dna: "slow heavy guitars"
    }});
    assert.equal(artist.status, 201);
    const saved = await artist.json();
    const profile = await request("POST", "/api/music-dna/profiles", { cookie, body: {
      artist: "Kralle", title: "Stein wird Staub", sourceKind: "metadata"
    }});
    assert.equal(profile.status, 201);
    const album = await request("POST", "/api/albums", { cookie, body: {
      artistId: saved.id, title: "Stein", kind: "album"
    }});
    assert.equal(album.status, 201);
    const savedAlbum = await album.json();
    const search = await request("GET", "/api/player/search?q=Kralle", { cookie });
    assert.equal(search.status, 200);
    const body = await search.json();
    assert.equal(body.source, "blossom");
    assert.equal(body.artists.some(item => item.id === saved.id && item.name === "Kralle"), true);
    assert.equal(body.albums.some(item => item.id === savedAlbum.id && item.title === "Stein"), true);
    assert.equal(body.tracks.some(item => item.title === "Stein wird Staub" && item.artist === "Kralle"), true);
    assert.equal(calls.some(call => call.url.includes("spotify.com")), false);
    const page = await request("GET", "/api/player/catalog/artists/" + saved.id, { cookie });
    assert.equal(page.status, 200);
    const detail = await page.json();
    assert.equal(detail.name, "Kralle");
    assert.equal(detail.albums.some(item => item.id === savedAlbum.id), true);
    const albumPage = await request("GET", "/api/player/catalog/albums/" + savedAlbum.id, { cookie });
    assert.equal(albumPage.status, 200);
    assert.equal((await albumPage.json()).title, "Stein");
    assert.equal(calls.some(call => call.url.includes("spotify.com")), false);
  });
});
