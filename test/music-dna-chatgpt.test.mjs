import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Store } from "../src/storage.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { MusicDnaChatGpt, analysisFromReply, dnaPrompt } from "../src/music-dna-chatgpt.mjs";
import { ChatGptLyricsBrowser } from "../src/chatgpt-playwright.mjs";

const reply = {
  genres: ["New wave"], moods: ["Driving"],
  instruments: [{ name: "Guitar", technique: "Chorus", role: "Rhythm" }],
  vocals: { type: "male", delivery: "Spoken" },
  production: { era: "1980s", texture: "Bright" },
  summary: "A bright new-wave recording.", bpm: 120,
  measurements: { codec: "mp3" }
};

function dna() {
  return new MusicDNA(new Store(":memory:"));
}

test("a ChatGPT reply becomes catalog DNA and cannot claim an audio measurement", () => {
  const analysis = analysisFromReply("note\n```json\n" + JSON.stringify(reply) + "\n```");
  assert.deepEqual(analysis.genres, ["New wave"]);
  assert.equal(analysis.analysisMethod, "chatgpt-catalog");
  assert.equal(analysis.analyzer, "chatgpt");
  assert.equal(analysis.measurements, null);
  assert.equal(analysis.bpm, 120);
  assert.throws(() => analysisFromReply("no json here"), /not a music analysis/);
});

test("a catalog analysis is rejected unless it includes a BPM from 20 to 350", () => {
  const without = { ...reply };
  delete without.bpm;
  assert.throws(() => analysisFromReply(JSON.stringify(without)), /omitted a BPM/);
  assert.throws(() => analysisFromReply(JSON.stringify({ ...reply, bpm: null })), /omitted a BPM/);
  assert.throws(() => analysisFromReply(JSON.stringify({ ...reply, bpm: "fast" })), /omitted a BPM/);
  assert.throws(() => analysisFromReply(JSON.stringify({ ...reply, bpm: 10 })), /omitted a BPM/);
  assert.throws(() => analysisFromReply(JSON.stringify({ ...reply, bpm: 400 })), /omitted a BPM/);
  assert.throws(() => analysisFromReply(JSON.stringify({ ...reply, bpm: true })), /omitted a BPM/);
  assert.throws(() => analysisFromReply(JSON.stringify({ ...reply, bpm: "" })), /omitted a BPM/);
  assert.equal(analysisFromReply(JSON.stringify({ ...reply, bpm: 98.6 })).bpm, 98.6);
  assert.equal(analysisFromReply(JSON.stringify({ ...reply, bpm: 20 })).bpm, 20);
  assert.equal(analysisFromReply(JSON.stringify({ ...reply, bpm: 350 })).bpm, 350);
  assert.equal(analysisFromReply(JSON.stringify({ ...reply, bpm: "120" })).bpm, 120);
  const prompt = dnaPrompt({ artist: "Björk", title: "Human Behaviour" });
  assert.match(prompt, /bpm \(required number from 20 to 350, never null\)/);
  assert.doesNotMatch(prompt, /or null/);
});

test("starting analysis reports callback percents and saves one metadata recording", async () => {
  const store = new Store(":memory:");
  const library = new MusicDNA(store);
  const audio = library.importBatch([{ artist: "With", title: "File", sourceKind: "metadata", sourceUrl: "https://example.org/audio" }]);
  library.attachAudio(audio[0].profileId, {
    filename: "33333333-3333-4333-8333-333333333333.wav", mime: "audio/wav",
    sha256: "a".repeat(64), byteSize: 2500, rightsConfirmed: true
  });
  const metadata = library.importBatch([{ artist: "Test Orchestra", title: "River Signals", sourceKind: "metadata", sourceUrl: "https://example.org/river" }]);
  const seen = [];
  const chat = new MusicDnaChatGpt(library, async (prompt, report) => {
    seen.push(prompt);
    report(40);
    assert.equal(library.jobs("running")[0].progress, 40);
    report(70);
    return "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111\n" + JSON.stringify(reply);
  });
  assert.equal(chat.start().started, true);
  assert.equal(chat.start().started, false);
  await chat.done;
  assert.match(seen[0], /Test Orchestra — River Signals/);
  assert.equal(seen.length, 1);
  const saved = library.get(metadata[0].profileId);
  assert.equal(saved.analysis.analysisMethod, "chatgpt-catalog");
  assert.equal(saved.analysis.instruments[0].name, "Guitar");
  assert.equal(saved.analysis.chatSession.url, "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111");
  assert.equal(saved.analysis.chatSession.provider, "chatgpt");
  assert.equal(library.jobs("queued").length, 1);
  assert.equal(library.jobs("queued")[0].profileId, audio[0].profileId);
  assert.equal(library.jobs("completed")[0].progress, 100);
});

test("a missing ChatGPT sign-in stops the queue and leaves the later recording queued", async () => {
  const library = dna();
  library.importBatch([{ artist: "First", title: "One", sourceKind: "metadata", sourceUrl: "https://example.org/one" }]);
  library.importBatch([{ artist: "Second", title: "Two", sourceKind: "metadata", sourceUrl: "https://example.org/two" }]);
  let calls = 0;
  const chat = new MusicDnaChatGpt(library, async () => {
    calls += 1;
    const error = new Error("Sign in to ChatGPT in Safari, then start the analysis again.");
    error.code = "chatgpt_login_required";
    throw error;
  });
  chat.start();
  await chat.done;
  assert.equal(calls, 1);
  assert.equal(library.jobs("failed").length, 1);
  assert.equal(library.jobs("queued").length, 1);
  assert.equal(library.jobs("queued")[0].title, "Two");
});

test("the Safari analysis script opens a visible ChatGPT window", () => {
  const script = readFileSync(new URL("../scripts/chatgpt-safari-dna.applescript", import.meta.url), "utf8");
  assert.match(script, /writeProgress/);
  assert.match(script, /https:\/\/chatgpt\.com/);
  assert.match(script, /^\s*activate\b/m);
  assert.match(script, /set miniaturized of front window to false/);
  assert.doesNotMatch(script, /set miniaturized of front window to true/);
  assert.match(script, /blossom-role/);
  assert.match(script, /main \.markdown/);
  assert.match(script, /previousReply/);
  assert.match(script, /uuidgen/);
  assert.match(script, /blossom-dna-session/);
  assert.match(script, /make new document/);
  assert.doesNotMatch(script, /foundDna/);
});

test("a failed catalog analysis is retried and then saved", async () => {
  const library = dna();
  const created = library.importBatch([{
    artist: "Anne Clark", title: "Sleeper In Metropolis", sourceKind: "metadata",
    sourceUrl: "https://example.org/sleeper"
  }])[0];
  const claimed = library.claimJob("chatgpt", { metadataOnly: true });
  library.completeJob(claimed.jobId, null, "ChatGPT did not finish a reply");
  const stuck = library.importBatch([{
    artist: "Pink Turns Blue", title: "I coldly stare out", sourceKind: "metadata",
    sourceUrl: "https://example.org/cold"
  }])[0];
  library.claimJob("chatgpt", { metadataOnly: true });
  assert.equal(library.get(created.profileId).analysis, null);
  assert.equal(library.jobs("running").length, 1);
  const chat = new MusicDnaChatGpt(library, async () =>
    "https://chatgpt.com/c/44444444-4444-4444-8444-444444444444\n" + JSON.stringify(reply));
  assert.equal(chat.start().started, true);
  await chat.done;
  assert.equal(library.get(created.profileId).analysis.summary, "A bright new-wave recording.");
  assert.equal(library.get(created.profileId).analysis.chatSession.url,
    "https://chatgpt.com/c/44444444-4444-4444-8444-444444444444");
  assert.equal(library.get(stuck.profileId).analysis.summary, "A bright new-wave recording.");
  assert.equal(library.jobs("running").length, 0);
  assert.equal(library.jobs("failed").length, 0);
});

test("lyric generation stays available while a DNA analysis is running", async () => {
  let releaseDna = () => {};
  let releaseLyrics = () => {};
  const dnaGate = new Promise(resolve => { releaseDna = resolve; });
  const lyricsGate = new Promise(resolve => { releaseLyrics = resolve; });
  const started = [];
  const browser = new ChatGptLyricsBrowser({
    transport: "system", browserApp: "Safari",
    runner(script, _args, _options, callback) {
      started.push(script);
      const gate = script.includes("chatgpt-safari-dna") ? dnaGate : lyricsGate;
      gate.then(() => callback(null, script.includes("chatgpt-safari-dna")
        ? "REPLY\nhttps://chatgpt.com/c/55555555-5555-4555-8555-555555555555\n{\"summary\":\"Bright.\"}\n"
        : "REPLY\n{\"lyrics\":\"Verse\",\"concept\":\"A song\",\"style\":\"Pop\",\"exclusions\":[],\"moods\":[],\"titles\":[],\"coverPrompt\":\"\",\"artistPhotoPrompt\":\"\",\"suggestedGenre\":\"\",\"rationale\":\"\"}\n"));
    }
  });
  const analysis = browser.askHidden("Describe this known recording");
  const lyrics = browser.generate({ article: "word ".repeat(40) });
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(started.length, 2);
  } finally {
    releaseDna();
    releaseLyrics();
  }
  assert.match(await analysis, /Bright/);
  assert.equal((await lyrics).lyrics, "Verse");
});

test("Safari progress callbacks reach the reporter before the reply returns", async () => {
  const browser = new ChatGptLyricsBrowser({
    transport: "system", browserApp: "Safari",
    runner(script, args, _options, callback) {
      assert.match(script, /chatgpt-safari-dna\.applescript$/);
      assert.equal(args[0], "Safari");
      assert.match(args[1], /^"Describe this known recording/);
      writeFileSync(args[2], "35\n");
      setTimeout(() => callback(null, "REPLY\nhttps://chatgpt.com/c/66666666-6666-4666-8666-666666666666\n{\"summary\":\"Bright.\"}\n"), 700);
    }
  });
  const seen = [];
  const text = await browser.askHidden("Describe this known recording", value => seen.push(value));
  assert.match(text, /Bright/);
  assert.ok(seen.includes(35));
});

test("a ChatGPT reply without its own conversation is not saved", async () => {
  const library = dna();
  const created = library.importBatch([{
    artist: "De Staat", title: "Mona Lisa", sourceKind: "metadata",
    sourceUrl: "https://example.org/mona"
  }])[0];
  const chat = new MusicDnaChatGpt(library, async () => JSON.stringify(reply));
  chat.start();
  await chat.done;
  assert.equal(library.get(created.profileId).analysis, null);
  assert.equal(library.jobs("failed").length, 1);
});

test("starting one queued recording leaves the other recording queued", async () => {
  const library = dna();
  const first = library.importBatch([{
    artist: "A", title: "One", sourceKind: "metadata", sourceUrl: "https://example.org/one"
  }])[0];
  const second = library.importBatch([{
    artist: "B", title: "Two", sourceKind: "metadata", sourceUrl: "https://example.org/two"
  }])[0];
  let calls = 0;
  const chat = new MusicDnaChatGpt(library, async () => {
    calls += 1;
    return "https://chatgpt.com/c/33333333-3333-4333-8333-333333333333\n" + JSON.stringify(reply);
  });
  chat.start(second.profileId);
  await chat.done;
  assert.equal(calls, 1);
  assert.equal(library.get(second.profileId).analysisVersion, 1);
  assert.equal(library.get(second.profileId).analysis.chatSession.url,
    "https://chatgpt.com/c/33333333-3333-4333-8333-333333333333");
  assert.equal(library.get(first.profileId).analysis, null);
  assert.equal(library.jobs("queued")[0].profileId, first.profileId);
});

test("a second analysis keeps its own ChatGPT conversation and the earlier version", async () => {
  const library = dna();
  const created = library.importBatch([{
    artist: "De Staat", title: "Mona Lisa", sourceKind: "metadata",
    sourceUrl: "https://example.org/mona-lisa"
  }])[0];
  const urls = [
    "https://chatgpt.com/c/11111111-1111-4111-8111-111111111111",
    "https://chatgpt.com/c/22222222-2222-4222-8222-222222222222"
  ];
  let n = 0;
  const chat = new MusicDnaChatGpt(library, async () => urls[n++] + "\n" + JSON.stringify(reply));
  chat.start();
  await chat.done;
  const again = library.queueAnalysis(created.profileId);
  assert.equal(again.queued, true);
  chat.start(created.profileId);
  await chat.done;
  const current = library.get(created.profileId);
  assert.equal(current.analysisVersion, 2);
  assert.equal(current.analysis.chatSession.url, urls[1]);
  assert.deepEqual(library.versions(created.profileId).map(item => item.chatUrl), [urls[1], urls[0]]);
});
