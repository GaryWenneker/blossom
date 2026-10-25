import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashForPage, pageFromHash, playerRoute, routeFromClick } from "../public/route.js";

const pages = ["studio", "music-dna", "overview", "artists", "tracks", "releases",
  "intelligence", "genres", "connections", "compliance"];

test("a known hash restores that page and anything else opens News to Song", () => {
  for (const page of pages) assert.equal(pageFromHash("#" + page), page);
  assert.equal(pageFromHash(""), "studio");
  assert.equal(pageFromHash("#"), "studio");
  assert.equal(pageFromHash("#assistant"), "studio");
  assert.equal(pageFromHash("#music-dna/extra"), "studio");
  assert.equal(pageFromHash("#playerish"), "studio");
  assert.equal(pageFromHash("#player"), "player");
  assert.equal(pageFromHash("#player/album/1111111111111111111111"), "player");
});

test("player hashes resolve to home, library views, and search", () => {
  const id = "1111111111111111111111";
  assert.deepEqual(playerRoute("#player"), { view: "home" });
  assert.deepEqual(playerRoute("#player/collection/tracks"), { view: "liked", offset: 0 });
  assert.deepEqual(playerRoute("#player/collection/tracks?offset=50"), { view: "liked", offset: 50 });
  assert.deepEqual(playerRoute("#player/playlist/" + id), { view: "playlist", id, offset: 0 });
  assert.deepEqual(playerRoute("#player/artist/" + id), { view: "artist", id });
  assert.deepEqual(playerRoute("#player/album/" + id + "?offset=50"), { view: "album", id, offset: 50 });
  assert.deepEqual(playerRoute("#player/search?q=the%20fixx"), { view: "search", q: "the fixx" });
  const catalogId = "11111111-1111-1111-1111-111111111111";
  assert.deepEqual(playerRoute("#player/catalog/artist/" + catalogId), { view: "catalog-artist", id: catalogId });
  assert.deepEqual(playerRoute("#player/catalog/album/" + catalogId), { view: "catalog-album", id: catalogId });
  assert.deepEqual(playerRoute("#player/catalog/artist/not-a-uuid"), { view: "invalid" });
  assert.deepEqual(playerRoute("#player/nope"), { view: "invalid" });
  assert.deepEqual(playerRoute("#player/album/not-an-id"), { view: "invalid" });
  assert.equal(playerRoute("#studio"), null);
  assert.equal(hashForPage("player"), "#player");
  assert.deepEqual(routeFromClick({ tab: "player" }), { page: "player", hash: "#player" });
});

test("each page has one hash and studio pane tabs are not pages", () => {
  assert.equal(hashForPage("music-dna"), "#music-dna");
  assert.equal(hashForPage("assistant"), "");
  assert.deepEqual(routeFromClick({ tab: "music-dna" }), { page: "music-dna", hash: "#music-dna" });
  assert.equal(routeFromClick({ tab: "tracks", action: "studio-bottom-tab" }), null);
  assert.equal(routeFromClick({ tab: "assistant", action: "studio-bottom-tab" }), null);
  assert.equal(routeFromClick({ tab: "nope" }), null);
  assert.equal(routeFromClick({}), null);
});

test("the dashboard script can load the route module", () => {
  const server = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(server, /"\/route\.js":"route\.js"/);
  assert.match(app, /pageFromHash\(location\.hash\)/);
  assert.match(app, /hashchange/);
  assert.match(app, /music-dna\/jobs\?status=queued&limit=200/);
  assert.match(app, /music-dna\/jobs\?status=running&limit=200/);
});
