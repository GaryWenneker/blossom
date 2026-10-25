import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { musicDnaView } from "../public/music-dna.js";

const fixx = {
  id: "11111111-1111-4111-8111-111111111111",
  artist: "The Fixx",
  title: "The Sign of Fire",
  analysisVersion: 1,
  analysis: {
    bpm: 124.2,
    musicalKey: "A minor",
    genres: ["New wave", "Funk-influenced rock"],
    moods: ["Driving"],
    instruments: [{ name: "Electric bass" }, { name: "Drum kit" }],
    vocals: { type: "mixed", timbre: "Bright" }
  }
};

const other = {
  id: "22222222-2222-4222-8222-222222222222",
  artist: "Urban Dance Squad",
  title: "Deeper Shade of Soul",
  analysisVersion: 1,
  analysis: { bpm: 113, genres: ["Funk"], moods: ["Warm"], instruments: [{ name: "Saxophone" }] }
};

test("the library is a compact catalog, with register and the queue off the page", () => {
  const html = musicDnaView({ data: {
    musicDnaProfiles: [fixx, other],
    musicDnaTotal: 2,
    musicDnaSelected: null
  } });
  assert.doesNotMatch(html, /Analysis queue/);
  assert.doesNotMatch(html, /Register a recording/);
  assert.doesNotMatch(html, /dna-reference-form/);
  assert.doesNotMatch(html, /music-dna-result/);
  assert.match(html, /data-action="dna-register"/);
  assert.match(html, /2 recordings/);
  assert.equal((html.match(/class="dna-row(?: |")/g) || []).length, 2);
  assert.match(html, /The Fixx/);
  assert.match(html, /Deeper Shade of Soul/);
  assert.doesNotMatch(html, /Electric bass/);
});

test("the selected DNA profile is color-coded and marked in the row", () => {
  const html = musicDnaView({ data: {
    musicDnaProfiles: [fixx, other],
    musicDnaTotal: 2,
    musicDnaSelected: fixx
  } });
  const hue = html.match(/--dna-hue:(\d+)/);
  assert.ok(hue, "selected profile exposes a hue");
  assert.ok(Number(hue[1]) >= 0 && Number(hue[1]) < 360);
  const again = musicDnaView({ data: {
    musicDnaProfiles: [fixx], musicDnaTotal: 1, musicDnaSelected: fixx
  } });
  assert.equal(again.match(/--dna-hue:(\d+)/)[1], hue[1]);
  assert.match(html, /dna-chip genre/);
  assert.match(html, /dna-chip mood/);
  assert.match(html, /dna-chip instrument/);
  assert.match(html, /New wave/);
  assert.match(html, /is-selected/);
  assert.match(html, new RegExp('data-id="' + fixx.id + '"[^>]*is-selected|is-selected[^>]*data-id="' + fixx.id + '"'));
});

test("two million recordings render one window, not one card per row", async () => {
  const mod = await import("../public/music-dna.js");
  assert.equal(typeof mod.dnaWindow, "function");
  assert.equal(typeof mod.musicDnaSearchPath, "function");
  const tail = mod.dnaWindow({ total: 2_000_000, scrollTop: 799_400, viewportHeight: 600 });
  assert.equal(tail.start, 1_999_980);
  assert.equal(tail.end, 2_000_000);
  assert.equal(tail.span, mod.DNA_MAX_SPAN);
  const middle = mod.dnaWindow({ total: 2_000_000, scrollTop: 399_700, viewportHeight: 600 });
  assert.equal(middle.start, 999_990);
  assert.equal(middle.end, 1_000_014);
  const few = mod.dnaWindow({ total: 2, scrollTop: 0, viewportHeight: 600 });
  assert.equal(few.start, 0);
  assert.equal(few.end, 2);
  const path = mod.musicDnaSearchPath({ data: {
    musicDnaTotal: 2_000_000, musicDnaScroll: 799_400, musicDnaViewport: 600, musicDnaQuery: "bass"
  } });
  const params = new URLSearchParams(path.split("?")[1]);
  assert.equal(path.startsWith("music-dna/search?"), true);
  assert.equal(Number(params.get("offset")), 1_999_980);
  assert.equal(Number(params.get("limit")), 40);
  assert.equal(params.get("q"), "bass");
  const html = musicDnaView({ data: {
    musicDnaTotal: 2_000_000,
    musicDnaOffset: 1_999_980,
    musicDnaProfiles: [fixx],
    musicDnaScroll: 799_400,
    musicDnaViewport: 600,
    musicDnaSelected: fixx
  } });
  assert.equal((html.match(/class="dna-row(?: |")/g) || []).length, 20);
  assert.match(html, /2,000,000 recordings/);
  assert.match(html, /data-start="1999980"/);
  assert.match(html, /The Sign of Fire/);
  assert.match(html, /dna-row-pending/);
});

test("analysis queue markup stays in the dialog and escapes errors", async () => {
  const { musicDnaQueueMarkup } = await import("../public/music-dna.js");
  assert.equal(musicDnaQueueMarkup([]), "<p>No analysis jobs yet.</p>");
  const html = musicDnaQueueMarkup([{
    id: "job-1", profileId: "abcdef1234567890", status: "failed", error: "<script>"
  }]);
  assert.match(html, /failed/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  const waiting = musicDnaQueueMarkup([{
    id: "job-2", profileId: "abcdef1234567890", artist: "The Fixx", title: "One Thing", status: "queued", progress: 0
  }]);
  assert.match(waiting, />queued</);
  assert.match(waiting, /0%/);
  assert.doesNotMatch(waiting, /dna-add-audio/);
  assert.doesNotMatch(waiting, /Waiting for audio/);
  const running = musicDnaQueueMarkup([{
    id: "job-3", profileId: "ready123", artist: "Ready", title: "Track", status: "running", progress: 40
  }]);
  assert.match(running, /40%/);
});

test("the music dna page lists only unfinished work and a percent when one is known", () => {
  const idle = musicDnaView({ data: { musicDnaProfiles: [], musicDnaTotal: 0, musicDnaSpotify: null } });
  assert.match(idle, /Nothing in progress/);
  assert.doesNotMatch(idle, /dna-activity-percent/);
  assert.doesNotMatch(idle, /Analysis queue/);
  assert.doesNotMatch(idle, /Register a recording/);

  const html = musicDnaView({ data: {
    musicDnaProfiles: [],
    musicDnaTotal: 0,
    musicDnaOpenJobs: [
      { id: "j1", profileId: "abcdef1234567890", artist: "The Fixx", title: "The Sign of Fire", status: "running", progress: 40 },
      { id: "j2", profileId: "waiting123", artist: "A & B", title: "<x>", status: "queued" },
      { id: "j5", profileId: "ready123", artist: "Ready", title: "Track", status: "queued", hasAudio: true },
      { id: "j3", artist: "Done", title: "Already", status: "completed" },
      { id: "j4", profileId: "bad123", artist: "Bad", title: "Take", status: "failed",
        error: "Sign in to ChatGPT in Safari, then start the analysis again." }
    ],
    musicDnaSpotify: { running: true, received: 25, total: 100, status: "working" }
  } });
  assert.match(html, /<span class="dna-activity-artist">The Fixx<\/span><span class="dna-activity-title">The Sign of Fire<\/span>/);
  assert.match(html, />Running</);
  assert.match(html, /<span class="dna-activity-artist">A &amp; B<\/span><span class="dna-activity-title">&lt;x&gt;<\/span>/);
  assert.match(html, /data-action="dna-start-analysis"/);
  assert.doesNotMatch(html, /Waiting for audio/);
  assert.doesNotMatch(html, /dna-add-audio/);
  assert.doesNotMatch(html, /Done — Already/);
  assert.match(html, /<span class="dna-activity-artist">Bad<\/span><span class="dna-activity-title">Take<\/span>/);
  assert.match(html, /Sign in to ChatGPT in Safari, then start the analysis again\./);
  assert.match(html, /data-action="dna-start-one" data-id="bad123"/);
  assert.match(html, />Try again</);
  assert.match(html, /1 stopped/);
  assert.doesNotMatch(html, /Analysis failed/);
  assert.match(html, /Spotify Liked Songs/);
  assert.match(html, /25%/);
  assert.match(html, /1 importing/);
  assert.match(html, /1 running/);
  assert.match(html, /2 queued/);
  const jobs = [...html.matchAll(/<li data-kind="job"(?: class="is-stopped")?>([\s\S]*?)<\/li>/g)].map(match => match[1]);
  assert.equal(jobs.length, 4);
  assert.equal(jobs.filter(row => row.includes("dna-activity-percent")).length, 3);
  const running = jobs.find(row => row.includes(">Running<"));
  const waiting = jobs.find(row => row.includes("A &amp; B"));
  const ready = jobs.find(row => row.includes("dna-activity-artist\">Ready") && row.includes("dna-activity-title\">Track"));
  assert.match(running, /40%/);
  assert.doesNotMatch(running, /dna-start-one/);
  assert.match(waiting, /0%/);
  assert.match(waiting, /data-action="dna-start-one"/);
  assert.match(waiting, /data-id="waiting123"/);
  assert.match(ready, /data-action="dna-start-one"/);
  assert.ok(ready && ready.includes(">Queued<") && ready.includes("0%"));

  const capped = musicDnaView({ data: {
    musicDnaProfiles: [],
    musicDnaTotal: 0,
    musicDnaSpotify: { running: true, received: 150, total: 100 }
  } });
  assert.match(capped, /100%/);
  const paused = musicDnaView({ data: {
    musicDnaProfiles: [],
    musicDnaTotal: 0,
    musicDnaSpotify: { running: false, finished: false, received: 0, total: 0, status: "import failed" }
  } });
  assert.match(paused, />Paused</);
  assert.doesNotMatch(paused, /dna-activity-percent/);
  const done = musicDnaView({ data: {
    musicDnaProfiles: [],
    musicDnaTotal: 0,
    musicDnaSpotify: { running: false, finished: true, received: 10, total: 10, status: "complete" }
  } });
  assert.match(done, /Nothing in progress/);
});

test("The library page offers Spotify search without removing Liked Songs", () => {
  const html = musicDnaView({ data: {
    connections: { spotifyClientId: "client" },
    musicDnaProfiles: [],
    musicDnaTotal: 0,
    musicDnaSelected: null
  } });
  assert.match(html, /Search Spotify tracks and albums/);
  assert.match(html, /Search Spotify/);
  assert.match(html, /Import Liked Songs/);
  assert.match(html, /Search instruments, techniques, moods, song titles\.\.\./);
  assert.match(html, /No sync started yet/);
  assert.match(html, /data-action="dna-spotify-search"(?! disabled)/);
  const locked = musicDnaView({ data: {
    musicDnaProfiles: [], musicDnaTotal: 0, musicDnaSelected: null
  } });
  assert.match(locked, /data-action="dna-spotify-search" disabled/);
  assert.match(locked, /Add a Spotify Client ID/);
});

test("Start analysis asks the server to run ChatGPT in the background", async () => {
  const { musicDnaAction } = await import("../public/music-dna.js");
  const calls = [];
  const messages = [];
  await musicDnaAction(
    { dataset: { action: "dna-start-analysis" } },
    { data: {} },
    async (path, body) => { calls.push([path, body]); return { started: true }; },
    async () => {},
    text => messages.push(text));
  assert.deepEqual(calls, [["music-dna/jobs/start", {}]]);
  assert.match(messages[0], /Analysis started/);
});

test("a queued recording can start on its own and a saved analysis shows its ChatGPT conversation", async () => {
  const { musicDnaAction, musicDnaView } = await import("../public/music-dna.js");
  const calls = [];
  await musicDnaAction(
    { dataset: { action: "dna-start-one", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
    { data: {} },
    async (path, body) => { calls.push([path, body]); return { started: true }; },
    async () => {},
    () => {});
  assert.deepEqual(calls, [[
    "music-dna/jobs/start",
    { profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
  ]]);
  const html = musicDnaView({ data: {
    musicDnaProfiles: [],
    musicDnaTotal: 0,
    musicDnaSelected: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      artist: "De Staat",
      title: "Mona Lisa",
      analysisVersion: 2,
      analysis: {
        chatSession: {
          provider: "chatgpt",
          url: "https://chatgpt.com/c/22222222-2222-4222-8222-222222222222"
        }
      },
      chatSessions: [
        { version: 2, chatUrl: "https://chatgpt.com/c/22222222-2222-4222-8222-222222222222" },
        { version: 1, chatUrl: "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111" }
      ]
    }
  } });
  assert.match(html, /data-action="dna-analyze-recording"/);
  assert.match(html, /ChatGPT v2/);
  assert.match(html, /ChatGPT v1/);
  assert.match(html, /https:\/\/chatgpt\.com\/c\/11111111-1111-4111-8111-111111111111/);
  assert.doesNotMatch(html, /javascript:/);
});

test("Spotify search results escape names and offer add", async () => {
  const { spotifySearchMarkup } = await import("../public/music-dna.js");
  const html = spotifySearchMarkup({
    tracks: [{ id: "1".repeat(22), artist: "<b>", title: "Song", album: "Album" }],
    albums: [{ id: "2".repeat(22), artist: "A & B", title: "LP", trackCount: 3 },
      { id: "3".repeat(22), artist: "Solo", title: "Single", trackCount: 1 }]
  });
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /A &amp; B/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /data-action="dna-spotify-add-track"/);
  assert.match(html, /data-spotify-id="1111111111111111111111"/);
  assert.match(html, />Add</);
  assert.match(html, /data-action="dna-spotify-add-album"/);
  assert.match(html, />Add album</);
  assert.match(html, /3 tracks/);
  assert.match(html, /1 track</);
});

test("Spotify add reports how many recordings were new", async () => {
  const { musicDnaAction, musicDnaView } = await import("../public/music-dna.js");
  const messages = [];
  const state = { data: {
    connections: { spotifyClientId: "client" },
    musicDnaProfiles: [], musicDnaTotal: 0, musicDnaScroll: 0,
    musicDnaViewport: 600, musicDnaQuery: "", musicDnaSelected: null
  } };
  const pages = [
    { imported: 1, duplicates: 0 },
    { imported: 0, duplicates: 1 },
    { imported: 10, duplicates: 2 }
  ];
  let page = 0;
  const previous = globalThis.document;
  globalThis.document = { querySelector: () => ({ value: "  Reach the Beach  " }) };
  try {
    const api = async (path, body) => {
      if (String(path).startsWith("music-dna/spotify/tracks")) {
        assert.equal(body.id, "1".repeat(22));
        return pages[page++];
      }
      if (path === "music-dna/spotify/albums") {
        assert.equal(body.id, "2".repeat(22));
        return pages[page++];
      }
      return { results: [], total: 0 };
    };
    const say = text => messages.push(text);
    const refresh = async () => {};
    await musicDnaAction(
      { dataset: { action: "dna-spotify-add-track", spotifyId: "1".repeat(22) } },
      state, api, refresh, say);
    await musicDnaAction(
      { dataset: { action: "dna-spotify-add-track", spotifyId: "1".repeat(22) } },
      state, api, refresh, say);
    await musicDnaAction(
      { dataset: { action: "dna-spotify-add-album", spotifyId: "2".repeat(22) } },
      state, api, refresh, say);
    assert.deepEqual(messages, [
      "Added 1 recording.",
      "Already in the library.",
      "Added 10 recordings. 2 were already in the library."
    ]);
    messages.length = 0;
    await musicDnaAction(
      { dataset: { action: "dna-spotify-search" } },
      state, async path => {
        assert.match(path, /music-dna\/spotify\/search\?q=Reach%20the%20Beach/);
        return { tracks: [{ id: "1".repeat(22), artist: "<b>", title: "Song", album: "LP" }], albums: [] };
      }, refresh, say);
    const html = musicDnaView(state);
    assert.match(html, /1 track · 0 albums/);
    assert.match(html, /&lt;b&gt;/);
    assert.equal(messages.length, 0);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("Enter in a search field runs that search", async () => {
  const { musicDnaKeyAction, bindMusicDna } = await import("../public/music-dna.js");
  assert.equal(musicDnaKeyAction("dna-query", "Enter"), "dna-search");
  assert.equal(musicDnaKeyAction("dna-spotify-query", "Enter"), "dna-spotify-search");
  assert.equal(musicDnaKeyAction("dna-query", "a"), "");
  assert.equal(musicDnaKeyAction("studio-source", "Enter"), "");
  const listeners = {};
  const clicks = [];
  const previous = globalThis.document;
  globalThis.document = {
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelector(selector) { return { click() { clicks.push(selector); }, disabled: false }; }
  };
  try {
    bindMusicDna({ data: {} }, async () => {}, () => {}, () => {});
    const event = {
      key: "Enter", target: { id: "dna-spotify-query" },
      preventDefault() { this.defaultPrevented = true; }
    };
    listeners.keydown(event);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(clicks, ['[data-action="dna-spotify-search"]']);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("a job leaving the queue is the signal to reload the catalog", async () => {
  const { musicDnaJobsChanged } = await import("../public/music-dna.js");
  const queued = { id: "job-1", status: "queued", progress: 0 };
  const running = { id: "job-1", status: "running", progress: 40 };
  assert.equal(musicDnaJobsChanged(undefined, [queued]), false);
  assert.equal(musicDnaJobsChanged([queued], [running]), false);
  assert.equal(musicDnaJobsChanged([running], []), true);
  assert.equal(musicDnaJobsChanged([running], [{ id: "job-1", status: "failed" }]), true);
  assert.equal(musicDnaJobsChanged([queued, { id: "job-2", status: "queued" }], [queued]), true);
});

test("a failed job is labeled, and a saved analysis replaces awaiting analysis", () => {
  const waiting = {
    id: fixx.id, artist: "Anne Clark", title: "Sleeper In Metropolis",
    analysisVersion: 0, analysis: null
  };
  const failedHtml = musicDnaView({ data: {
    musicDnaProfiles: [{ ...waiting, jobStatus: "failed" }],
    musicDnaTotal: 1,
    musicDnaSelected: { ...waiting, jobStatus: "failed" }
  } });
  assert.match(failedHtml, /Analysis stopped\. Try again\./);
  assert.doesNotMatch(failedHtml, /Analysis failed/);
  assert.doesNotMatch(failedHtml, />failed</);
  assert.doesNotMatch(failedHtml, /Awaiting analysis/);
  const explained = musicDnaView({ data: {
    musicDnaProfiles: [{ ...waiting, jobStatus: "failed" }],
    musicDnaTotal: 1,
    musicDnaSelected: { ...waiting, jobStatus: "failed" },
    musicDnaOpenJobs: [{
      id: "job-fail", profileId: waiting.id, artist: "Anne Clark",
      title: "Sleeper In Metropolis", status: "failed",
      error: "Sign in to ChatGPT in Safari, then start the analysis again."
    }]
  } });
  assert.match(explained, /Sign in to ChatGPT in Safari, then start the analysis again\./);
  assert.match(explained, />Try again</);
  assert.doesNotMatch(explained, /Analysis failed/);
  const analyzedHtml = musicDnaView({ data: {
    musicDnaProfiles: [fixx], musicDnaTotal: 1, musicDnaSelected: fixx,
    musicDnaQuery: "fixx", musicDnaScroll: 0
  } });
  assert.match(analyzedHtml, /New wave/);
  assert.match(analyzedHtml, /DNA v1/);
  assert.doesNotMatch(analyzedHtml, /Awaiting analysis/);
  const waitingHtml = musicDnaView({ data: {
    musicDnaProfiles: [waiting], musicDnaTotal: 1, musicDnaSelected: waiting
  } });
  assert.match(waitingHtml, /Awaiting analysis/);
});

test("search reloads the first page and the open recording", async () => {
  const { musicDnaAction, musicDnaView: view } = await import("../public/music-dna.js");
  const stale = {
    id: fixx.id, artist: "The Fixx", title: "The Sign of Fire",
    analysisVersion: 0, analysis: null
  };
  const state = { data: {
    musicDnaProfiles: [stale], musicDnaTotal: 80, musicDnaOffset: 40,
    musicDnaScroll: 2400, musicDnaViewport: 600, musicDnaQuery: "stale",
    musicDnaSelected: stale
  } };
  const paths = [];
  const previous = globalThis.document;
  globalThis.document = { querySelector: () => ({ value: "  fixx  " }) };
  try {
    const result = await musicDnaAction(
      { dataset: { action: "dna-search" } },
      state,
      async path => {
        paths.push(path);
        if (String(path).startsWith("music-dna/profiles/")) return fixx;
        return { results: [fixx], total: 1 };
      },
      async () => {},
      () => {});
    assert.equal(result, "render");
    assert.match(paths[0], /music-dna\/search\?/);
    assert.match(paths[0], /q=fixx/);
    assert.match(paths[0], /offset=0/);
    assert.equal(paths[1], "music-dna/profiles/" + fixx.id);
    const html = view(state);
    assert.match(html, /value="fixx"/);
    assert.match(html, /New wave/);
    assert.match(html, /DNA v1/);
    assert.doesNotMatch(html, /Awaiting analysis/);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("top navigation holds the queue button and registration is a dialog", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/music-dna.css", import.meta.url), "utf8");
  const topbar = html.slice(html.indexOf('class="topbar"'), html.indexOf("</header>"));
  const mainEnd = html.indexOf("</main>");
  assert.match(topbar, /data-action="dna-queue"/);
  assert.ok(html.indexOf('id="dna-register-dialog"') > mainEnd);
  assert.match(html, /id="dna-reference-form"/);
  assert.match(css, /\.dna-row\{[^}]*height:\s*30px/);
});

test("painting the activity list keeps the active artist sort", async () => {
  const { paintDnaActivity } = await import("../public/music-dna.js");
  let html = "";
  const previous = globalThis.document;
  globalThis.document = {
    querySelector: () => ({ set outerHTML(value) { html = value; } })
  };
  try {
    paintDnaActivity({ data: {
      musicDnaSort: "artist",
      musicDnaDir: "asc",
      musicDnaOpenJobs: [
        { id: "j1", profileId: "p1", artist: "Zebra", title: "Song", status: "failed", error: "x" },
        { id: "j2", profileId: "p2", artist: "Alpha", title: "Other", status: "failed", error: "x" }
      ]
    }});
    const artists = [...html.matchAll(/dna-activity-artist">([^<]+)/g)].map(match => match[1]);
    assert.deepEqual(artists, ["Alpha", "Zebra"]);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("artist and title are separate columns and the headers sort both lists", async () => {
  const html = musicDnaView({ data: {
    musicDnaProfiles: [{
      id: fixx.id, artist: "Anne Clark", title: "Sleeper In Metropolis",
      analysisVersion: 0, analysis: null
    }],
    musicDnaTotal: 1,
    musicDnaSort: "artist",
    musicDnaDir: "asc",
    musicDnaOpenJobs: [
      { id: "j1", profileId: "p1", artist: "Zebra", title: "Song", status: "failed", error: "Stopped." },
      { id: "j2", profileId: "p2", artist: "Alpha", title: "Other", status: "failed", error: "Stopped." }
    ]
  }});
  assert.match(html, /<span class="dna-row-artist">Anne Clark<\/span><span class="dna-row-title">Sleeper In Metropolis<\/span>/);
  assert.doesNotMatch(html, /Anne Clark · Sleeper/);
  assert.match(html, /data-action="dna-sort" data-sort="artist" data-dir="desc" aria-sort="ascending"/);
  assert.match(html, /data-action="dna-sort" data-sort="title" data-dir="asc" aria-sort="none"/);
  const artists = [...html.matchAll(/dna-activity-artist">([^<]+)/g)].map(match => match[1]);
  assert.deepEqual(artists, ["Alpha", "Zebra"]);
  const { musicDnaAction } = await import("../public/music-dna.js");
  const state = { data: { musicDnaTotal: 3, musicDnaProfiles: [] } };
  const paths = [];
  const result = await musicDnaAction(
    { dataset: { action: "dna-sort", sort: "title", dir: "desc" } },
    state,
    async path => {
      paths.push(path);
      return { results: [], total: 3 };
    },
    async () => {},
    () => {});
  assert.equal(result, "render");
  assert.equal(state.data.musicDnaSort, "title");
  assert.equal(state.data.musicDnaDir, "desc");
  assert.equal(state.data.musicDnaScroll, 0);
  assert.match(paths[0], /sort=title/);
  assert.match(paths[0], /dir=desc/);
});

test("stopped analyses can be removed one at a time or cleared together", async () => {
  const html = musicDnaView({ data: {
    musicDnaProfiles: [],
    musicDnaTotal: 0,
    musicDnaOpenJobs: [
      { id: "j1", profileId: "bad123", artist: "Animotion", title: "Obsession", status: "failed", error: "ChatGPT reply was not a music analysis" },
      { id: "j2", profileId: "run123", artist: "Ready", title: "Track", status: "running", progress: 10 }
    ]
  }});
  assert.match(html, /data-action="dna-dismiss-one" data-id="bad123"/);
  assert.match(html, />Remove</);
  assert.match(html, /data-action="dna-dismiss-stopped"/);
  assert.match(html, />Clear stopped</);
  assert.doesNotMatch(html.match(/data-kind="job">[\s\S]*?<\/li>/)[0], /dna-dismiss/);
  const { musicDnaAction } = await import("../public/music-dna.js");
  const calls = [];
  await musicDnaAction(
    { dataset: { action: "dna-dismiss-one", id: "bad123" } },
    { data: {} },
    async (path, body) => { calls.push([path, body]); return { removed: 1 }; },
    async () => {},
    () => {});
  await musicDnaAction(
    { dataset: { action: "dna-dismiss-stopped" } },
    { data: {} },
    async (path, body) => { calls.push([path, body]); return { removed: 39 }; },
    async () => {},
    () => {});
  assert.deepEqual(calls, [
    ["music-dna/jobs/dismiss", { profileId: "bad123" }],
    ["music-dna/jobs/dismiss", {}]
  ]);
});
