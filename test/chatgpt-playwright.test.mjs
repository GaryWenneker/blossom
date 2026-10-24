import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";
import { DomainError } from "../src/domain.mjs";
import {
  pasteStartsLyrics, buildChatGptLyricsPrompt, parseChatGptBrief, lyricsProgress, ChatGptLyricsBrowser
} from "../src/chatgpt-playwright.mjs";
import { pasteStartsLyrics as uiPaste, studioView, studioPaste } from "../public/studio.js";

const ARTICLE = "Het dorp herstelt de oude molen na de storm. De buren delen hout, soep en een nieuw dak.";
const BRIEF = {
  concept: "An original fictional village song",
  lyrics: "[Verse 1] The countryside\n[Chorus] Molen in de wind",
  style: "Americana acoustic",
  exclusions: [],
  moods: ["gentle"],
  titles: ["The Village"],
  coverPrompt: "Original rural landscape",
  artistPhotoPrompt: "Original fictional singer",
  suggestedGenre: "Americana",
  rationale: "Intimate acoustic sound"
};
const FENCED = "```json\n" + JSON.stringify({ ...BRIEF, lyrics: "[Chorus] Molen in de wind" }) + "\n```";

function project(article = ARTICLE) {
  return { article, sourceUrl: "", parameters: { genre: "Country Pop", vocalGender: "male", targetSeconds: 205 }, referenceDna: [] };
}

test("a short paste does not start ChatGPT", () => {
  assert.equal(pasteStartsLyrics("article", "kort"), false);
  assert.equal(pasteStartsLyrics("article", "x".repeat(79)), false);
  assert.equal(pasteStartsLyrics("url", "not a url"), false);
  assert.equal(uiPaste("article", "kort"), false);
  assert.equal(uiPaste("url", "https://example.com/molen"), true);
  assert.equal(uiPaste("article", "x".repeat(80)), pasteStartsLyrics("article", "x".repeat(80)));
  assert.equal(uiPaste("url", "javascript:alert(1)"), false);
});

test("a URL paste and a text block qualify", () => {
  assert.equal(pasteStartsLyrics("url", "https://example.com/molen"), true);
  assert.equal(pasteStartsLyrics("url", "http://example.com/a"), true);
  assert.equal(pasteStartsLyrics("article", "x".repeat(80)), true);
  assert.equal(pasteStartsLyrics("url", "javascript:alert(1)"), false);
});

test("the prompt carries the article and production context and nothing secret", () => {
  const prompt = buildChatGptLyricsPrompt(project());
  assert.match(prompt, /Het dorp herstelt de oude molen na de storm\./);
  assert.match(prompt, /Country Pop/);
  assert.match(prompt, /original lyrics/i);
  assert.match(prompt, /untrusted/i);
  assert.match(prompt, /in English/);
  assert.doesNotMatch(prompt, /cookie|password|api_key/i);
});

test("a Dutch article still uses the selected lyric language, English by default", () => {
  const prompt = buildChatGptLyricsPrompt(project());
  assert.match(prompt, /Write the lyrics, titles, and concept in English\./);
  assert.doesNotMatch(prompt, /Write the lyrics in Dutch/);
  const dutch = project();
  dutch.parameters = { ...dutch.parameters, lyricLanguage: "nl" };
  assert.match(buildChatGptLyricsPrompt(dutch), /Write the lyrics, titles, and concept in Dutch\./);
});

test("an English article does not demand Dutch lyrics", () => {
  const prompt = buildChatGptLyricsPrompt(project("The village restores the old mill after the storm and shares the work."));
  assert.match(prompt, /original lyrics/i);
  assert.doesNotMatch(prompt, /Write the lyrics in Dutch/);
});

test("the reply parser accepts fenced JSON and rejects a brief without lyrics", () => {
  assert.equal(parseChatGptBrief(FENCED).lyrics, "[Chorus] Molen in de wind");
  assert.throws(() => parseChatGptBrief('{"concept":"Only a concept"}'), /song brief/);
  assert.throws(() => parseChatGptBrief("I cannot help with that"), /song brief/);
});

test("first use opens a visible login window and does not return lyrics", async () => {
  const launches = [];
  const browser = new ChatGptLyricsBrowser({
    seenFile: join(await mkdtemp(join(tmpdir(), "chatgpt-")), "seen"),
    async launch(options) {
      launches.push(options);
      return { async hasComposer() { return false; }, async bringToFront() { launches.push("front"); }, async close() { launches.push("close"); } };
    }
  });
  await assert.rejects(browser.generate(project()), error => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "chatgpt_login_required");
    return true;
  });
  assert.equal(launches[0].headless, false);
  assert.equal(launches[0].url, "https://chatgpt.com/");
  assert.equal(launches.filter(item => item === "close").length, 0);
  assert.ok(launches.includes("front"));
});

test("a saved session runs headless and does not bring the window forward", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chatgpt-"));
  const seenFile = join(dir, "seen");
  await writeFile(seenFile, "seen\n");
  const launches = [];
  let submitted = "";
  const browser = new ChatGptLyricsBrowser({
    seenFile,
    async launch(options) {
      launches.push(options);
      return {
        async hasComposer() { return true; },
        async bringToFront() { launches.push("front"); },
        async submit(prompt) { submitted = prompt; return FENCED; },
        async close() { launches.push("close"); }
      };
    }
  });
  const brief = await browser.generate(project());
  assert.equal(brief.lyrics, "[Chorus] Molen in de wind");
  assert.equal(launches[0].headless, true);
  assert.equal(launches.includes("front"), false);
  assert.ok(launches.includes("close"));
  assert.match(submitted, /Country Pop/);
});

test("a headless session without a composer opens a visible window and returns no brief", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chatgpt-"));
  const seenFile = join(dir, "seen");
  await writeFile(seenFile, "seen\n");
  const launches = [];
  const browser = new ChatGptLyricsBrowser({
    seenFile,
    async launch(options) {
      launches.push(options.headless);
      return {
        async hasComposer() { return false; },
        async bringToFront() { launches.push("front"); },
        async close() { launches.push("close"); }
      };
    }
  });
  await assert.rejects(browser.generate(project()), error => {
    assert.equal(error.code, "chatgpt_login_required");
    return true;
  });
  assert.deepEqual(launches.filter(item => typeof item === "boolean"), [true, false]);
  assert.ok(launches.includes("close"));
  assert.ok(launches.includes("front"));
});

test("an unreadable reply fails and a second run while busy is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chatgpt-"));
  const seenFile = join(dir, "seen");
  await writeFile(seenFile, "seen\n");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered = 0;
  const browser = new ChatGptLyricsBrowser({
    seenFile,
    async launch() {
      entered += 1;
      if (entered === 1) await gate;
      return {
        async hasComposer() { return true; },
        async submit() { return "I cannot help with that"; },
        async close() {}
      };
    }
  });
  const first = browser.generate(project());
  await assert.rejects(browser.generate(project()), error => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "chatgpt_busy");
    return true;
  });
  release();
  await assert.rejects(first, error => {
    assert.equal(error.status, 502);
    assert.equal(error.code, "chatgpt_reply_invalid");
    return true;
  });
});

test("an empty source is rejected before the browser starts", async () => {
  let launched = false;
  const browser = new ChatGptLyricsBrowser({
    async launch() { launched = true; return {}; }
  });
  await assert.rejects(browser.generate({ article: "  ", sourceUrl: "" }), error => {
    assert.equal(error.status, 400);
    return true;
  });
  assert.equal(launched, false);
});

test("Chrome launches only against chatgpt.com and refuses a non-directory profile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chatgpt-"));
  const launches = [];
  let page;
  const browser = new ChatGptLyricsBrowser({
    profileDir: dir,
    seenFile: join(dir, "seen"),
    loader: async () => ({
      chromium: {
        async launchPersistentContext(profile, options) {
          launches.push({ profile, options });
          page = {
            visited: "",
            url() { return this.visited || "about:blank"; },
            async goto(url) { this.visited = url; },
            locator(selector) {
              launches.push(selector);
              return { async count() { return 0; }, first() { return this; }, last() { return this; } };
            },
            async bringToFront() { launches.push("front"); }
          };
          return { pages: () => [page], on() {}, async close() { launches.push("context-close"); } };
        }
      }
    })
  });
  await assert.rejects(browser.generate(project()), error => error.code === "chatgpt_login_required");
  assert.equal(launches[0].options.headless, false);
  assert.equal(launches[0].options.channel, "chrome");
  assert.equal(launches[0].options.acceptDownloads, false);
  assert.equal(launches[0].options.serviceWorkers, "block");
  assert.equal(launches[0].profile, dir);
  assert.equal(page.visited, "https://chatgpt.com/");
  assert.equal(launches.includes("front"), true);
  const file = join(dir, "not-a-directory");
  await writeFile(file, "x");
  const blocked = new ChatGptLyricsBrowser({ profileDir: file, loader: async () => { throw new Error("loader must not run"); } });
  await assert.rejects(blocked.generate(project()), /Unsafe ChatGPT browser profile/);
  assert.ok(launches.some(item => typeof item === "string" && item.includes("prompt-textarea")));
  assert.equal(JSON.stringify(launches).includes("cookie"), false);
});

test("the Studio screen asks for ChatGPT and a URL paste imports before generation", async () => {
  const html = studioView({ data: { studioProjects: [], studioAssets: [], studioStatus: {}, artists: [], genres: {}, musicDnaProfiles: [], studioReferences: [] } });
  assert.match(html, /id="studio-language"/);
  assert.match(html, /value="auto" selected/);
  assert.match(html, />English</);
  assert.match(html, /Generate with ChatGPT/);
  assert.match(html, /Generate again/);
  assert.match(html, /signed-in Safari/);
  assert.doesNotMatch(html, /Genereer automatisch/);
  const values = {
    "#studio-source": { value: "https://example.com/molen" },
    "#studio-article": { value: "" },
    "#studio-title": { value: "Untitled project" },
    "#studio-artist": { value: "" }
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector(selector) { return values[selector] || (values[selector] = { value: "", checked: false }); },
    getElementById(id) { return this.querySelector("#" + id); }
  };
  try {
  const calls = [];
  const messages = [];
  const api = async (path,data) => {
    calls.push(path);
    if (path === "studio/articles/import") return { text: ARTICLE, sourceUrl: "https://example.com/molen", title: "Dorpsnieuws" };
    if (path === "studio/projects") return { ...data,id: "9b5989a0-c982-45ce-a860-ed5466511227",revision:1,result:{} };
    if (path === "studio/chatgpt-lyrics/status") return { percent: 40, label: "Waiting for ChatGPT to finish" };
    if (path.endsWith("/chatgpt-lyrics")) return { result: BRIEF };
    throw new Error("unexpected " + path);
  };
  await studioPaste("url", { data: {} }, api, async () => {}, text => messages.push(text));
  assert.equal(values["#studio-article"].value, ARTICLE);
  assert.equal(values["#studio-title"].value, "Dorpsnieuws");
  assert.deepEqual(calls, ["studio/articles/import", "studio/projects", "studio/chatgpt-lyrics/status", "studio/projects/9b5989a0-c982-45ce-a860-ed5466511227/chatgpt-lyrics"]);
  assert.match(messages[0], /ChatGPT is writing the lyrics/);
  values["#studio-article"].value = "kort";
  calls.length = 0;
  await studioPaste("article", { data: {} }, api, async () => {}, () => {});
  assert.equal(calls.length, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("Chrome error paths stay on chatgpt.com and reuse a visible window", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chatgpt-"));
  const missing = new ChatGptLyricsBrowser({
    profileDir: join(dir, "missing", "profile"),
    seenFile: join(dir, "seen"),
    loader: async () => { throw new Error("not installed"); }
  });
  await assert.rejects(missing.generate(project()), /Playwright Core is not installed/);
  const unsupported = new ChatGptLyricsBrowser({
    profileDir: dir, seenFile: join(dir, "seen-2"),
    loader: async () => ({ chromium: {} })
  });
  await assert.rejects(unsupported.generate(project()), /does not support a persistent Chrome context/);
  const busy = new ChatGptLyricsBrowser({
    profileDir: dir, seenFile: join(dir, "seen-3"),
    loader: async () => ({ chromium: { async launchPersistentContext() { throw new Error("SingletonLock: profile in use"); } } })
  });
  await assert.rejects(busy.generate(project()), error => error.code === "chatgpt_busy" && error.status === 409);
  const chrome = new ChatGptLyricsBrowser({
    profileDir: dir, seenFile: join(dir, "seen-4"),
    loader: async () => ({ chromium: { async launchPersistentContext() { throw new Error("browser closed"); } } })
  });
  await assert.rejects(chrome.generate(project()), /Install Chrome/);
  const link = join(dir, "linked-profile");
  const { symlink } = await import("node:fs/promises");
  await symlink(dir, link);
  const linked = new ChatGptLyricsBrowser({ profileDir: link, loader: async () => { throw new Error("loader must not run"); } });
  await assert.rejects(linked.generate(project()), /Unsafe ChatGPT browser profile/);
  let created = false;
  const offsite = new ChatGptLyricsBrowser({
    profileDir: join(dir, "offsite"),
    seenFile: join(dir, "seen-off"),
    loader: async () => ({
      chromium: {
        async launchPersistentContext() {
          const page = {
            url() { return "https://evil.example/phish"; },
            async goto() {},
            async bringToFront() {}
          };
          return {
            pages: () => [],
            async newPage() { created = true; return page; },
            on() {},
            async close() { page.closed = true; }
          };
        }
      }
    })
  });
  await assert.rejects(offsite.generate(project()), /outside ChatGPT/);
  assert.equal(created, true);
  let opens = 0;
  let composer = false;
  const seenFile = join(dir, "reuse-seen");
  const reused = new ChatGptLyricsBrowser({
    seenFile,
    async launch() {
      opens += 1;
      return {
        async hasComposer() { return composer; },
        async bringToFront() {},
        async submit() { return FENCED; },
        async close() {}
      };
    }
  });
  await assert.rejects(reused.generate(project()), error => error.code === "chatgpt_login_required");
  composer = true;
  assert.equal((await reused.generate(project())).lyrics, "[Chorus] Molen in de wind");
  assert.equal(opens, 1);
  await writeFile(seenFile, "seen\n");
  composer = false;
  opens = 0;
  const switched = new ChatGptLyricsBrowser({
    seenFile,
    async launch(options) {
      opens += 1;
      return {
        headless: options.headless,
        async hasComposer() { return false; },
        async bringToFront() {},
        async close() {}
      };
    }
  });
  await assert.rejects(switched.generate({ ...project(), article: "" , sourceUrl: "" }), error => error.status === 400);
  assert.equal(opens, 0);
});

test("a held login window is closed before the next headless launch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chatgpt-"));
  const events = [];
  const browser = new ChatGptLyricsBrowser({
    profileDir: dir,
    seenFile: join(dir, "seen"),
    async launch(options) {
      events.push("launch:" + options.headless);
      return {
        async hasComposer() { return false; },
        async bringToFront() {},
        async close() { events.push("close:" + options.headless); }
      };
    }
  });
  await assert.rejects(browser.generate(project()), error => error.code === "chatgpt_login_required");
  await writeFile(join(dir, "seen"), "seen\n");
  await assert.rejects(browser.generate(project()), error => error.code === "chatgpt_login_required");
  assert.deepEqual(events, ["launch:false", "close:false", "launch:true", "close:true", "launch:false"]);
});

test("lyrics progress names each stage of the Safari handoff", () => {
  assert.deepEqual(lyricsProgress(0), { percent: 0, label: "Ready" });
  assert.equal(lyricsProgress(35).label, "Sending the article");
  assert.equal(lyricsProgress(70).label, "Waiting for ChatGPT to finish");
  assert.equal(lyricsProgress(90).label, "Reading the reply into Blossom");
  assert.equal(lyricsProgress(100).label, "Song brief placed in Blossom");
});

test("generation uses the signed-in Safari session instead of a blank Chrome profile", async () => {
  const calls = [];
  const browser = new ChatGptLyricsBrowser({
    transport: "system",
    runner(_file, args, _options, callback) {
      calls.push(args);
      callback(null, "REPLY\n" + FENCED);
    }
  });
  const brief = await browser.generate(project());
  assert.equal(brief.lyrics, "[Chorus] Molen in de wind");
  assert.equal(calls[0][0], "Safari");
  assert.match(calls[0][1], /oude molen/);
  assert.equal(JSON.stringify(calls).includes("chatgpt-playwright-profile"), false);
  const blocked = new ChatGptLyricsBrowser({
    transport: "system",
    runner(_file, _args, _options, callback) {
      const error = new Error("osascript");
      callback(error, "", "Allow JavaScript from Apple Events is turned off");
    }
  });
  await assert.rejects(blocked.generate(project()), error => {
    assert.equal(error.code, "chatgpt_login_required");
    assert.match(error.message, /Safari/);
    assert.match(error.message, /Allow JavaScript from Apple Events/);
    assert.equal(/Edge/.test(error.message), false);
    return true;
  });
});

test("a closed ChatGPT window opens again instead of an internal error", async () => {
  let opens = 0;
  const browser = new ChatGptLyricsBrowser({
    async launch() {
      opens += 1;
      const dead = opens === 1;
      return {
        async isOpen() { return !dead; },
        async hasComposer() {
          if (dead) throw new Error("locator.count: Target page, context or browser has been closed");
          return false;
        },
        async bringToFront() {},
        async close() {}
      };
    }
  });
  const error = await browser.generate(project()).then(() => null, reason => reason);
  assert.equal(error?.code, "chatgpt_login_required");
  assert.equal(error?.status, 409);
  assert.equal(opens, 2);
});

test("a signed-in Chrome profile submits the prompt and reads the brief", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chatgpt-"));
  const seenFile = join(dir, "seen");
  await writeFile(seenFile, "seen\n");
  const filled = [];
  const page = {
    visited: "",
    url() { return this.visited || "about:blank"; },
    async goto(url) { this.visited = url; },
    locator(selector) {
      const node = {
        async count() { return selector.includes("prompt-textarea") ? 1 : 0; },
        first() { return node; },
        last() { return node; },
        async click() {},
        async fill(value) { filled.push(value); },
        async waitFor() {},
        async innerText() { return FENCED; }
      };
      return node;
    },
    async waitForFunction() {},
    async bringToFront() { throw new Error("background run must not focus the window"); }
  };
  const browser = new ChatGptLyricsBrowser({
    profileDir: dir,
    seenFile,
    loader: async () => ({
      chromium: {
        async launchPersistentContext(_profile, options) {
          assert.equal(options.headless, true);
          return { pages: () => [page], on() {}, async close() {} };
        }
      }
    })
  });
  const brief = await browser.generate(project());
  assert.equal(brief.lyrics, "[Chorus] Molen in de wind");
  assert.equal(page.visited, "https://chatgpt.com/");
  assert.match(filled[0], /Country Pop/);
  assert.doesNotMatch(filled[0], /cookie|password|api_key/i);
});

function coded(message, status, code) {
  const error = new DomainError(message, status);
  error.code = code;
  return error;
}

async function boot(t, chatgptLyrics) {
  const store = new Store(":memory:");
  const localComposer = {
    generate: async () => BRIEF,
    ask: async () => ({ answer: "Use guitar" }),
    status: async () => ({ engine: "Ollama", model: "qwen3:8b", available: true })
  };
  const server = createAppServer({
    store, provider: { available: () => false }, password: "long-test-password", localComposer, chatgptLyrics
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { await new Promise(done => server.close(done)); store.close(); });
  const url = "http://127.0.0.1:" + server.address().port;
  const post = (path, body = {}, cookie = "", headers = {}) => fetch(url + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-blossom-request": "ui", ...(cookie ? { cookie } : {}), ...headers },
    body: JSON.stringify(body)
  });
  const login = await post("/auth/login", { username: "admin", password: "long-test-password" });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  return { store, post, cookie, url };
}

test("studio reports ChatGPT lyrics progress for the signed-in session", async t => {
  const dir = await mkdtemp(join(tmpdir(), "chatgpt-phase-"));
  const browser = new ChatGptLyricsBrowser({ profileDir: dir, transport: "system", runner() {} });
  browser.phaseFile = join(dir, "phase");
  await writeFile(browser.phaseFile, "40");
  const { url, cookie } = await boot(t, browser);
  const open = await fetch(url + "/api/studio/chatgpt-lyrics/status");
  assert.equal(open.status, 401);
  const status = await fetch(url + "/api/studio/chatgpt-lyrics/status", { headers: { cookie } });
  assert.equal(status.status, 200);
  const body = await status.json();
  assert.equal(body.percent, 40);
  assert.equal(body.label, "Waiting for ChatGPT to finish");
});

test("the studio progress bar shows the current ChatGPT stage", async () => {
  const { chatGptProgressMarkup, nextChatGptPercent } = await import("../public/studio.js");
  assert.equal(nextChatGptPercent(40, 8), 40);
  assert.equal(nextChatGptPercent(40, 70), 70);
  assert.equal(nextChatGptPercent(0, 8), 8);
  const html = chatGptProgressMarkup({ percent: 35, label: "Sending the article" });
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="35"/);
  assert.match(html, /width:35%/);
  assert.match(html, /Sending the article/);
  assert.doesNotMatch(html, /<script/i);
});

test("chatgpt-lyrics saves a brief and keeps the guards", async t => {
  const calls = [];
  const { post, cookie, store } = await boot(t, {
    async generate(project) {
      calls.push(project.article);
      return { ...BRIEF, lyrics: "[Chorus] Molen in de wind" };
    }
  });
  assert.equal((await post("/api/studio/projects/9b5989a0-c982-45ce-a860-ed5466511227/chatgpt-lyrics")).status, 401);
  const created = await post("/api/studio/projects", { title: "Test News", article: ARTICLE }, cookie);
  const project = await created.json();
  assert.equal((await post("/api/studio/projects/" + project.id + "/chatgpt-lyrics", {}, cookie, { Origin: "https://evil.example" })).status, 403);
  const saved = await post("/api/studio/projects/" + project.id + "/chatgpt-lyrics", {}, cookie);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).result.lyrics, "[Chorus] Molen in de wind");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /oude molen/);
  const legacy = await post("/api/studio/projects/" + project.id + "/chatgpt-extract", {}, cookie);
  assert.equal(legacy.status, 200);
  assert.equal((await legacy.json()).result.concept, BRIEF.concept);
  assert.equal(calls.length, 1);
  assert.equal(store.browserAccountStatus("chatgpt").state, "not_started");
});

test("login, busy, invalid replies and an empty project leave lyrics unchanged", async t => {
  let mode = "login";
  const { post, cookie } = await boot(t, {
    async generate() {
      if (mode === "login") throw coded("Sign in to ChatGPT in the opened Chrome window, then generate again.", 409, "chatgpt_login_required");
      if (mode === "busy") throw coded("ChatGPT generation is already running", 409, "chatgpt_busy");
      throw coded("ChatGPT reply was not a song brief", 502, "chatgpt_reply_invalid");
    }
  });
  const created = await post("/api/studio/projects", { title: "Empty", article: ARTICLE }, cookie);
  const project = await created.json();
  const login = await post("/api/studio/projects/" + project.id + "/chatgpt-lyrics", {}, cookie);
  assert.equal(login.status, 409);
  assert.equal((await login.json()).code, "chatgpt_login_required");
  mode = "busy";
  const busy = await post("/api/studio/projects/" + project.id + "/chatgpt-lyrics", {}, cookie);
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).code, "chatgpt_busy");
  mode = "bad";
  const bad = await post("/api/studio/projects/" + project.id + "/chatgpt-lyrics", {}, cookie);
  assert.equal(bad.status, 502);
  const empty = await post("/api/studio/projects", { title: "Blank", article: "", sourceUrl: "" }, cookie);
  const blank = await empty.json();
  const rejected = await post("/api/studio/projects/" + blank.id + "/chatgpt-lyrics", {}, cookie);
  assert.equal(rejected.status, 400);
  const listed = await fetch("http://127.0.0.1:" + new URL(login.url).port + "/api/studio/projects", { headers: { cookie } });
  const projects = await listed.json();
  const stored = projects.find(item => item.id === project.id);
  assert.equal(stored.result?.lyrics || "", "");
});
