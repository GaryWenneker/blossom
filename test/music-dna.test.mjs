import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { MusicDnaAPI } from "../src/music-dna-api.mjs";
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
test("a musical analysis without a BPM is not stored", () => {
  const store = new Store(":memory:"), dna = new MusicDNA(store);
  try {
    const ref = dna.create(reference);
    const without = { ...analysis };
    delete without.bpm;
    assert.throws(() => dna.saveAnalysis(ref.id, without), /BPM is required/);
    assert.equal(dna.get(ref.id).analysis, null);
    assert.equal(dna.versions(ref.id).length, 0);
  } finally { store.close(); }
});

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
    assert.equal(dna.count({ q: "River Signals" }), 2);
    assert.equal(dna.search({ q: "River Signals", limit: 1, offset: 1 }).length, 1);
    assert.equal(dna.count({ q: "River Signals" }), 2);
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
    assert.equal(dna.count({ q: "fingerpicked", instrument: "Flute", genre: "Southern rock" }), 1);
    assert.equal(dna.count({ mood: "Hopeful" }), 1);
    assert.equal(dna.count({ q: '"><(*' }), 1);
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
test("job listings name the recording they belong to", () => {
  const store = new Store(":memory:"), dna = new MusicDNA(store);
  try {
    const items = dna.importBatch([reference]);
    const queued = dna.jobs("queued");
    assert.equal(queued.length, 1);
    assert.equal(queued[0].artist, "Test Orchestra");
    assert.equal(queued[0].title, "River Signals");
    assert.equal(queued[0].profileId, items[0].profileId);
    assert.equal(queued[0].status, "queued");
    assert.equal(queued[0].hasAudio, false);
    assert.equal(queued[0].id, items[0].jobId);
    const more = [1, 2].map(n => dna.importBatch([{ ...reference, sourceUrl: "https://example.org/music/river-" + n }])[0]);
    assert.equal(more.length, 2);
    assert.equal(dna.jobs("queued", 2).length, 2);
    assert.equal(dna.jobs("queued").length, 3);
    assert.throws(() => dna.jobs("queued", 0), /Invalid limit/);
    assert.throws(() => dna.jobs("queued", 501), /Invalid limit/);
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
  const found = await search.json();
  assert.equal(found.results.length, 1);
  assert.equal(found.total, 1);
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


test("Bar-resolved Music DNA preserves per-instrument techniques, vocal layers, and production events", () => {
  const store=new Store(":memory:"),dna=new MusicDNA(store);
  try {
    const profile=dna.create({artist:"Bar Test",title:"Four Measure Groove",sourceKind:"metadata"});
    const detailed={...analysis,barBlocks:[
      {startBar:1,endBar:4,startMs:0,endMs:10909,status:"audio_observed",
        section:"Intro",instruments:[
          {name:"Electric bass",activity:"Pickup into a descending repeated riff",
            technique:"Fingerstyle",rhythm:"Syncopated sixteenth pickup",
            articulation:"Short muted notes",effects:["Compression"],evidence:"audio",confidence:0.86},
          {name:"Electric guitar",activity:"Bright offbeat clipped chords",
            technique:"Palm muting",evidence:"audio",confidence:0.77}],
        vocals:[],rhythm:{kick:"Downbeats 1 and 3",snare:"Backbeat 2 and 4",
          hiHat:"Closed eighths",groove:"Straight eighths"},
        harmony:{chords:["Cm","Gm"],movement:"Two-chord rotation"},
        production:{dynamics:"Soft intro",spatial:"Wide guitar right",transitions:"Short pickup"},
        notes:"Bass leads the motif",confidence:0.91},
      {startBar:5,endBar:8,startMs:10909,endMs:21818,status:"audio_observed",
        section:"Verse",instruments:[{name:"Electric bass",activity:"Repeated ostinato",
          evidence:"audio"}],vocals:[
          {singer:"Lead vocalist",layer:"lead",activity:"Verse phrase",
            delivery:"Legato mid-register",phrasing:"Slightly behind the beat",
            harmonies:"None",evidence:"human_verified",confidence:0.95}],
        rhythm:{groove:"Straight backbeat"},production:{dynamics:"Build toward hook"},
        confidence:0.90}
    ]};
    const saved=dna.saveAnalysis(profile.id,detailed);
    assert.equal(saved.analysis.schemaVersion,2);
    assert.equal(saved.analysis.barBlocks.length,2);
    assert.equal(saved.analysis.barBlocks[0].instruments[0].technique,"Fingerstyle");
    assert.equal(saved.analysis.barBlocks[1].vocals[0].phrasing,"Slightly behind the beat");
    assert.equal(dna.search({q:"Palm muting"}).length,1);
    assert.equal(dna.search({q:"behind the beat"}).length,1);
    assert.equal(dna.versions(profile.id).length,1);
    const metadataOnly=dna.create({artist:"Bar Test",title:"Awaiting Audio"});
    const pending=dna.saveAnalysis(metadataOnly.id,{...analysis,
      analysisMethod:"Published credits, not decoded audio",
      barBlocks:[{startBar:1,endBar:4,status:"not_analyzed",
        section:"Arrangement pending"}]});
    assert.equal(pending.analysis.barBlocks[0].instruments.length,0);
    assert.equal(pending.analysis.barBlocks[0].vocals.length,0);
    assert.equal(pending.analysis.barBlocks[0].startMs,null);
    assert.equal(pending.analysis.schemaVersion,2);
    assert.throws(()=>dna.saveAnalysis(metadataOnly.id,{...analysis,barBlocks:[
      {startBar:1,endBar:4,status:"not_analyzed",
       instruments:[{name:"Guitar",activity:"Riff",evidence:"audio"}]}
    ]}),/not_analyzed/);
    assert.throws(()=>dna.saveAnalysis(metadataOnly.id,{...analysis,barBlocks:[
      {startBar:1,endBar:4},{startBar:4,endBar:8}
    ]}),/non-overlapping/);
    assert.throws(()=>dna.saveAnalysis(metadataOnly.id,{...analysis,barBlocks:[
      {startBar:1,endBar:4,startMs:9000,endMs:8000}
    ]}),/boundaries/);
    assert.throws(()=>dna.saveAnalysis(metadataOnly.id,{...analysis,barBlocks:[
      {startBar:1,endBar:4,status:"audio_observed",
       vocals:[{singer:"Lead",evidence:"unsupported"}]}
    ]}),/evidence/);
  }finally{store.close();}
});
test("search and get report the latest job after analysis fails or succeeds", () => {
  const store = new Store(":memory:"), dna = new MusicDNA(store);
  try {
    const created = dna.importBatch([{
      artist: "Anne Clark", title: "Sleeper In Metropolis", sourceKind: "metadata",
      sourceUrl: "https://open.spotify.com/track/" + "a".repeat(22)
    }])[0];
    assert.equal(dna.get(created.profileId).jobStatus, "queued");
    const claimed = dna.claimJob("chatgpt", { metadataOnly: true });
    dna.completeJob(claimed.jobId, null, "ChatGPT did not finish a reply");
    const failed = dna.search({ q: "Sleeper" });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].analysis, null);
    assert.equal(failed[0].jobStatus, "failed");
    assert.equal(dna.get(created.profileId).jobStatus, "failed");
    const again = dna.importBatch([{
      artist: "Anne Clark", title: "Sleeper In Metropolis", sourceKind: "metadata",
      sourceUrl: "https://open.spotify.com/track/" + "a".repeat(22)
    }])[0];
    const retry = dna.claimJob("chatgpt", { metadataOnly: true });
    assert.equal(retry.jobId, again.jobId);
    dna.completeJob(retry.jobId, analysis);
    const saved = dna.search({ q: "Sleeper" })[0];
    assert.equal(saved.jobStatus, "completed");
    assert.equal(saved.analysis.genres[0], "Southern rock");
    assert.equal(dna.get(created.profileId).analysisVersion, 1);
    assert.equal(dna.get(created.profileId).jobStatus, "completed");
  } finally { store.close(); }
});

test("the catalog sorts by artist or title without changing the default order", () => {
  const store = new Store(":memory:"), dna = new MusicDNA(store);
  try {
    dna.create({ artist: "Zebra", title: "Alpha", sourceKind: "metadata" });
    dna.create({ artist: "Alpha", title: "Zebra", sourceKind: "metadata" });
    assert.deepEqual(dna.search({ sort: "artist", dir: "asc" }).map(row => row.artist), ["Alpha", "Zebra"]);
    assert.deepEqual(dna.search({ sort: "title", dir: "desc" }).map(row => row.title), ["Zebra", "Alpha"]);
    assert.throws(() => dna.search({ sort: "id" }), /Invalid sort/);
    assert.throws(() => dna.search({ sort: "artist", dir: "sideways" }), /Invalid sort direction/);
  } finally { store.close(); }
});

test("an explicit retry requeues a failed analysis after three attempts", () => {
  const store = new Store(":memory:"), dna = new MusicDNA(store);
  try {
    const created = dna.importBatch([{
      artist: "Animotion", title: "Obsession - 12 Inch Remix Version", sourceKind: "metadata"
    }])[0];
    const other = dna.importBatch([{
      artist: "Anne Clark", title: "Sleeper In Metropolis", sourceKind: "metadata"
    }])[0];
    for (const item of [created, other]) {
      const claimed = dna.claimJob("chatgpt", { metadataOnly: true, profileId: item.profileId });
      dna.completeJob(claimed.jobId, null, "ChatGPT reply was not a music analysis");
      dna.db.prepare("UPDATE music_dna_jobs SET attempts=3 WHERE id=?").run(claimed.jobId);
    }
    assert.equal(dna.claimJob("chatgpt", { metadataOnly: true, profileId: created.profileId }), null);
    const retried = dna.retryFailedAnalysis(created.profileId);
    assert.equal(retried.jobId, created.jobId);
    assert.equal(retried.status, "queued");
    const claimed = dna.claimJob("chatgpt", { metadataOnly: true, profileId: created.profileId });
    assert.equal(claimed.jobId, created.jobId);
    assert.equal(dna.jobs("failed").length, 1);
    assert.equal(dna.jobs("failed")[0].profileId, other.profileId);
    dna.completeJob(claimed.jobId, analysis);
    assert.equal(dna.dismissFailedJobs(created.profileId).removed, 0);
    assert.equal(dna.get(created.profileId).analysisVersion, 1);
    assert.equal(dna.dismissFailedJobs(other.profileId).removed, 1);
    assert.equal(dna.get(other.profileId).artist, "Anne Clark");
    assert.equal(dna.jobs("failed").length, 0);
    assert.equal(dna.jobs("completed").length, 1);
    const running = dna.importBatch([{ artist: "Bjork", title: "Human Behaviour", sourceKind: "metadata" }])[0];
    dna.claimJob("chatgpt", { metadataOnly: true, profileId: running.profileId });
    const stopped = dna.importBatch([{ artist: "De Staat", title: "Mona Lisa", sourceKind: "metadata" }])[0];
    const stoppedJob = dna.claimJob("chatgpt", { metadataOnly: true, profileId: stopped.profileId });
    dna.completeJob(stoppedJob.jobId, null, "ChatGPT reply was not a music analysis");
    assert.equal(dna.dismissFailedJobs().removed, 1);
    assert.equal(dna.jobs("running").length, 1);
    assert.equal(dna.jobs("failed").length, 0);
    assert.equal(dna.jobs("completed").length, 1);
  } finally { store.close(); }
});

test("Try again resets the failed job before ChatGPT starts", async () => {
  const store = new Store(":memory:"), dna = new MusicDNA(store);
  const started = [];
  const api = new MusicDnaAPI(dna, { chatgpt: { start(profileId) { started.push(profileId); return { started: true }; } } });
  try {
    const created = dna.importBatch([{
      artist: "Animotion", title: "Obsession - 12 Inch Remix Version", sourceKind: "metadata"
    }])[0];
    const claimed = dna.claimJob("chatgpt", { metadataOnly: true, profileId: created.profileId });
    dna.completeJob(claimed.jobId, null, "ChatGPT reply was not a music analysis");
    dna.db.prepare("UPDATE music_dna_jobs SET attempts=3 WHERE id=?").run(claimed.jobId);
    const req = {
      method: "POST",
      headers: { "content-type": "application/json" },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ profileId: created.profileId }));
      }
    };
    let status = 0, payload = null;
    const res = { writeHead(code) { status = code; }, end(text) { payload = JSON.parse(text); } };
    await api.handle(req, res, "/api/music-dna/jobs/start", new URLSearchParams());
    assert.equal(status, 202);
    assert.deepEqual(started, [created.profileId]);
    assert.equal(payload.started, true);
    assert.equal(dna.jobs("queued")[0].id, claimed.jobId);
    assert.equal(dna.jobs("queued")[0].attempts, 0);
    const other = dna.importBatch([{ artist: "Anne Clark", title: "Sleeper In Metropolis", sourceKind: "metadata" }])[0];
    const otherJob = dna.claimJob("chatgpt", { metadataOnly: true, profileId: other.profileId });
    dna.completeJob(otherJob.jobId, null, "ChatGPT reply was not a music analysis");
    const dismiss = {
      method: "POST",
      headers: { "content-type": "application/json" },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ profileId: other.profileId })); }
    };
    await api.handle(dismiss, res, "/api/music-dna/jobs/dismiss", new URLSearchParams());
    assert.equal(payload.removed, 1);
    assert.equal(dna.jobs("failed").length, 0);
    assert.equal(dna.jobs("queued")[0].id, claimed.jobId);
    assert.equal(dna.get(other.profileId).title, "Sleeper In Metropolis");
  } finally { store.close(); }
});
