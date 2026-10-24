import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { musicDnaActivityItems, paintDnaActivity } from "../public/music-dna.js";

const dash = " \u2014 ";

function job(id, createdAt, status = "queued") {
  return {
    id, profileId: id, artist: id, title: "Track", status, createdAt,
    progress: status === "running" ? 59 : 0
  };
}

test("newest open recordings are listed above older ones, under an active Spotify import", () => {
  const jobs = [
    job("Anne Clark", "2026-01-01T00:00:00.000Z", "running"),
    job("Pink Turns Blue", "2026-03-01T00:00:00.000Z"),
    job("Depeche Mode", "2026-04-01T00:00:00.000Z")
  ];
  const items = musicDnaActivityItems(jobs, {
    running: true, received: 1, total: 4, status: "working"
  });
  assert.equal(items[0].kind, "spotify");
  assert.deepEqual(items.slice(1).map(item => item.label), [
    "Depeche Mode" + dash + "Track",
    "Pink Turns Blue" + dash + "Track",
    "Anne Clark" + dash + "Track"
  ]);
  const undated = musicDnaActivityItems([
    job("first", ""),
    job("second", "")
  ], null);
  assert.deepEqual(undated.map(item => item.profileId), ["first", "second"]);
});

function installActivityDocument(keys, scrollTop) {
  const height = 28;
  const state = { list: null, section: null };
  function build(nextKeys, nextScroll) {
    const list = {
      scrollTop: nextScroll,
      children: nextKeys.map((key, index) => ({
        dataset: { key },
        offsetTop: index * height,
        offsetHeight: height
      }))
    };
    const section = { id: "dna-activity" };
    Object.defineProperty(section, "outerHTML", {
      configurable: true,
      set(html) {
        const found = [...String(html).matchAll(/data-key="([^"]*)"/g)].map(match => match[1]);
        build(found, -1);
      }
    });
    state.list = list;
    state.section = section;
  }
  build(keys, scrollTop);
  globalThis.document = {
    querySelector(selector) {
      if (selector === "#dna-activity") return state.section;
      if (selector === "#dna-activity .dna-activity-list") return state.list;
      return null;
    }
  };
  return state;
}

test("refreshing in-progress keeps the scrolled recording in view", () => {
  const state = installActivityDocument(["mid", "old"], 28);
  paintDnaActivity({ data: {
    musicDnaOpenJobs: [
      job("old", "2026-01-01T00:00:00.000Z"),
      job("mid", "2026-02-01T00:00:00.000Z"),
      job("new", "2026-03-01T00:00:00.000Z")
    ],
    musicDnaSpotify: null
  } });
  assert.deepEqual(state.list.children.map(row => row.dataset.key), ["new", "mid", "old"]);
  assert.equal(state.list.scrollTop, 56);
});

test("refreshing in-progress stays at the top when the reader is already there", () => {
  const state = installActivityDocument(["old"], 0);
  paintDnaActivity({ data: {
    musicDnaOpenJobs: [
      job("old", "2026-01-01T00:00:00.000Z"),
      job("new", "2026-03-01T00:00:00.000Z")
    ],
    musicDnaSpotify: null
  } });
  assert.deepEqual(state.list.children.map(row => row.dataset.key), ["new", "old"]);
  assert.equal(state.list.scrollTop, 0);
});

test("a full Music DNA redraw restores activity scroll around the view replace", () => {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const render = source.slice(source.indexOf("function render()"), source.indexOf("function bindArtistPhotos"));
  const write = render.indexOf("view.innerHTML");
  const capture = render.indexOf("captureDnaActivityScroll");
  const restore = render.indexOf("restoreDnaActivityScroll");
  assert.ok(capture !== -1 && capture < write);
  assert.ok(restore !== -1 && restore > write);
});

test("refreshing in-progress keeps the old offset when the visible row is gone", () => {
  const state = installActivityDocument(["gone"], 28);
  paintDnaActivity({ data: {
    musicDnaOpenJobs: [job("stays", "2026-03-01T00:00:00.000Z")],
    musicDnaSpotify: null
  } });
  assert.equal(state.list.scrollTop, 28);
});
