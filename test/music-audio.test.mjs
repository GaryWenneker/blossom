import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { MusicDnaWorker } from "../src/music-dna-worker.mjs";
import { PCMAccumulator, validateAudio, measureAudio, measuredDNA } from "../src/music-audio.mjs";
import { StudioStore, sunoRecipe } from "../src/studio.mjs";
import { StudioReferences } from "../src/music-dna-studio.mjs";
import { OpenAIComposer } from "../src/providers/openai.mjs";
import { createAppServer } from "../src/server.mjs";

const audioReference = { artist: "The Cedar Quartet", title: "Signals in the Bay", sourceKind: "manual" };
const measured = { durationMs: 2000, sampleRate: 44100, channels: 2, codec: "mp3",
  analysisSampleRate: 8000, decodedSamples: 16000, peakDbfs: -3.01,
  rmsDbfs: -12.1, silenceFraction: 0.05 };

function fakeWav() {
  const audio = Buffer.alloc(16044);
  audio.write("RIFF", 0, "ascii"); audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8, "ascii"); audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write("data", 36, "ascii"); audio.writeUInt32LE(16000, 40);
  for (let i = 44; i < audio.length; i += 2)
    audio.writeInt16LE(Math.round(Math.sin((i - 44) / 2 / 12) * 15000), i);
  return audio;
}

test("Reference audio rejects wrong signatures and produces stable hashes", () => {
  const wav = fakeWav();
  const a = validateAudio(wav, "audio/wav");
  assert.equal(a.extension, "wav");
  assert.equal(a.sha256.length, 64);
  assert.equal(validateAudio(wav, "audio/wav").sha256, a.sha256);
  assert.throws(() => validateAudio(wav, "audio/mpeg"), /do not match/);
  assert.throws(() => validateAudio(Buffer.alloc(40), "audio/wav"), /between 128/);
});

test("PCM scanner measures real samples and handles split sample boundaries", () => {
  const pcm = new PCMAccumulator(8000);
  const samples = Buffer.alloc(8);
  samples.writeInt16LE(0, 0);
  samples.writeInt16LE(16384, 2);
  samples.writeInt16LE(-16384, 4);
  samples.writeInt16LE(0, 6);
  pcm.push(samples.subarray(0, 3));
  pcm.push(samples.subarray(3, 5));
  pcm.push(samples.subarray(5));
  const output = pcm.finish();
  assert.equal(output.decodedSamples, 4);
  assert.equal(output.peakDbfs, -6.02);
  assert.equal(output.silenceFraction, .5);
  assert.ok(output.rmsDbfs < -8 && output.rmsDbfs > -10);
  assert.throws(() => new PCMAccumulator().finish(), /empty PCM/);
});

test("Decoder safely invokes ffprobe/ffmpeg without shell and measures decoded signal", async () => {
  const commands = [];
  const pcm = Buffer.alloc(16000);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(4000, i);
  const runner = (command, args, options) => {
    commands.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    setImmediate(() => {
      const bytes = command === "ffprobe"
        ? Buffer.from(JSON.stringify({ format: { duration: "1.0" }, streams: [
          { codec_name: "pcm_s16le", channels: 1, sample_rate: "8000" }] }))
        : pcm;
      child.stdout.write(bytes);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  };
  const out = await measureAudio("/private/blossom/known.wav", { runner });
  assert.equal(out.durationMs, 1000);
  assert.equal(out.decodedSamples, 8000);
  assert.equal(out.channels, 1);
  assert.ok(out.peakDbfs < -18 && out.peakDbfs > -19);
  assert.equal(commands.length, 2);
  assert.ok(commands.every(c => c.options.shell === false));
  assert.ok(commands[1].args.includes("-nostdin"));
});

test("Worker only processes authorized local audio and stores measured rather than fabricated DNA", async () => {
  const store = new Store(":memory:");
  try {
    const dna = new MusicDNA(store);
    const metadata = dna.importBatch([{ artist: "Waiting", title: "No audio", sourceKind: "metadata" }]);
    const file = dna.importBatch([audioReference]);
    const attachment = dna.attachAudio(file[0].profileId, {
      filename: "33333333-3333-4333-8333-333333333333.wav", mime: "audio/wav",
      sha256: "a".repeat(64), byteSize: 2500, rightsConfirmed: true
    });
    assert.equal(attachment.rightsConfirmed, true);
    const open = dna.jobs("queued");
    assert.equal(open.find(job => job.profileId === metadata[0].profileId).hasAudio, false);
    assert.equal(open.find(job => job.profileId === file[0].profileId).hasAudio, true);
    assert.throws(() => dna.attachAudio(metadata[0].profileId, {
      filename: attachment.filename, mime: "audio/wav",
      sha256: "a".repeat(64), byteSize: 2500, rightsConfirmed: false }), /permitted/);
    let invoked = 0;
    const worker = new MusicDnaWorker(store, { analyzer: async path => {
      invoked++;
      assert.ok(path.endsWith(".wav"));
      return measured;
    } });
    const first = await worker.processOne();
    assert.equal(first.status, "completed");
    assert.equal(invoked, 1);
    assert.equal(dna.get(file[0].profileId).analysis.measurements.codec, "mp3");
    assert.equal(dna.get(file[0].profileId).analysis.instruments.length, 0);
    assert.equal(dna.get(file[0].profileId).analysis.bpm, null);
    assert.equal(await worker.processOne(), null);
    assert.equal(dna.jobs("queued").length, 1);
  } finally { store.close(); }
});

test("Studio links versioned reference traits without copying source names or lyrics", async () => {
  const store = new Store(":memory:");
  try {
    const dna = new MusicDNA(store), studio = new StudioStore(store);
    const refs = new StudioReferences(store, studio, dna);
    const ref = dna.create(audioReference);
    dna.saveAnalysis(ref.id, { analysisMethod: "Human listening review", analyzer: "Reviewer",
      bpm: 96,
      genres: ["Country rock"], moods: ["Reflective"],
      instruments: [{ name: "Flute", technique: "Legato fill", timbre: "Airy" }],
      vocals: { type: "male", delivery: "Expressive phrasing" },
      production: { texture: "Warm vintage analog" },
      sections: [{ startMs: 0, endMs: 5000, label: "Intro", instruments: ["Flute"] }] });
    const project = studio.save({ title: "Fresh Composition",
      article: "A thoughtful, original paragraph about the changing seasons and an old family garden, with room for a story and emotion." });
    assert.equal(refs.set(project.id, [{ profileId: ref.id, weight: 80 }]).length, 1);
    assert.match(refs.recipeStyle(project.id), /Flute/);
    assert.doesNotMatch(refs.recipeStyle(project.id), /Cedar|Signals in the Bay/);
    const recipe = sunoRecipe(studio.project(project.id), refs.recipeStyle(project.id));
    assert.match(recipe.style, /Warm vintage analog/);
    assert.throws(() => refs.set(project.id, [{ profileId: ref.id, weight: 101 }]), /weight/);
    assert.equal(refs.list(project.id).length, 1);
    assert.throws(() => refs.set(project.id, [{ profileId: ref.id }, { profileId: ref.id }]), /Duplicate/);
    let input;
    const composer = new OpenAIComposer({ key: "test", fetcher: async (_, options) => {
      input = JSON.parse(options.body).input;
      return { ok: true, json: async () => ({ output: [{ content: [{
        type: "output_text", text: JSON.stringify({ concept: "Original", lyrics: "[Verse] New",
          style: "Country rock", exclusions: [], moods: [], titles: ["Title"], coverPrompt: "",
          artistPhotoPrompt: "", suggestedGenre: "Country rock", rationale: "Original" })
      }] }] }) };
    } });
    await composer.generate({ ...studio.project(project.id), referenceDna: refs.generationContext(project.id) });
    assert.match(input, /referenceTraits/);
    assert.doesNotMatch(input, /The Cedar Quartet|Signals in the Bay/);
  } finally { store.close(); }
});

test("REST upload needs a signed-in user and rights approval, and links a queued asset", async t => {
  const tmp = await mkdtemp(join(tmpdir(), "blossom-dna-audio-"));
  const store = new Store(":memory:");
  const previous = process.env.BLOSSOM_REFERENCE_AUDIO_DIR;
  process.env.BLOSSOM_REFERENCE_AUDIO_DIR = tmp;
  const server = createAppServer({ store, provider: { available: () => false },
    password: "secure-test-password" });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    await new Promise(done => server.close(done));
    store.close();
    if (previous === undefined) delete process.env.BLOSSOM_REFERENCE_AUDIO_DIR;
    else process.env.BLOSSOM_REFERENCE_AUDIO_DIR = previous;
    await rm(tmp, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const login = await fetch(base + "/auth/login", { method: "POST",
    headers: { "content-type": "application/json", "x-blossom-request": "ui" },
    body: JSON.stringify({ username: "admin", password: "secure-test-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const create = await fetch(base + "/api/music-dna/profiles", { method: "POST",
    headers: { cookie, "content-type": "application/json", "x-blossom-request": "ui" },
    body: JSON.stringify(audioReference) });
  const profile = await create.json();
  assert.equal(create.status, 201);
  const path = "/api/music-dna/profiles/" + profile.id + "/upload-audio";
  const wav = fakeWav();
  const upload = (rights, authorized = true) => fetch(base + path, {
    method: "POST", headers: { ...(authorized ? { cookie } : {}),
      "content-type": "audio/wav", "x-blossom-request": "ui",
      ...(rights ? { "x-blossom-audio-rights": "confirmed" } : {}) }, body: wav
  });
  assert.equal((await upload(true, false)).status, 401);
  assert.equal((await upload(false)).status, 403);
  const ok = await upload(true);
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).sha256.length, 64);
  assert.equal((await upload(true)).status, 200);
  const jobs = await fetch(base + "/api/music-dna/jobs?status=queued", { headers: { cookie } });
  assert.equal((await jobs.json()).jobs.length, 1);
});
