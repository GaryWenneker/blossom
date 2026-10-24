import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { MusicDnaAPI } from "../src/music-dna-api.mjs";
import { Sessions, Vault } from "../src/security.mjs";
import { SpotifyOAuth } from "../src/spotify.mjs";
import { createAppServer } from "../src/server.mjs";

const vaultKey = Buffer.alloc(32, 19).toString("base64");
const password = "very-secure-blossom-password";
const TRACK = "1".repeat(22);
const ALBUM = "2".repeat(22);
const NOTE = "Spotify does not supply full audio; no measure-level or vocal/instrument analysis has been asserted.";

function sid(n) {
  return String(n).padStart(22, "0");
}

function fullTrack(id, name, artist, year, { local = false, album = "Reach the Beach" } = {}) {
  return {
    id, name, is_local: local,
    artists: artist ? [{ name: artist }] : [],
    album: { name: album, release_date: year ? year + "-05-01" : "" },
    external_ids: { isrc: "USAAA8300001" }
  };
}

function simpleTrack(id, name, artist, { local = false } = {}) {
  return { id, name, is_local: local, artists: artist ? [{ name: artist }] : [] };
}

function catalogBackend({ search, track, album, albumTracks, httpStatus = null, brokenJson = false } = {}) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const href = String(url);
    calls.push(href);
    const parsed = new URL(href);
    if (parsed.protocol !== "https:" ||
      (parsed.hostname !== "accounts.spotify.com" && parsed.hostname !== "api.spotify.com"))
      throw new Error("fetcher left Spotify: " + href);
    if (parsed.hostname === "accounts.spotify.com") {
      assert.equal(parsed.pathname, "/api/token");
      return { ok: true, json: async () => ({ access_token: "token-secret", refresh_token: "rotated-token" }) };
    }
    assert.equal(options.headers?.Authorization, "Bearer token-secret");
    if (brokenJson) return { ok: true, json: async () => { throw new Error("bad json"); } };
    if (httpStatus) return { ok: false, status: httpStatus, headers: { get: () => "7" } };
    if (parsed.pathname === "/v1/search") {
      assert.equal(parsed.searchParams.get("type"), "track,album");
      assert.equal(parsed.searchParams.get("limit"), "8");
      assert.equal(parsed.searchParams.get("market"), "from_token");
      return { ok: true, json: async () => ({
        tracks: { ...(search?.tracks || { items: [] }), next: "https://evil.example/search-next" },
        albums: { ...(search?.albums || { items: [] }), next: "https://evil.example/album-search-next" }
      }) };
    }
    const oneTrack = parsed.pathname.match(/^\/v1\/tracks\/([^/]+)$/);
    if (oneTrack) return { ok: true, json: async () => track(oneTrack[1]) };
    const page = parsed.pathname.match(/^\/v1\/albums\/([^/]+)\/tracks$/);
    if (page) {
      const offset = Number(parsed.searchParams.get("offset"));
      const limit = Number(parsed.searchParams.get("limit"));
      assert.equal(limit, 50);
      assert.ok(Number.isInteger(offset) && offset >= 0);
      return { ok: true, json: async () => ({
        ...albumTracks(page[1], offset, limit),
        next: "https://evil.example/album-tracks-next"
      }) };
    }
    const oneAlbum = parsed.pathname.match(/^\/v1\/albums\/([^/]+)$/);
    if (oneAlbum) return { ok: true, json: async () => album(oneAlbum[1]) };
    throw new Error("Unexpected Spotify endpoint " + href);
  };
  return { fetcher, calls };
}

async function withCatalog(t, backend, run, { connected = true } = {}) {
  const store = new Store(":memory:");
  const vault = new Vault(store.db, vaultKey);
  vault.setSetting("spotify_client_id", "a".repeat(32));
  if (connected) vault.save("spotify_refresh_token", "Test", "refresh");
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
  const libraryTotal = async () => {
    const res = await request("GET", "/api/music-dna/search?limit=1", { cookie });
    assert.equal(res.status, 200);
    return (await res.json()).total;
  };
  await run({ request, cookie, calls: backend.calls, libraryTotal });
}

const beachSearch = {
  tracks: { items: [
    fullTrack(TRACK, "One Thing Leads to Another", "The Fixx", "1983"),
    fullTrack(sid(9), "Local Skip", "Nobody", "1983", { local: true }),
    fullTrack(sid(8), "No Year", "The Fixx", ""),
    ...Array.from({ length: 7 }, (_, i) => fullTrack(sid(20 + i), "Extra " + i, "The Fixx", "1983"))
  ] },
  albums: { items: [
    { id: ALBUM, name: "Reach the Beach", artists: [{ name: "The Fixx" }], release_date: "1983-05-01", total_tracks: 10 },
    { id: "not-an-id", name: "Dropped", artists: [{ name: "X" }], total_tracks: 1 }
  ] }
};

test("Search returns tracks and albums", async t => {
  const backend = catalogBackend({ search: beachSearch });
  await withCatalog(t, backend, async ({ request, cookie }) => {
    const res = await request("GET", "/api/music-dna/spotify/search?q=Reach%20the%20Beach", { cookie });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.query, "Reach the Beach");
    assert.ok(body.tracks.length <= 8);
    assert.ok(body.albums.length <= 8);
    assert.equal(body.tracks.length, 8);
    assert.deepEqual(body.tracks[0], {
      id: TRACK, artist: "The Fixx", title: "One Thing Leads to Another",
      album: "Reach the Beach", releaseYear: 1983
    });
    assert.equal(body.tracks.some(item => item.title === "Local Skip"), false);
    assert.equal(Object.hasOwn(body.tracks.find(item => item.title === "No Year"), "releaseYear"), false);
    assert.deepEqual(body.albums, [{
      id: ALBUM, artist: "The Fixx", title: "Reach the Beach", releaseYear: 1983, trackCount: 10
    }]);
    assert.equal(backend.calls.some(url => url.includes("evil.example")), false);
    const searchUrl = new URL(backend.calls.find(url => url.includes("/v1/search?")));
    assert.equal(searchUrl.hostname, "api.spotify.com");
    assert.equal(searchUrl.searchParams.get("q"), "Reach the Beach");
  });
});

test("Empty and overlong queries are refused", async t => {
  const backend = catalogBackend();
  await withCatalog(t, backend, async ({ request, cookie }) => {
    const before = backend.calls.length;
    const empty = await request("GET", "/api/music-dna/spotify/search?q=%20%20", { cookie });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error, "Enter a Spotify search query");
    const long = await request("GET", "/api/music-dna/spotify/search?q=" + "a".repeat(101), { cookie });
    assert.equal(long.status, 400);
    assert.equal((await long.json()).error, "Spotify search query is too long");
    assert.equal(backend.calls.length, before);
  });
});

test("Add one track", async t => {
  const backend = catalogBackend({
    track: id => fullTrack(id, "One Thing Leads to Another", "The Fixx", "1983")
  });
  await withCatalog(t, backend, async ({ request, cookie }) => {
    const res = await request("POST", "/api/music-dna/spotify/tracks", { cookie, body: { id: TRACK } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.imported, 1);
    assert.equal(body.duplicates, 0);
    assert.equal(body.queued, 1);
    assert.equal(body.skipped, 0);
    assert.equal(body.analysisStatus, "queued_for_verified_audio_or_review");
    assert.equal(body.note, NOTE);
    assert.equal(body.profileIds.length, 1);
    const profile = await (await request("GET", "/api/music-dna/profiles/" + body.profileIds[0], { cookie })).json();
    assert.equal(profile.artist, "The Fixx");
    assert.equal(profile.title, "One Thing Leads to Another");
    assert.equal(profile.releaseYear, 1983);
    assert.equal(profile.sourceKind, "metadata");
    assert.equal(profile.sourceUrl, "https://open.spotify.com/track/" + TRACK);
    assert.match(profile.sourceNote, /^Imported from Spotify search; metadata only, no audio analyzed\./);
    assert.match(profile.sourceNote, /ISRC: USAAA8300001/);
    assert.equal(profile.analysis, null);
    assert.equal(profile.analysisVersion, 0);
    const trackUrl = backend.calls.find(url => url.includes("/v1/tracks/"));
    assert.equal(new URL(trackUrl).hostname, "api.spotify.com");
  });
});

test("Adding the same track again is a duplicate", async t => {
  const backend = catalogBackend({
    track: id => fullTrack(id, "One Thing Leads to Another", "The Fixx", "1983")
  });
  await withCatalog(t, backend, async ({ request, cookie, libraryTotal }) => {
    const first = await request("POST", "/api/music-dna/spotify/tracks", { cookie, body: { id: TRACK } });
    const created = await first.json();
    const before = await libraryTotal();
    const second = await request("POST", "/api/music-dna/spotify/tracks", { cookie, body: { id: TRACK } });
    assert.equal(second.status, 200);
    const body = await second.json();
    assert.equal(body.imported, 0);
    assert.equal(body.duplicates, 1);
    assert.equal(body.profileIds[0], created.profileIds[0]);
    assert.equal(await libraryTotal(), before);
  });
});

test("Add an album imports each track", async t => {
  const tracks = [
    simpleTrack(sid(31), "One Thing Leads to Another", "The Fixx"),
    simpleTrack(sid(32), "Saved by Zero", "The Fixx")
  ];
  const backend = catalogBackend({
    album: () => ({
      id: ALBUM, name: "Reach the Beach", artists: [{ name: "The Fixx" }],
      release_date: "1983-05-01", total_tracks: 2,
      tracks: { next: "https://evil.example/embedded" }
    }),
    albumTracks: (_id, offset) => ({ items: offset === 0 ? tracks : [], total: 2 })
  });
  await withCatalog(t, backend, async ({ request, cookie, libraryTotal }) => {
    const res = await request("POST", "/api/music-dna/spotify/albums", { cookie, body: { id: ALBUM } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.imported, 2);
    assert.equal(body.duplicates, 0);
    assert.equal(body.trackCount, 2);
    assert.equal(body.truncated, false);
    assert.equal(body.note, NOTE);
    assert.equal(await libraryTotal(), 2);
    for (const id of body.profileIds) {
      const profile = await (await request("GET", "/api/music-dna/profiles/" + id, { cookie })).json();
      assert.equal(profile.sourceKind, "metadata");
      assert.match(profile.sourceUrl, /^https:\/\/open\.spotify\.com\/track\//);
      assert.match(profile.sourceNote, /^Imported from Spotify album; metadata only, no audio analyzed\./);
      assert.match(profile.sourceNote, /Album: Reach the Beach/);
      assert.doesNotMatch(profile.sourceNote, /ISRC/);
      assert.equal(profile.releaseYear, 1983);
      assert.equal(profile.analysis, null);
    }
    assert.equal(backend.calls.some(url => url.includes("evil.example")), false);
    assert.ok(backend.calls.some(url => url.includes("/v1/albums/" + ALBUM + "/tracks?")));
    const again = await (await request("POST", "/api/music-dna/spotify/albums", { cookie, body: { id: ALBUM } })).json();
    assert.equal(again.imported, 0);
    assert.equal(again.duplicates, 2);
    assert.equal(await libraryTotal(), 2);
  });
});

test("album pages are fetched locally and local tracks are skipped", async t => {
  const tracks = Array.from({ length: 51 }, (_, index) =>
    simpleTrack(sid(100 + index), "Track " + index, "The Fixx", { local: index === 50 }));
  const offsets = [];
  const backend = catalogBackend({
    album: () => ({
      id: ALBUM, name: "Reach the Beach", artists: [{ name: "The Fixx" }],
      release_date: "1983-05-01", total_tracks: 51
    }),
    albumTracks: (_id, offset) => {
      offsets.push(offset);
      return { items: tracks.slice(offset, offset + 50), total: 51 };
    }
  });
  await withCatalog(t, backend, async ({ request, cookie, libraryTotal }) => {
    const body = await (await request("POST", "/api/music-dna/spotify/albums", {
      cookie, body: { id: ALBUM }
    })).json();
    assert.deepEqual(offsets, [0, 50]);
    assert.equal(body.imported, 50);
    assert.equal(body.skipped, 1);
    assert.equal(body.truncated, false);
    assert.equal(await libraryTotal(), 50);
    assert.equal(backend.calls.some(url => url.includes("evil.example")), false);
  });
});

test("An album over 500 tracks imports nothing", async t => {
  let tracksFetched = false;
  const backend = catalogBackend({
    album: () => ({ id: ALBUM, name: "Huge", artists: [{ name: "Various" }], total_tracks: 501 }),
    albumTracks: () => { tracksFetched = true; return { items: [], total: 501 }; }
  });
  await withCatalog(t, backend, async ({ request, cookie, libraryTotal }) => {
    const res = await request("POST", "/api/music-dna/spotify/albums", { cookie, body: { id: ALBUM } });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "This album has 501 tracks. Import is limited to 500.");
    assert.equal(await libraryTotal(), 0);
    assert.equal(tracksFetched, false);
  });
});

test("A bad id never leaves api.spotify.com", async t => {
  const backend = catalogBackend();
  await withCatalog(t, backend, async ({ request, cookie }) => {
    const before = backend.calls.length;
    for (const path of ["/api/music-dna/spotify/tracks", "/api/music-dna/spotify/albums"]) {
      const res = await request("POST", path, { cookie, body: { id: "https://evil.example/track" } });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, "Invalid Spotify id");
    }
    assert.equal(backend.calls.length, before);
  });
});

test("Spotify rate limit uses the existing retry message", async t => {
  const backend = catalogBackend({ httpStatus: 429, search: beachSearch });
  await withCatalog(t, backend, async ({ request, cookie }) => {
    const res = await request("GET", "/api/music-dna/spotify/search?q=Reach", { cookie });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).error, "Spotify rate limit reached; retry in 7 seconds");
  });
});

test("an unconnected Spotify account cannot search", async t => {
  const backend = catalogBackend();
  await withCatalog(t, backend, async ({ request, cookie }) => {
    const before = backend.calls.length;
    const res = await request("GET", "/api/music-dna/spotify/search?q=Reach", { cookie });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /Spotify API is not connected/);
    assert.equal(backend.calls.length, before);
  }, { connected: false });
});

test("catalog failures do not import and stay on Spotify", async t => {
  const denied = catalogBackend({ httpStatus: 403, search: beachSearch });
  await withCatalog(t, denied, async ({ request, cookie, libraryTotal }) => {
    const res = await request("GET", "/api/music-dna/spotify/search?q=Reach", { cookie });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error,
      "Spotify cannot read this catalog. Reconnect through the official Spotify OAuth page.");
    assert.equal(await libraryTotal(), 0);
  });
  const missing = catalogBackend({ httpStatus: 404 });
  await withCatalog(t, missing, async ({ request, cookie, libraryTotal }) => {
    const res = await request("POST", "/api/music-dna/spotify/tracks", { cookie, body: { id: TRACK } });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "Spotify item was not found");
    assert.equal(await libraryTotal(), 0);
  });
  const failed = catalogBackend({ httpStatus: 500, search: beachSearch });
  await withCatalog(t, failed, async ({ request, cookie }) => {
    const res = await request("GET", "/api/music-dna/spotify/search?q=Reach", { cookie });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "Spotify request failed (500)");
  });
  const garbage = catalogBackend({ brokenJson: true, search: beachSearch });
  await withCatalog(t, garbage, async ({ request, cookie }) => {
    const res = await request("GET", "/api/music-dna/spotify/search?q=Reach", { cookie });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "Spotify returned an invalid response");
  });
  const weird = catalogBackend({
    album: () => ({ id: ALBUM, name: "Huge", artists: [{ name: "Various" }], total_tracks: "501" })
  });
  await withCatalog(t, weird, async ({ request, cookie, libraryTotal }) => {
    const res = await request("POST", "/api/music-dna/spotify/albums", { cookie, body: { id: ALBUM } });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "Spotify returned an invalid album");
    assert.equal(await libraryTotal(), 0);
    assert.equal(weird.calls.some(url => url.includes("/tracks")), false);
  });
});

test("spotifyJson refuses a non-Spotify URL before any fetch", async () => {
  const store = new Store(":memory:");
  try {
    const vault = new Vault(store.db, vaultKey);
    const sessions = new Sessions(store.db, { password });
    const calls = [];
    const oauth = new SpotifyOAuth({
      vault, sessions,
      fetcher: async url => { calls.push(String(url)); throw new Error("fetched"); }
    });
    await assert.rejects(
      () => oauth.spotifyJson(new URL("https://evil.example/track")),
      /Invalid Spotify id/);
    assert.equal(calls.length, 0);
  } finally { store.close(); }
});

test("missing Spotify catalog is unavailable", async () => {
  const store = new Store(":memory:");
  try {
    const api = new MusicDnaAPI(new MusicDNA(store), {});
    await assert.rejects(
      () => api.handle({ method: "GET", headers: {} }, { writeHead() {}, end() {} },
        "/api/music-dna/spotify/search", new URLSearchParams("q=ab")),
      error => error.status === 503 && error.message === "Spotify library integration unavailable"
    );
  } finally { store.close(); }
});
