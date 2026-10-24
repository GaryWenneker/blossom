import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { Store } from "../src/storage.mjs";
import { DomainError } from "../src/domain.mjs";
import { StudioStore } from "../src/studio.mjs";
import { createAppServer } from "../src/server.mjs";
import { draftArtistFromRoster } from "../src/artist-draft.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { applyArtistDraft, guardArtistDraftPick, artistDraftButtonEnabled, setArtistDraftMode, recordingSearchChoices, recordingChoiceMarkup, draftRecordingSearchPath, recordingChoicesForDraft, draftSelection, mergeArtistDna } from "../public/artists.js";

const idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const idB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const idC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function artist(overrides = {}) {
  return {
    id: idA, name: "Mira Solenne", genre: "Alternative pop", language: "en",
    countries: ["GB", "US"], voice: "female", dna: "Close female lead, 86 BPM.",
    ...overrides
  };
}

function project(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    artistId: idA,
    title: "Night Window",
    updatedAt: "2026-02-02T00:00:00.000Z",
    parameters: { genre: "Alternative pop", additionalStyles: ["intimate"] },
    result: {
      style: "soft drum machine", moods: ["reflective"], suggestedGenre: "alt pop",
      lyrics: "secret chorus", titles: ["Night Window"]
    },
    ...overrides
  };
}

const twoArtistDna = [
  "Musical traits for a new fictional artist. Do not copy a source name, lyric, melody, or vocal identity.",
  "",
  "Genre: Alternative pop / Latin pop fusion",
  "Voice: mixed",
  "Languages: en, es",
  "",
  "Traits 1",
  "DNA: Close female lead, 86 BPM.",
  "Songs:",
  "- genre Alternative pop; additional styles intimate; style soft drum machine; moods reflective; suggested genre alt pop",
  "",
  "Traits 2",
  "DNA: Nylon guitar, 102 BPM.",
  "Songs:",
  "- genre Latin pop; moods warm"
].join("\n");

test("two artists with different genres produce one editable draft", () => {
  const artists = [
    artist(),
    artist({
      id: idB, name: "Casa Niebla", genre: "Latin pop fusion", language: "es",
      countries: ["ES", "US"], voice: "mixed", dna: "Nylon guitar, 102 BPM."
    })
  ];
  const projects = [
    project(),
    project({
      id: "22222222-2222-4222-8222-222222222222",
      artistId: idB, title: "Bahia", updatedAt: "2026-03-01T00:00:00.000Z",
      parameters: { genre: "Latin pop", additionalStyles: [] },
      result: { style: "", moods: ["warm"], suggestedGenre: "", lyrics: "otra letra", titles: ["Bahia"] }
    })
  ];
  const before = JSON.stringify({ artists, projects });
  const draft = draftArtistFromRoster({ artistIds: [idA, idB], artists, projects });
  assert.equal(draft.genre, "Alternative pop / Latin pop fusion");
  assert.equal(draft.voice, "mixed");
  assert.equal(draft.language, "en");
  assert.deepEqual(draft.countries, ["GB", "US", "ES"]);
  assert.equal(draft.countriesTruncated, false);
  assert.deepEqual(draft.sources, [{ id: idA, songCount: 1 }, { id: idB, songCount: 1 }]);
  assert.equal(draft.dna, twoArtistDna);
  assert.equal("name" in draft, false);
  const packed = JSON.stringify(draft);
  assert.equal(packed.includes("Mira Solenne"), false);
  assert.equal(packed.includes("Night Window"), false);
  assert.equal(packed.includes("secret chorus"), false);
  assert.equal(packed.includes("Bahia"), false);
  assert.equal(packed.includes("otra letra"), false);
  assert.equal(JSON.stringify({ artists, projects }), before);
});

test("shared fields stay as stored on the first artist", () => {
  const draft = draftArtistFromRoster({
    artistIds: [idA, idB],
    artists: [
      artist({ genre: "Alternative pop", language: "EN", voice: "female" }),
      artist({ id: idB, name: "Other", genre: "alternative pop", language: "en", voice: "female", countries: ["GB"], dna: "Same pulse." })
    ],
    projects: []
  });
  assert.equal(draft.genre, "Alternative pop");
  assert.equal(draft.voice, "female");
  assert.equal(draft.language, "EN");
  assert.match(draft.dna, /^Languages: EN$/m);
});

test("mixed voices become mixed", () => {
  const draft = draftArtistFromRoster({
    artistIds: [idA, idB],
    artists: [
      artist({ voice: "instrumental", dna: "No vocal." }),
      artist({ id: idB, name: "Other", voice: "female", dna: "A lead." })
    ],
    projects: []
  });
  assert.equal(draft.voice, "mixed");
});

test("only the three newest songs with production are used", () => {
  const styles = ["four", "three", "two", "one", "empty"];
  const projects = styles.map((style, index) => project({
    id: "33333333-3333-4333-8333-33333333333" + index,
    title: "Song " + style,
    updatedAt: "2026-01-0" + (index + 1) + "T00:00:00.000Z",
    parameters: { genre: "", additionalStyles: [] },
    result: {
      style: style === "empty" ? "" : style,
      moods: [], suggestedGenre: "", lyrics: "lyric " + style, titles: ["Song " + style]
    }
  }));
  const draft = draftArtistFromRoster({ artistIds: [idA], artists: [artist()], projects });
  assert.deepEqual(draft.sources, [{ id: idA, songCount: 3 }]);
  assert.match(draft.dna, /- style one\n- style two\n- style three/);
  assert.equal(draft.dna.includes("style four"), false);
  assert.equal(draft.dna.includes("style empty"), false);
  assert.equal(draft.dna.includes("lyric four"), false);
  assert.equal(draft.dna.includes("lyric one"), false);
});

test("an artist with no usable songs still contributes DNA", () => {
  const draft = draftArtistFromRoster({
    artistIds: [idA],
    artists: [artist({ dna: "Felt piano, 72 BPM." })],
    projects: [project({
      parameters: { genre: "", additionalStyles: [] },
      result: { style: "", moods: [], suggestedGenre: "", lyrics: "secret chorus", titles: ["Night Window"] }
    })]
  });
  assert.deepEqual(draft.sources, [{ id: idA, songCount: 0 }]);
  assert.match(draft.dna, /Songs: none/);
  assert.match(draft.dna, /Felt piano, 72 BPM\./);
  assert.equal(draft.dna.includes("secret chorus"), false);
});

test("countries stop at twelve", () => {
  const codes = ["US", "GB", "NL", "DE", "FR", "ES", "IT", "SE", "NO", "DK", "CH", "AU", "CA"];
  const draft = draftArtistFromRoster({
    artistIds: [idA, idB, idC],
    artists: [
      artist({ countries: codes.slice(0, 5) }),
      artist({ id: idB, name: "Second", countries: codes.slice(5, 10), dna: "Second." }),
      artist({ id: idC, name: "Third", countries: codes.slice(10), dna: "Third." })
    ],
    projects: []
  });
  assert.equal(draft.countries.length, 12);
  assert.equal(draft.countries.includes("CA"), false);
  assert.equal(draft.countriesTruncated, true);
});

test("a joined genre is cut at 100 characters", () => {
  const left = "A".repeat(40);
  const right = "B".repeat(40);
  const third = "C".repeat(40);
  const draft = draftArtistFromRoster({
    artistIds: [idA, idB, idC],
    artists: [
      artist({ genre: left, dna: "One." }),
      artist({ id: idB, name: "Second", genre: right, dna: "Two." }),
      artist({ id: idC, name: "Third", genre: third, dna: "Three." })
    ],
    projects: []
  });
  assert.equal(draft.genre.length, 100);
  assert.match(draft.dna, new RegExp("^Genre: " + draft.genre + "$", "m"));
});

test("a long draft stays within the Artist DNA limit", () => {
  const long = draftArtistFromRoster({
    artistIds: [idA],
    artists: [artist({ dna: "x".repeat(4000) })],
    projects: [project({ result: { style: "kept-song", moods: [], suggestedGenre: "", lyrics: "", titles: [] }, parameters: { genre: "", additionalStyles: [] } })]
  });
  assert.equal(long.dna.length, 3000);
  assert.equal(long.dna.endsWith("..."), true);
  assert.equal(long.dna.includes("kept-song"), false);

  const songs = Array.from({ length: 30 }, (_, index) => project({
    id: "44444444-4444-4444-8444-4444444444" + String(index).padStart(2, "0"),
    updatedAt: "2026-06-" + String(index + 1).padStart(2, "0") + "T00:00:00.000Z",
    parameters: { genre: "", additionalStyles: [] },
    result: { style: "SONG-" + String(index).padStart(2, "0") + "-" + "y".repeat(80), moods: [], suggestedGenre: "", lyrics: "", titles: [] }
  }));
  const fitted = draftArtistFromRoster({
    artistIds: [idA],
    artists: [artist({ dna: "Short DNA." })],
    projects: songs
  });
  assert.ok(fitted.dna.length <= 3000);
  assert.equal(fitted.dna.endsWith("..."), false);
  assert.match(fitted.dna, /Short DNA\./);
  const lines = fitted.dna.split("\n").filter(line => line.startsWith("- "));
  assert.ok(lines.length > 0);
  assert.ok(lines.length < 30);
  for (const line of lines) assert.match(line, /^- style SONG-\d\d-y{80}$/);
});

test("bad selection is rejected and nothing is saved", () => {
  const artists = [artist(), artist({ id: idB, name: "Other", dna: "Other." })];
  const projects = [project()];
  const before = JSON.stringify({ artists, projects });
  const cases = [
    [[], 400, "Choose one to three artists"],
    [[idA, idB, idC, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"], 400, "Choose one to three artists"],
    [[idA, idA], 400, "Duplicate artist"],
    [["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"], 404, "Artist not found"]
  ];
  for (const [artistIds, status, message] of cases) {
    assert.throws(() => draftArtistFromRoster({ artistIds, artists, projects }), error => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.status, status);
      assert.equal(error.message, message);
      return true;
    });
  }
  assert.equal(JSON.stringify({ artists, projects }), before);
});

test("the create dialog applies a draft without touching the name or the review checkbox", () => {
  const boxes = [
    { value: "GB", checked: false },
    { value: "US", checked: true },
    { value: "ES", checked: false }
  ];
  const form = {
    elements: {
      name: { value: "Lumen Park" },
      genre: { value: "" },
      language: { value: "en" },
      voice: { value: "instrumental" },
      dna: { value: "" },
      identityVerified: { checked: false }
    },
    querySelectorAll(selector) {
      if (selector === 'input[name="countries"]') return boxes;
      return [];
    }
  };
  applyArtistDraft(form, {
    genre: "Alternative pop / Latin pop fusion",
    language: "en",
    voice: "mixed",
    countries: ["GB", "ES"],
    dna: "Drafted DNA."
  });
  assert.equal(form.elements.name.value, "Lumen Park");
  assert.equal(form.elements.identityVerified.checked, false);
  assert.equal(form.elements.genre.value, "Alternative pop / Latin pop fusion");
  assert.equal(form.elements.language.value, "en");
  assert.equal(form.elements.voice.value, "mixed");
  assert.equal(form.elements.dna.value, "Drafted DNA.");
  assert.deepEqual(boxes.map(box => box.checked), [true, false, true]);
});

test("a fourth draft source stays unchecked", () => {
  const boxes = [
    { checked: true },
    { checked: true },
    { checked: true },
    { checked: true }
  ];
  const message = guardArtistDraftPick(boxes[3], boxes);
  assert.equal(boxes[3].checked, false);
  assert.equal(message, "Choose at most three artists");
  assert.equal(artistDraftButtonEnabled(boxes), true);
  const list = {
    0: { checked: true }, length: 1,
    [Symbol.iterator]: function* () { yield this[0]; }
  };
  assert.equal(guardArtistDraftPick(list[0], list), "");
  assert.equal(artistDraftButtonEnabled(list), true);
  boxes[0].checked = false;
  boxes[1].checked = false;
  boxes[2].checked = false;
  assert.equal(guardArtistDraftPick(boxes[3], boxes), "");
  assert.equal(artistDraftButtonEnabled(boxes), false);
});

test("the create dialog lists roster artists and a draft button", async () => {
  const { artistPage } = await import("../public/artists.js");
  const html = artistPage({
    artists: [artist()],
    genres: { pop: ["Alternative pop"] },
    countries: [{ code: "GB", name: "United Kingdom" }, { code: "US", name: "United States" }]
  });
  assert.match(html, /data-artist-draft/);
  assert.match(html, /Draft from selected artists/);
  assert.match(html, /id="artist-draft-recording-search"/);
  assert.match(html, /name="draftArtist" value="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"/);
  const app = await import("node:fs/promises").then(fs => fs.readFile(new URL("../public/app.js", import.meta.url), "utf8"));
  assert.match(app, /data-action="artist-draft"|act==="artist-draft"/);
  assert.match(app, /recordingIds/);
  assert.match(app, /draftRecordingSearchPath/);
  const artistsSource = await import("node:fs/promises").then(fs => fs.readFile(new URL("../public/artists.js", import.meta.url), "utf8"));
  assert.match(artistsSource, /music-dna\/search\?/);
  assert.match(app, /setArtistDraftMode\(form, "edit"\)/);
  assert.match(app, /setArtistDraftMode\(form, "create"\)/);
});

test("editing an artist hides the draft picker", () => {
  const fieldset = { hidden: false };
  const form = {
    querySelector(selector) {
      assert.equal(selector, "[data-artist-draft]");
      return fieldset;
    }
  };
  setArtistDraftMode(form, "edit");
  assert.equal(fieldset.hidden, true);
  setArtistDraftMode(form, "create");
  assert.equal(fieldset.hidden, false);
});

test("the draft route is an authenticated read and is not on the public host", async t => {
  const store = new Store(":memory:");
  const studio = new StudioStore(store);
  const server = createAppServer({
    store, provider: { available: () => false }, password: "long-test-password",
    mcpOrigin: "https://blossom.wenneker.dev"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { await new Promise(done => server.close(done)); store.close(); });
  const port = server.address().port;
  const baseUrl = "http://127.0.0.1:" + port;
  const post = (path, payload, cookie) => fetch(baseUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-blossom-request": "ui", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(payload)
  });
  const login = await post("/auth/login", { username: "admin", password: "long-test-password" });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const created = await post("/api/artists", {
    name: "Mira Solenne", genre: "Alternative pop", language: "en", countries: ["GB", "US"],
    voice: "female", dna: "Close female lead, 86 BPM."
  }, cookie);
  assert.equal(created.status, 201);
  const saved = await created.json();
  studio.save({
    title: "Night Window", artistId: saved.id,
    parameters: { genre: "Alternative pop", additionalStyles: ["intimate"] },
    result: { style: "soft drum machine", moods: ["reflective"], suggestedGenre: "alt pop", lyrics: "secret chorus", titles: ["Night Window"] }
  });
  const count = () => store.artists().length;
  assert.equal(count(), 1);
  const denied = await post("/api/artists/draft", { artistIds: [saved.id] });
  assert.equal(denied.status, 401);
  assert.equal(count(), 1);
  const drafted = await post("/api/artists/draft", { artistIds: [saved.id] }, cookie);
  assert.equal(drafted.status, 200);
  const body = await drafted.json();
  assert.equal("name" in body, false);
  assert.equal(body.language, "en");
  assert.equal(body.sources[0].id, saved.id);
  assert.equal(body.sources[0].songCount, 1);
  assert.equal(body.dna.includes("Mira Solenne"), false);
  assert.equal(body.dna.includes("secret chorus"), false);
  assert.equal(count(), 1);
  const createdAgain = await post("/api/artists", {
    name: "Lumen Park", genre: body.genre, language: body.language, countries: body.countries,
    voice: body.voice, dna: body.dna, identityVerified: false
  }, cookie);
  assert.equal(createdAgain.status, 201);
  const publicDraft = await new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1", port, path: "/api/artists/draft", method: "POST",
      headers: { Host: "blossom.wenneker.dev", "content-type": "application/json", "x-blossom-request": "ui" }
    }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end(JSON.stringify({ artistIds: [saved.id] }));
  });
  assert.equal(publicDraft, 404);
});

const recId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function recording(overrides = {}) {
  return {
    id: recId, artist: "Novo Canto", title: "Rio Quiet", analysisVersion: 1,
    analysis: {
      genres: ["folk"], moods: ["wistful"], bpm: 92,
      instruments: [{ name: "nylon guitar", timbre: "warm", technique: "fingerpicked", role: "lead" }],
      vocals: { timbre: "breathy", delivery: "close" },
      production: { texture: "dry", dynamics: "quiet" },
      sections: []
    },
    ...overrides
  };
}

test("an analyzed recording drafts traits without the real name", () => {
  const draft = draftArtistFromRoster({
    recordingIds: [recId], recordings: [recording()]
  });
  assert.equal(draft.genre, "folk");
  assert.equal("voice" in draft, false);
  assert.equal("language" in draft, false);
  assert.equal("countries" in draft, false);
  assert.equal(draft.dna.includes("Voice:"), false);
  assert.equal(draft.dna.includes("Novo Canto"), false);
  assert.equal(draft.dna.includes("Rio Quiet"), false);
  assert.match(draft.dna, /Recordings:\n- folk, wistful mood, approximately 92 BPM, warm nylon guitar fingerpicked lead, breathy vocals, close phrasing, dry production, quiet/);
});

test("a recording does not change voice language or countries", () => {
  const boxes = [{ value: "US", checked: true }];
  const form = {
    elements: {
      name: { value: "Lumen Park" }, genre: { value: "keep" }, language: { value: "en" },
      voice: { value: "instrumental" }, dna: { value: "" }, identityVerified: { checked: false }
    },
    querySelectorAll() { return boxes; }
  };
  applyArtistDraft(form, draftArtistFromRoster({ recordingIds: [recId], recordings: [recording()] }));
  assert.equal(form.elements.name.value, "Lumen Park");
  assert.equal(form.elements.identityVerified.checked, false);
  assert.equal(form.elements.voice.value, "instrumental");
  assert.equal(form.elements.language.value, "en");
  assert.equal(form.elements.genre.value, "folk");
  assert.deepEqual(boxes.map(box => box.checked), [true]);
});

test("roster and recording share one genre and a three source limit", () => {
  const draft = draftArtistFromRoster({
    artistIds: [idA], artists: [artist()], projects: [],
    recordingIds: [recId], recordings: [recording()]
  });
  assert.equal(draft.genre, "Alternative pop / folk");
  assert.equal(draft.voice, "female");
  assert.equal(draft.language, "en");
  assert.deepEqual(draft.countries, ["GB", "US"]);
  assert.equal(draft.dna.includes("Novo Canto"), false);
  assert.match(draft.dna, /Traits 1/);
  assert.match(draft.dna, /Recordings:/);
  assert.throws(() => draftArtistFromRoster({
    artistIds: [idA, idB],
    recordingIds: [recId, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
    artists: [artist(), artist({ id: idB })],
    recordings: [recording(), recording({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })]
  }), error => error instanceof DomainError && error.status === 400);
  assert.throws(() => draftArtistFromRoster({
    recordingIds: [recId, recId], recordings: [recording()]
  }), error => error instanceof DomainError && error.status === 400 && error.message === "Duplicate recording");
  assert.throws(() => draftArtistFromRoster({
    recordingIds: [recId], recordings: []
  }), error => error instanceof DomainError && error.status === 404 && error.message === "Recording not found");
  assert.throws(() => draftArtistFromRoster({
    recordingIds: [recId], recordings: [recording({ analysis: null })]
  }), error => error instanceof DomainError && error.status === 404 && error.message === "Recording is not analyzed");
});

test("a recording search lists analyzed songs and says when none are analyzed", () => {
  const found = recordingSearchChoices({ results: [recording(), recording({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", analysis: null, analysisVersion: 0 })] }, "Novo");
  assert.deepEqual(found.choices, [{ id: recId, label: "Novo Canto — Rio Quiet" }]);
  assert.equal(found.note, "");
  const missing = recordingSearchChoices({ results: [] }, "Novo");
  assert.equal(missing.note, "No analyzed recording for that search.");
  assert.match(recordingChoiceMarkup(found.choices, [recId]), /name="draftRecording"/);
  assert.match(recordingChoiceMarkup(found.choices, [recId]), /checked/);
});

test("the draft route reads an analyzed recording and does not save an artist", async t => {
  const store = new Store(":memory:");
  const dna = new MusicDNA(store);
  const profile = dna.create({ artist: "Novo Canto", title: "Rio Quiet", sourceKind: "manual" });
  dna.saveAnalysis(profile.id, {
    genres: ["folk"], moods: ["wistful"], bpm: 92,
    instruments: [{ name: "nylon guitar", timbre: "warm", technique: "fingerpicked", role: "lead" }],
    vocals: { timbre: "breathy", delivery: "close" },
    production: { texture: "dry", dynamics: "quiet" },
    analysisMethod: "manual", analyzer: "test"
  });
  const server = createAppServer({
    store, provider: { available: () => false }, password: "long-test-password"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { await new Promise(done => server.close(done)); store.close(); });
  const port = server.address().port;
  const post = (path, payload, cookie) => fetch("http://127.0.0.1:" + port + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-blossom-request": "ui", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(payload)
  });
  const login = await post("/auth/login", { username: "admin", password: "long-test-password" });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const drafted = await post("/api/artists/draft", { recordingIds: [profile.id] }, cookie);
  assert.equal(drafted.status, 200);
  const body = await drafted.json();
  assert.equal(body.genre, "folk");
  assert.equal("voice" in body, false);
  assert.equal(body.dna.includes("Novo Canto"), false);
  assert.equal(body.dna.includes("Rio Quiet"), false);
  assert.match(body.dna, /warm nylon guitar/);
  assert.equal(store.artists().length, 0);
});

const folkAnalysis = {
  genres: ["folk"], moods: ["wistful"], bpm: 92,
  instruments: [{ name: "nylon guitar", timbre: "warm", technique: "fingerpicked", role: "lead" }],
  vocals: { timbre: "breathy", delivery: "close" },
  production: { texture: "dry", dynamics: "quiet" },
  analysisMethod: "manual", analyzer: "test"
};

test("typed DNA stays and the next draft replaces only the generated block", () => {
  const typed = "Close vocal, no drums.";
  const first = "Musical traits\n\nGenre: folk";
  const second = "Musical traits\n\nGenre: house";
  assert.equal(mergeArtistDna("", first, ""), first);
  assert.equal(mergeArtistDna("   ", first, ""), first);
  assert.equal(mergeArtistDna(typed, first, ""), typed + "\n\n" + first);
  assert.equal(mergeArtistDna(typed + "\n\n" + first, second, first), typed + "\n\n" + second);
  assert.equal(mergeArtistDna(typed + "\n\n" + second, second, second), typed + "\n\n" + second);
  const form = {
    elements: {
      name: { value: "Lumen Park" }, genre: { value: "keep" }, language: { value: "en" },
      voice: { value: "instrumental" }, dna: { value: typed }, identityVerified: { checked: true }
    },
    querySelectorAll() { return []; }
  };
  applyArtistDraft(form, { genre: "folk", dna: first });
  assert.equal(form.elements.dna.value, typed + "\n\n" + first);
  assert.equal(form.elements.name.value, "Lumen Park");
  assert.equal(form.elements.identityVerified.checked, true);
  applyArtistDraft(form, { genre: "house", dna: second });
  assert.equal(form.elements.dna.value, typed + "\n\n" + second);
  assert.equal(form.elements.genre.value, "house");
});

test("a partial name searches analyzed recordings and keeps a checked one", () => {
  assert.equal(draftRecordingSearchPath("l"), "");
  assert.equal(draftRecordingSearchPath("lyn"), "music-dna/search?q=lyn&limit=20&analyzed=1&prefix=1");
  const kept = [{ id: recId, label: "Novo Canto — Rio Quiet" }];
  const next = recordingChoicesForDraft({
    results: [recording({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", artist: "Joy Division", title: "Love Will Tear Us Apart" })]
  }, "joy", kept);
  assert.deepEqual(next.choices.map(choice => choice.id), [recId, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]);
  assert.equal(next.note, "");
  const empty = recordingChoicesForDraft({ results: [recording({ analysis: null, analysisVersion: 0 })] }, "novo", []);
  assert.deepEqual(empty.choices, []);
  assert.equal(empty.note, "No analyzed recording for that search.");
  const form = {
    querySelectorAll(selector) {
      if (selector === 'input[name="draftArtist"]:checked') return [{ value: idA }];
      if (selector === 'input[name="draftRecording"]:checked') return [{ value: recId }];
      return [];
    }
  };
  assert.deepEqual(draftSelection(form), { artistIds: [idA], recordingIds: [recId] });
  assert.equal(draftSelection({
    querySelectorAll() { return []; }
  }), null);
});

test("prefix search returns an analyzed recording and skips one that is not analyzed", async t => {
  const store = new Store(":memory:");
  const dna = new MusicDNA(store);
  const waiting = dna.create({ artist: "Lynyrd Skynyrd", title: "Waiting", sourceKind: "manual" });
  const free = dna.create({ artist: "Lynyrd Skynyrd", title: "Free Bird", sourceKind: "manual" });
  dna.saveAnalysis(free.id, folkAnalysis);
  assert.deepEqual(dna.search({ q: "lyn" }).map(row => row.title), []);
  assert.deepEqual(dna.search({ q: "lyn", prefix: true, analyzed: true }).map(row => row.id), [free.id]);
  assert.equal(dna.count({ q: "lyn", prefix: true, analyzed: true }), 1);
  assert.equal(dna.search({ q: "lyn", prefix: true }).some(row => row.id === waiting.id), true);
  const server = createAppServer({
    store, provider: { available: () => false }, password: "long-test-password"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { await new Promise(done => server.close(done)); store.close(); });
  const port = server.address().port;
  const base = "http://127.0.0.1:" + port;
  const login = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-blossom-request": "ui" },
    body: JSON.stringify({ username: "admin", password: "long-test-password" })
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const found = await fetch(base + "/api/music-dna/search?q=lyn&prefix=1&analyzed=1&limit=20", {
    headers: { cookie }
  });
  assert.equal(found.status, 200);
  const body = await found.json();
  assert.deepEqual(body.results.map(row => row.id), [free.id]);
  assert.equal(body.total, 1);
  const rejected = await fetch(base + "/api/music-dna/search?q=lyn&prefix=yes", { headers: { cookie } });
  assert.equal(rejected.status, 400);
});
