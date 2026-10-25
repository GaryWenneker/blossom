import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { libraryList, playerArtist, playerSearch, playerView } from "../public/player.js";
import { createPlayback, formatClock } from "../public/player-playback.js";

const id = "1111111111111111111111";

test("player shell has the web player regions and does not embed the SDK", () => {
  const html = playerView();
  assert.match(html, /class="sp-library"/);
  assert.match(html, /class="sp-top"/);
  assert.match(html, /class="sp-now"/);
  assert.match(html, /class="sp-bar"/);
  assert.match(html, /What do you want to play\?/);
  assert.match(html, /class="sp-brand">Blossom</);
  assert.match(html, /href="#studio"/);
  assert.match(html, /href="#player\/collection\/tracks"/);
  assert.doesNotMatch(html, /sdk\.scdn\.co|accessToken|localStorage/);
  const index = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const playback = readFileSync(new URL("../public/player-playback.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(index, /sdk\.scdn\.co/);
  assert.match(index, /data-tab="player"/);
  assert.match(playback, /https:\/\/sdk\.scdn\.co\/spotify-player\.js/);
  assert.match(playback, /Blossom Player/);
  assert.doesNotMatch(playback, /localStorage/);
  assert.match(app, /state\.tab==="player"/);
  assert.equal(formatClock(61000), "1:01");
});

test("player markup escapes names and drops non-Spotify art", () => {
  const html = playerArtist({
    id,
    name: "A <img onerror=alert(1)>",
    imageUrl: "https://evil.example/x.jpg",
    topTracks: [{ id, title: "T <b>", artist: "A <img onerror=alert(1)>", album: "L", durationMs: 61000, imageUrl: "javascript:alert(1)" }],
    albums: []
  });
  assert.match(html, /A &lt;img onerror=alert\(1\)&gt;/);
  assert.match(html, /T &lt;b&gt;/);
  assert.match(html, /1:01/);
  assert.doesNotMatch(html, /<img onerror|<b>|evil\.example|javascript:/);
  assert.doesNotMatch(html, /accessToken|token-secret/);
  const library = libraryList({ kind: "artists", items: [{ id, name: "Band <img>", imageUrl: "" }] });
  assert.match(library, /Band &lt;img&gt;/);
  assert.doesNotMatch(library, /<img>/);
});

test("playback token is handed to the SDK callback and is not stored on the controller", async () => {
  const listeners = {};
  let options;
  const notices = [];
  const Spotify = { Player: class {
    constructor(value) { options = value; }
    addListener(name, fn) { listeners[name] = fn; }
    connect() {}
    disconnect() {}
    togglePlay() {}
    nextTrack() {}
    previousTrack() {}
    seek() {}
    setVolume() {}
  } };
  const playback = createPlayback({
    Spotify,
    getToken: async () => "token-secret",
    onState() {},
    onNotice: text => notices.push(text)
  });
  assert.equal(playback.token, undefined);
  assert.equal(JSON.stringify(playback).includes("token-secret"), false);
  let seen = "";
  await options.getOAuthToken(token => { seen = token; });
  assert.equal(seen, "token-secret");
  listeners.account_error();
  assert.match(notices[0], /Premium is required/);
  assert.equal(options.name, "Blossom Player");
});

test("search results link into the Blossom catalog", () => {
  const albumId = "11111111-1111-1111-1111-111111111111";
  const artistId = "22222222-2222-2222-2222-222222222222";
  const entryId = "33333333-3333-3333-3333-333333333333";
  const html = playerSearch({
    query: "Kralle <img>",
    tracks: [{
      id: "1", title: "Stein", artist: "Kralle", imageUrl: "javascript:alert(1)",
      audioUrl: "https://evil.example/a.mp3"
    }, {
      id: "2", title: "Staub", artist: "Kralle", imageUrl: "",
      audioUrl: "/api/albums/" + albumId + "/entries/" + entryId + "/audio"
    }],
    albums: [{ id: albumId, title: "Stein", artist: "Kralle", imageUrl: "/api/albums/" + albumId + "/cover" }],
    artists: [{ id: artistId, name: "Kralle", imageUrl: "" }]
  });
  assert.match(html, /Results for Kralle &lt;img&gt;/);
  assert.match(html, new RegExp("#player/catalog/album/" + albumId));
  assert.match(html, new RegExp("#player/catalog/artist/" + artistId));
  assert.match(html, new RegExp("/api/albums/" + albumId + "/cover"));
  assert.match(html, new RegExp('src="/api/albums/' + albumId + "/entries/" + entryId + '/audio"'));
  assert.doesNotMatch(html, /spotify|javascript:|data-player-action="play"/);
});
