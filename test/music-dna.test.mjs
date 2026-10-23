import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { createAppServer } from "../src/server.mjs";

const reference = { artist: "Test Orchestra", title: "River Signals",
  sourceKind: "metadata", sourceUrl: "https://example.org/music/river-signals", releaseYear: 1978 };
const analysis = {
  analysisMethod: "human-reviewed audio observations", analyzer: "test fixture",
  confidence: 0.92, bpm: 88, durationMs: 240000,
  genres: ["Southern rock", "Country blues"], moods: ["Reflective"],
  instruments: [
    { name: "Acoustic guitar", technique: "Fingerpicked arpeggios", timbre: "Warm, woody", role: "Rhythm", confidence: 0.9 },
    { name: "Flute", technique: "Legato fills", timbre: "Airy", role: "Hook" }
  ],
  vocals: { type: "male", timbre: "Raspy", delivery: "Blues phrasing" },
  production: { era: "1970s", texture: "Warm analog", effects: ["Tape saturation"] },
  sections: [{ startMs: 0, endMs: 12000, label: "Intro",
    instruments: ["Flute", "Acoustic guitar"], techniques: ["Legato fills"], notes: "Soft entry" },
    { startMs: 12000, endMs: 60000, label: "Verse", instruments: ["Guitar"],
      techniques: ["Fingerpicked arpeggios"] }],
  summary: "Airy flute introduction followed by acoustic fingerpicked guitar and blues vocals"
};
test("References deduplicate verified identifiers but not identical artist/title alone", () => {
  const store = new Store(":memory:"), dna = new MusicDNA(store);
  try {
    const first = dna.create(reference);
    assert.equal(first.analysisVersion, 0);
    const duplicate = dna.create({ ...reference, title: "Alternate metadata" });
    assert.equal(duplicate.id, first.id);
    assert.equal(duplicate.duplicate, true);
    const another = dna.create({ artist: reference.artist, title: reference.title, sourceKind: "manual" });
    assert.notEqual(another.id, first.id);
    assert.equal(dna.search({ q: "River Signals" }).length, 2);
    assert.throws(() => dna.create({ artist: "Bad", title: "URL", sourceUrl: "file:///etc/passwd" }), /HTTP/);
  } finally { store.close(); }
});
test("Versioned analyses preserve musical segments and index free text and facets", () => {
  const store = new Store(":memory:"), dna = new MusicDNA(store);
  try {
    const ref = dna.create(reference);
    const result = dna.saveAnalysis(ref.id, analysis);
    assert.equal(result.analysisVersion, 1);
    assert.equal(result.analysis.sections[0].label, "Intro");
    assert.equal(dna.search({ q: "fingerpicked", instrument: "Flute", genre: "Southern rock" }).length, 1);
    assert.equal(dna.search({ q: "fingerpicked", instrument: "Synthesizer" }).length, 0);
    assert.equal(dna.search({ vocal: "male", mood: "Reflective" }).length, 1);
    assert.equal(dna.search({ q: '"><(*' }).length, 1);
    dna.saveAnalysis(ref.id, { ...analysis, bpm: 92, moods: ["Hopeful"] });
    assert.equal(dna.get(ref.id).analysis.bpm, 92);
    assert.equal(dna.versions(ref.id).length, 2);
    assert.equal(dna.search({ mood: "Reflective" }).length, 0);
    assert.equal(dna.search({ mood: "Hopeful" }).length, 1);
    assert.throws(() => dna.saveAnalysis(ref.id, { ...analysis, sections: [
      { startMs: 700, endMs: 500, label: "Invalid" }] }), /time boundaries/);
  } finally { store.close(); }
});
test("Batch queue deduplicates pending work and processes claimed jobs", () => {
  const store = new Store(":memory:"), dna = new MusicDNA(store);
  try {
    const items = dna.importBatch([reference, reference]);
    assert.equal(items.length, 2);
    assert.equal(items[0].profileId, items[1].profileId);
    assert.equal(items[0].jobId, items[1].jobId);
    assert.equal(dna.jobs("queued").length, 1);
    const job = dna.claimJob("local-worker");
    assert.equal(job.jobId, items[0].jobId);
    assert.equal(dna.jobs("running").length, 1);
    assert.equal(dna.claimJob(), null);
    const completed = dna.completeJob(job.jobId, analysis);
    assert.equal(completed.status, "completed");
    assert.equal(dna.jobs("completed").length, 1);
    assert.equal(dna.get(items[0].profileId).analysisVersion, 1);
    assert.throws(() => dna.completeJob(job.jobId, analysis), /claimed/);
    assert.throws(() => dna.importBatch(new Array(501).fill(reference)), /1–500/);
  } finally { store.close(); }
});
test("REST auth, MCP read/write token scopes and JSON-RPC tools are enforced", async t => {
  const existingRead = process.env.BLOSSOM_MCP_READ_TOKEN;
  const existingWrite = process.env.BLOSSOM_MCP_WRITE_TOKEN;
  process.env.BLOSSOM_MCP_READ_TOKEN = "read-token-longer-than-thirty-two-characters";
  process.env.BLOSSOM_MCP_WRITE_TOKEN = "write-token-longer-than-thirty-two-characters";
  const store = new Store(":memory:");
  const server = createAppServer({ store, provider: { available: () => false }, password: "test-password-for-blossom" });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    await new Promise(done => server.close(done));
    store.close();
    if (existingRead === undefined) delete process.env.BLOSSOM_MCP_READ_TOKEN;
    else process.env.BLOSSOM_MCP_READ_TOKEN = existingRead;
    if (existingWrite === undefined) delete process.env.BLOSSOM_MCP_WRITE_TOKEN;
    else process.env.BLOSSOM_MCP_WRITE_TOKEN = existingWrite;
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const rest = (path, payload, cookie) => fetch(base + path, {
    method: payload === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { cookie } : {}), ...(payload === undefined ? {} : {
      "content-type": "application/json", "x-blossom-request": "ui" }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  assert.equal((await rest("/api/music-dna/search")).status, 401);
  const login = await rest("/auth/login", { username: "admin", password: "test-password-for-blossom" });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const create = await rest("/api/music-dna/profiles", reference, cookie);
  assert.equal(create.status, 201);
  const saved = await create.json();
  assert.equal((await rest("/api/music-dna/profiles/" + saved.id + "/analyses", analysis, cookie)).status, 201);
  const search = await rest("/api/music-dna/search?q=flute&instrument=Flute", undefined, cookie);
  assert.equal((await search.json()).results.length, 1);
  const rpc = (token, method, params = {}) => fetch(base + "/mcp", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  assert.equal((await rpc("incorrect", "tools/list")).status, 401);
  const read = await (await rpc(process.env.BLOSSOM_MCP_READ_TOKEN, "tools/list")).json();
  assert.ok(read.result.tools.some(tool => tool.name === "music_dna_search"));
  assert.ok(!read.result.tools.some(tool => tool.name === "music_dna_save_analysis"));
  const denied = await (await rpc(process.env.BLOSSOM_MCP_READ_TOKEN, "tools/call",
    { name: "music_dna_add_reference", arguments: reference })).json();
  assert.equal(denied.error.code, -32602);
  const wrote = await (await rpc(process.env.BLOSSOM_MCP_WRITE_TOKEN, "tools/call", {
    name: "music_dna_add_reference", arguments: reference })).json();
  assert.equal(JSON.parse(wrote.result.content[0].text).id, saved.id);
});
