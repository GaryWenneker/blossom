import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../src/domain.mjs";
import { Store } from "../src/storage.mjs";
import { StudioAPI } from "../src/studio-api.mjs";
import { studioAction, studioView } from "../public/studio.js";

const BRIEF = {
  concept: "A quiet drive at dusk",
  lyrics: "[Verse]\nThe road keeps its own hour",
  style: "fingerpicked country, close vocal",
  titles: ["Still by Hand"],
  moods: ["quiet"],
  exclusions: ["Auto-Tune"],
  coverPrompt: "square dusk road, no text",
  artistPhotoPrompt: "wide banner, room for a name",
  suggestedGenre: "Country",
  rationale: "The article is about staying.",
  generationParameters: { genre: "Americana" }
};

const FENCED = "ChatGPT wrote this brief:\n```json\n" + JSON.stringify(BRIEF) + "\n```\n";

function studio() {
  let generated = 0;
  const api = new StudioAPI({
    store: new Store(":memory:"),
    vault: { list() { return {}; }, read() { return null; } },
    articleImporter: async () => ({ text: "" }),
    chatgptLyrics: {
      async generate() { generated += 1; throw new Error("ChatGPT must not run"); },
      async progress() { return {}; }
    }
  });
  return { api, generated: () => generated };
}

function post(api, path, body) {
  const req = {
    method: "POST",
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); }
  };
  const res = { status: 0, text: "", writeHead(code) { this.status = code; }, end(data) { this.text = data; } };
  return api.handle(req, res, path).then(() => ({ status: res.status, body: JSON.parse(res.text) }));
}

test("Studio shows a place to paste song JSON", () => {
  const html = studioView({
    data: { studioProjects: [], studioAssets: [], studioStatus: {}, artists: [], genres: {}, musicDnaProfiles: [], studioReferences: [] }
  });
  assert.match(html, /id="studio-paste-brief"/);
  assert.match(html, /data-action="studio-paste-brief"/);
  assert.match(html, /Paste song JSON/);
  assert.match(html, /Apply pasted JSON/);
});

test("pasted song JSON fills the project without calling ChatGPT", async () => {
  const { api, generated } = studio();
  const project = api.studio.save({ title: "Untitled project", article: "A border story long enough to keep." });
  const saved = await post(api, "/api/studio/projects/" + project.id + "/paste-brief", { text: FENCED });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.result.lyrics, BRIEF.lyrics);
  assert.equal(saved.body.result.style, BRIEF.style);
  assert.equal(saved.body.result.concept, BRIEF.concept);
  assert.equal(saved.body.result.coverPrompt, BRIEF.coverPrompt);
  assert.equal(saved.body.result.artistPhotoPrompt, BRIEF.artistPhotoPrompt);
  assert.deepEqual(saved.body.result.titles, BRIEF.titles);
  assert.deepEqual(saved.body.result.moods, BRIEF.moods);
  assert.equal(saved.body.title, "Still by Hand");
  assert.equal(saved.body.parameters.genre, "Americana");
  assert.equal(generated(), 0);
});

test("a song JSON object without a code fence still fills the project", async () => {
  const { api } = studio();
  const project = api.studio.save({ title: "Kept title", article: "Another story long enough to keep." });
  const saved = await post(api, "/api/studio/projects/" + project.id + "/paste-brief", {
    text: "notes before " + JSON.stringify(BRIEF) + " notes after"
  });
  assert.equal(saved.body.result.lyrics, BRIEF.lyrics);
  assert.equal(saved.body.title, "Kept title");
});

test("a paste that is not a song brief leaves the project unchanged", async () => {
  const { api } = studio();
  const project = api.studio.save({
    title: "Kept title",
    article: "Another story long enough to keep.",
    result: { concept: "keep this", lyrics: "old line", style: "old style", titles: ["Kept title"], exclusions: [], moods: [], coverPrompt: "", artistPhotoPrompt: "", suggestedGenre: "", rationale: "" }
  });
  await assert.rejects(
    () => post(api, "/api/studio/projects/" + project.id + "/paste-brief", { text: "{ \"lyrics\": \"only lyrics\" }" }),
    error => error instanceof DomainError && error.status === 400 && /lyrics and style/.test(error.message)
  );
  await assert.rejects(
    () => post(api, "/api/studio/projects/" + project.id + "/paste-brief", { text: "   " }),
    error => error instanceof DomainError && error.status === 400
  );
  const current = api.studio.project(project.id);
  assert.equal(current.result.concept, "keep this");
  assert.equal(current.result.lyrics, "old line");
  assert.equal(current.title, "Kept title");
});

test("Apply pasted JSON sends the textarea to the project and refreshes", async () => {
  const projectId = "9b5989a0-c982-45ce-a860-ed5466511227";
  const values = {
    "#studio-paste-brief": { value: "   " },
    "#studio-title": { value: "Untitled project" },
    "#studio-article": { value: "A story." },
    "#studio-artist": { value: "" },
    "#studio-source": { value: "" }
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector(selector) { return values[selector] || (values[selector] = { value: "", checked: false }); },
    getElementById(id) { return this.querySelector("#" + id); }
  };
  const calls = [];
  const messages = [];
  let refreshed = 0;
  const api = async (path, body) => {
    calls.push({ path, body });
    if (path === "studio/projects") return { id: projectId, title: "Untitled project" };
    if (path.endsWith("/paste-brief")) return { id: projectId, result: BRIEF };
    throw new Error("unexpected " + path);
  };
  const button = { dataset: { action: "studio-paste-brief" }, disabled: false };
  const state = { data: { studioProjects: [{ id: projectId, title: "Untitled project" }] } };
  try {
    await studioAction(button, state, api, async () => { refreshed += 1; }, (text, failed) => messages.push({ text, failed }));
    assert.equal(calls.length, 0);
    assert.equal(messages[0].failed, true);
    values["#studio-paste-brief"].value = FENCED;
    await studioAction(button, state, api, async () => { refreshed += 1; }, (text, failed) => messages.push({ text, failed }));
    assert.equal(calls[0].path, "studio/projects");
    assert.equal(calls[1].path, "studio/projects/" + projectId + "/paste-brief");
    assert.equal(calls[1].body.text, FENCED.trim());
    assert.equal(refreshed, 1);
    assert.match(messages.at(-1).text, /Song JSON applied/);
    assert.equal(button.disabled, false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
