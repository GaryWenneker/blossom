import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DomainError } from "../src/domain.mjs";
import { analysisFromPaste, MusicDNA } from "../src/music-dna.mjs";
import { MusicDnaAPI } from "../src/music-dna-api.mjs";
import { Store } from "../src/storage.mjs";
import { musicDnaAction, musicDnaView } from "../public/music-dna.js";

const PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PASTE = {
  bpm: 99,
  summary: "A pasted analysis.",
  genres: ["Post-punk"],
  instruments: [{ name: "Bass", technique: "picked", role: "pulse" }]
};

function view(profile) {
  return musicDnaView({ data: {
    musicDnaProfiles: [profile], musicDnaTotal: 1, musicDnaSelected: profile.selected ? profile : null
  } });
}

function post(api, path, payload) {
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
  const req = {
    method: "POST",
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(payload)); }
  };
  return api.handle(req, res, path, new URLSearchParams()).then(() => res);
}

test("every recording row and its sheet offer Paste JSON", () => {
  const waiting = {
    id: PROFILE, artist: "Anne Clark", title: "Sleeper In Metropolis",
    analysisVersion: 0, analysis: null, jobStatus: "queued"
  };
  const html = view(waiting);
  assert.match(html, new RegExp('data-action="dna-paste-open" data-id="' + PROFILE + '"'));
  assert.match(html, />Paste JSON</);
  const analyzed = view({
    ...waiting, analysisVersion: 1, jobStatus: "completed",
    analysis: { bpm: 120, analysisMethod: "chatgpt-catalog", analyzer: "chatgpt" }
  });
  assert.match(analyzed, /data-action="dna-paste-open"/);
  assert.doesNotMatch(analyzed, /dna-analyze-one/);
  const open = view({ ...waiting, selected: true });
  const start = open.indexOf('<dialog id="dna-recording-sheet"');
  const sheet = open.slice(start, open.indexOf("</dialog>", start) + 9);
  assert.match(sheet, /data-action="dna-paste-open"/);
  assert.doesNotMatch(sheet, /dna-analyze-one/);
  const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const dialogAt = page.indexOf('id="dna-paste-dialog"');
  assert.ok(dialogAt > page.indexOf("</main>"));
  const dialog = page.slice(dialogAt, page.indexOf("</dialog>", dialogAt));
  assert.match(dialog, /id="dna-paste-json"/);
  assert.match(dialog, /<textarea/);
  assert.match(dialog, /data-action="dna-paste-apply"/);
  assert.match(dialog, /data-action="dna-paste-cancel"/);
});

test("Paste JSON opens a dialog and Apply posts the pasted text", async () => {
  const dialog = {
    dataset: {}, open: false,
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
  const box = { value: "" };
  const error = { hidden: true, textContent: "" };
  const previous = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      if (selector === "#dna-paste-dialog") return dialog;
      if (selector === "#dna-paste-json") return box;
      if (selector === "#dna-paste-error") return error;
      return null;
    }
  };
  try {
    const calls = [];
    await musicDnaAction(
      { dataset: { action: "dna-paste-open", id: PROFILE } },
      { data: {} },
      async () => { throw new Error("opening must not call the API"); },
      async () => {},
      () => {}
    );
    assert.equal(dialog.open, true);
    assert.equal(dialog.dataset.profileId, PROFILE);
    await musicDnaAction(
      { dataset: { action: "dna-paste-apply" } },
      { data: {} },
      async (path, body) => { calls.push([path, body]); },
      async () => {},
      () => {}
    );
    assert.deepEqual(calls, []);
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /Paste the analysis JSON first/);
    const pasted = "  ```json\n" + JSON.stringify(PASTE) + "\n```  ";
    box.value = pasted;
    const messages = [];
    let refreshed = 0;
    await musicDnaAction(
      { dataset: { action: "dna-paste-apply" } },
      { data: {} },
      async (path, body) => { calls.push([path, body]); return { analysisVersion: 1 }; },
      async () => { refreshed += 1; },
      text => messages.push(text)
    );
    assert.deepEqual(calls, [[
      "music-dna/profiles/" + PROFILE + "/paste-analysis",
      { text: pasted.trim() }
    ]]);
    assert.equal(box.value, "");
    assert.equal(dialog.open, false);
    assert.equal(refreshed, 1);
    assert.equal(messages.at(-1), "Analysis saved from pasted JSON.");
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("pasted text becomes one analysis object", () => {
  const fenced = analysisFromPaste("notes\n```json\n" + JSON.stringify(PASTE) + "\n```\nthanks");
  assert.equal(fenced.bpm, 99);
  assert.equal(fenced.analysisMethod, "human_verified");
  assert.equal(fenced.analyzer, "pasted-json");
  assert.equal(fenced.summary, "A pasted analysis.");
  const wrapped = analysisFromPaste(JSON.stringify({
    analysis: { ...PASTE, analysisMethod: "chatgpt-catalog", analyzer: "chatgpt" }
  }));
  assert.equal(wrapped.analysisMethod, "chatgpt-catalog");
  assert.equal(wrapped.analyzer, "chatgpt");
  assert.throws(() => analysisFromPaste(""), /Paste the analysis JSON first/);
  assert.throws(() => analysisFromPaste("not json"), /Pasted text was not analysis JSON/);
  assert.throws(() => analysisFromPaste("[]"), /Pasted text was not analysis JSON/);
  assert.throws(() => analysisFromPaste(JSON.stringify({ bpm: 1 })), /BPM|Invalid BPM/);
});

test("POST paste-analysis stores a new version and does not start ChatGPT", async () => {
  const store = new Store(":memory:");
  const dna = new MusicDNA(store);
  let started = 0;
  const api = new MusicDnaAPI(dna, { chatgpt: { start() { started += 1; return { started: true }; } } });
  try {
    const profile = dna.create({ artist: "Anne Clark", title: "Sleeper In Metropolis", sourceKind: "metadata" });
    dna.saveAnalysis(profile.id, {
      analysisMethod: "chatgpt-catalog", analyzer: "chatgpt", summary: "Earlier note.", bpm: 110,
      genres: ["Electro"]
    });
    const saved = await post(api, "/api/music-dna/profiles/" + profile.id + "/paste-analysis", {
      text: "```json\n" + JSON.stringify(PASTE) + "\n```"
    });
    assert.equal(saved.status, 201);
    assert.equal(saved.headers["Content-Type"], "application/json; charset=utf-8");
    const body = JSON.parse(saved.body);
    assert.equal(body.analysisVersion, 2);
    assert.equal(body.analysis.bpm, 99);
    assert.equal(body.analysis.summary, "A pasted analysis.");
    assert.equal(body.analysis.analysisMethod, "human_verified");
    assert.equal(dna.versions(profile.id).length, 2);
    assert.equal(started, 0);
    await assert.rejects(
      () => post(api, "/api/music-dna/profiles/" + profile.id + "/paste-analysis", { text: "hello" }),
      (error) => error instanceof DomainError && /Pasted text was not analysis JSON/.test(error.message)
    );
    assert.equal(dna.get(profile.id).analysis.bpm, 99);
    assert.equal(dna.versions(profile.id).length, 2);
  } finally { store.close(); }
});
