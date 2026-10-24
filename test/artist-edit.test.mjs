import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { enrichProposedArtists, PROPOSED_ARTISTS } from "../src/proposed-artists.mjs";
import { createAppServer } from "../src/server.mjs";

const base = { name:"Mira Solenne", genre:"Alternative pop", language:"en", countries:["GB"], voice:"female", dna:"A short original note about muted guitar." };

test("editing an artist keeps the same id, accepts listed countries, and records the name review", () => {
  const store = new Store(":memory:");
  try {
    const created = store.addArtist(base);
    assert.equal(created.identityVerified, false);
    const updated = store.updateArtist(created.id, {
      ...base, countries:["GB","NL"], dna:"A longer original arrangement note for the same fictional artist.", identityVerified:true
    });
    assert.equal(updated.id, created.id);
    assert.deepEqual(updated.countries, ["GB","NL"]);
    assert.equal(updated.identityVerified, true);
    assert.equal(store.artist(created.id).dna, updated.dna);
    assert.throws(() => store.updateArtist(created.id, { ...base, countries:["ZZ"] }), /country list/);
    assert.throws(() => store.updateArtist("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", base), /not found/);
  } finally { store.close(); }
});

test("proposed artists gain Evan-length arrangement notes without replacing a custom note", () => {
  const store = new Store(":memory:");
  try {
    for (const artist of PROPOSED_ARTISTS) {
      assert.ok(artist.dna.length >= 280, artist.name);
      assert.match(artist.dna, /BPM|no beat/);
      store.addArtist({ ...artist, dna:artist.previousDna });
    }
    store.addArtist({ name:"Kept Custom", genre:"Country Pop", language:"en", countries:["US"], voice:"male", dna:"A custom note that must survive enrichment." });
    const result = enrichProposedArtists(store);
    assert.equal(result.enriched, PROPOSED_ARTISTS.length);
    assert.equal(result.added, 0);
    for (const artist of PROPOSED_ARTISTS) {
      assert.equal(store.artists().find(item => item.name === artist.name).dna, artist.dna);
    }
    assert.equal(store.artists().find(item => item.name === "Kept Custom").dna, "A custom note that must survive enrichment.");
    assert.equal(enrichProposedArtists(store).enriched, 0);
  } finally { store.close(); }
});

test("the artist page offers country choices, an editable card, and a plain name-review label", async () => {
  const ui = await readFile(new URL("../public/artists.js", import.meta.url), "utf8")
    + await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(ui, /name="countries"/);
  assert.match(ui, /Edit artist/);
  assert.match(ui, /Name not reviewed/);
  assert.match(ui, /Name reviewed/);
  assert.match(ui, /getAttribute\?\.\("id"\)/);
  assert.doesNotMatch(await readFile(new URL("../public/app.js", import.meta.url), "utf8"), /event\.target\.id==="artist-form"/);
  assert.doesNotMatch(ui, /Name unverified/);
  assert.doesNotMatch(ui, /ISO codes/);
});

test("an authenticated artist edit updates the saved card", async t => {
  const store = new Store(":memory:");
  const server = createAppServer({ store, provider:{ available:() => false }, password:"long-test-password" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { await new Promise(done => server.close(done)); store.close(); });
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  const post = (path, payload, cookie) => fetch(baseUrl + path, {
    method:"POST", headers:{ "content-type":"application/json", "x-blossom-request":"ui", ...(cookie ? { cookie } : {}) },
    body:JSON.stringify(payload)
  });
  const login = await post("/auth/login", { username:"admin", password:"long-test-password" });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const created = await post("/api/artists", base, cookie);
  assert.equal(created.status, 201);
  const artist = await created.json();
  const denied = await post("/api/artists/" + artist.id, { ...base, identityVerified:true });
  assert.equal(denied.status, 401);
  const saved = await post("/api/artists/" + artist.id, { ...base, countries:["NL"], identityVerified:true, dna:"Reviewed arrangement note for this fictional artist." }, cookie);
  assert.equal(saved.status, 200);
  const body = await saved.json();
  assert.equal(body.id, artist.id);
  assert.equal(body.identityVerified, true);
  assert.deepEqual(body.countries, ["NL"]);
});
