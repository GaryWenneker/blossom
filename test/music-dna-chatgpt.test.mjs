import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Store } from "../src/storage.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { MusicDnaChatGpt, analysisFromReply, analysisFromYoutube, chooseYoutubeRecording, youtubeResultsFromHtml } from "../src/music-dna-chatgpt.mjs";
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

test("a YouTube search prefers the official video over a live clip and a lyrics upload", () => {
  const html = "ytInitialData = " + JSON.stringify({
    contents: [
      { videoRenderer: { videoId: "livevideo01", title: { runs: [{ text: "Rammstein - Deutschland (Live in Mexico City)" }] }, ownerText: { runs: [{ text: "Rammstein Official" }] } } },
      { videoRenderer: { videoId: "lyricsvid01", title: { runs: [{ text: "Rammstein - Deutschland (Lyrics)" }] }, ownerText: { runs: [{ text: "LyricFlow" }] } } },
      { videoRenderer: { videoId: "officialv01", title: { runs: [{ text: "Rammstein - Deutschland (Official Video)" }] }, ownerText: { runs: [{ text: "Rammstein Official" }] } } }
    ]
  }) + ";";
  const results = youtubeResultsFromHtml(html);
  assert.equal(results.length, 3);
  const chosen = chooseYoutubeRecording(results, "Rammstein", "Deutschland");
  assert.equal(chosen.videoId, "officialv01");
  const analysis = analysisFromYoutube(
    { artist: "Rammstein", title: "Deutschland" }, chosen);
  assert.equal(analysis.analysisMethod, "youtube-search");
  assert.equal(analysis.analyzer, "youtube");
  assert.equal(analysis.measurements, null);
  assert.equal(analysis.genres.length, 0);
  assert.match(analysis.summary, /https:\/\/www\.youtube\.com\/watch\?v=officialv01/);
  assert.match(analysis.summary, /not a measured analysis/);
  assert.equal(chooseYoutubeRecording(results, "Nobody", "Missing Song"), null);
  const concert = youtubeResultsFromHtml("ytInitialData = " + JSON.stringify({
    contents: [
      { videoRenderer: { videoId: "parisvid001", title: { runs: [{ text: "Rammstein: Paris - Du Hast (Official Video)" }] }, ownerText: { runs: [{ text: "Rammstein Official" }] } } },
      { videoRenderer: { videoId: "studioid001", title: { runs: [{ text: "Rammstein - Du Hast (Official Video)" }] }, ownerText: { runs: [{ text: "Rammstein Official" }] } } }
    ]
  }) + ";");
  assert.equal(chooseYoutubeRecording(concert, "Rammstein", "Du hast").videoId, "studioid001");
});

test("an unreadable ChatGPT reply is saved from the YouTube search instead of failing again", async () => {
  const library = dna();
  const [job] = library.importBatch([{
    artist: "Rammstein", title: "Deutschland", sourceKind: "metadata",
    sourceUrl: "https://open.spotify.com/track/0123456789012345678901"
  }]);
  const searches = [];
  const chat = new MusicDnaChatGpt(library, async () => "I cannot return JSON for this one.",
    async profile => {
      searches.push(profile.artist + " " + profile.title);
      return { videoId: "officialv01", title: "Rammstein - Deutschland (Official Video)", channel: "Rammstein Official" };
    });
  chat.start();
  await chat.done;
  assert.deepEqual(searches, ["Rammstein Deutschland"]);
  const saved = library.get(job.profileId);
  assert.equal(saved.analysis.analysisMethod, "youtube-search");
  assert.equal(saved.analysisVersion, 1);
  assert.equal(library.jobCounts().failed, 0);
  assert.equal(library.jobCounts().completed, 1);
});

test("a missing ChatGPT sign-in does not pretend a YouTube search analyzed the recording", async () => {
  const library = dna();
  library.importBatch([{ artist: "Rammstein", title: "Deutschland", sourceKind: "metadata", sourceUrl: "https://example.org/de" }]);
  let searched = false;
  const chat = new MusicDnaChatGpt(library, async () => {
    const error = new Error("Sign in to ChatGPT in Safari, then start the analysis again.");
    error.code = "chatgpt_login_required";
    throw error;
  }, async () => { searched = true; return { videoId: "officialv01", title: "x", channel: "y" }; });
  chat.start();
  await chat.done;
  assert.equal(searched, false);
  assert.equal(library.jobCounts().failed, 1);
  assert.equal(library.get(library.jobs("failed")[0].profileId).analysisVersion, 0);
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
    return JSON.stringify(reply);
  });
  assert.equal(chat.start().started, true);
  assert.equal(chat.start().started, false);
  await chat.done;
  assert.match(seen[0], /Test Orchestra — River Signals/);
  assert.equal(seen.length, 1);
  const saved = library.get(metadata[0].profileId);
  assert.equal(saved.analysis.analysisMethod, "chatgpt-catalog");
  assert.equal(saved.analysis.instruments[0].name, "Guitar");
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

test("the hidden Safari script reports progress and does not activate the browser", () => {
  const script = readFileSync(new URL("../scripts/chatgpt-safari-dna.applescript", import.meta.url), "utf8");
  assert.match(script, /writeProgress/);
  assert.match(script, /https:\/\/chatgpt\.com/);
  assert.doesNotMatch(script, /^\s*activate\b/m);
  assert.match(script, /miniaturized/);
  assert.match(script, /blossom-role/);
  assert.match(script, /main \.markdown/);
  assert.match(script, /previousReply/);
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
  const chat = new MusicDnaChatGpt(library, async () => JSON.stringify(reply));
  assert.equal(chat.start().started, true);
  await chat.done;
  assert.equal(library.get(created.profileId).analysis.summary, "A bright new-wave recording.");
  assert.equal(library.get(stuck.profileId).analysis.summary, "A bright new-wave recording.");
  assert.equal(library.jobs("running").length, 0);
  assert.equal(library.jobs("failed").length, 0);
});

test("an expired running job returns to the queue when jobs are listed", () => {
  const library = dna();
  const created = library.importBatch([{
    artist: "Bring Me The Horizon", title: "Dehumanized", sourceKind: "metadata",
    sourceUrl: "https://example.org/dehumanized"
  }])[0];
  const job = library.claimJob("chatgpt", { metadataOnly: true });
  library.setJobProgress(job.jobId, 80);
  library.db.prepare("UPDATE music_dna_jobs SET leased_until=? WHERE id=?")
    .run("2020-01-01T00:00:00.000Z", job.jobId);
  assert.equal(library.jobs("running").length, 0);
  const queued = library.jobs("queued");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].profileId, created.profileId);
  assert.equal(queued[0].progress, 0);
});

test("a live analysis lease stays running when jobs are listed", () => {
  const library = dna();
  library.importBatch([{
    artist: "Live", title: "Lease", sourceKind: "metadata", sourceUrl: "https://example.org/live"
  }]);
  const job = library.claimJob("chatgpt", { metadataOnly: true });
  library.setJobProgress(job.jobId, 40);
  const running = library.jobs("running");
  assert.equal(running.length, 1);
  assert.equal(running[0].progress, 40);
});

test("starting one recording analyzes that recording before an older queued one", async () => {
  const library = dna();
  const older = library.importBatch([{
    artist: "Older", title: "First", sourceKind: "metadata", sourceUrl: "https://example.org/older"
  }])[0];
  const chosen = library.importBatch([{
    artist: "Bring Me The Horizon", title: "Dehumanized", sourceKind: "metadata",
    sourceUrl: "https://example.org/chosen"
  }])[0];
  const seen = [];
  const chat = new MusicDnaChatGpt(library, async prompt => {
    seen.push(prompt);
    return JSON.stringify(reply);
  });
  assert.equal(chat.start(chosen.profileId).started, true);
  await chat.done;
  assert.match(seen[0], /Bring Me The Horizon — Dehumanized/);
  assert.match(seen[1], /Older — First/);
  assert.equal(library.get(older.profileId).analysis.summary, reply.summary);
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
        ? "REPLY\n{\"summary\":\"Bright.\"}\n"
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
      setTimeout(() => callback(null, "REPLY\n{\"summary\":\"Bright.\"}\n"), 700);
    }
  });
  const seen = [];
  const text = await browser.askHidden("Describe this known recording", value => seen.push(value));
  assert.match(text, /Bright/);
  assert.ok(seen.includes(35));
});
