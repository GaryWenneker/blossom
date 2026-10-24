import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashForPage, pageFromHash, routeFromClick } from "../public/route.js";

const pages = ["studio", "music-dna", "overview", "artists", "tracks", "releases",
  "intelligence", "genres", "connections", "compliance"];

test("a known hash restores that page and anything else opens News to Song", () => {
  for (const page of pages) assert.equal(pageFromHash("#" + page), page);
  assert.equal(pageFromHash(""), "studio");
  assert.equal(pageFromHash("#"), "studio");
  assert.equal(pageFromHash("#assistant"), "studio");
  assert.equal(pageFromHash("#music-dna/extra"), "studio");
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
