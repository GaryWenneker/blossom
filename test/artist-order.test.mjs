import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";
import { bindArtistRoster, dragHandleMarkup, moveItem } from "../public/artist-order.js";

const artist = name => ({
  name, genre: "pop", language: "en", countries: ["NL"], voice: "female", dna: "Signature " + name
});

test("moveItem uses the album-track index insert and keeps a permutation", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(moveItem(ids, "a", "c"), ["b", "c", "a", "d"]);
  assert.deepEqual(ids, ["a", "b", "c", "d"]);
  assert.deepEqual(moveItem(ids, "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveItem(ids, "b", "b"), ["a", "b", "c", "d"]);
  assert.deepEqual(moveItem(ids, "missing", "a"), ids);
  assert.deepEqual(moveItem(ids, "a", "missing"), ids);
  for (const from of ids) for (const to of ids) {
    const next = moveItem(ids, from, to);
    assert.equal(next.length, ids.length);
    assert.deepEqual([...next].sort(), [...ids].sort());
  }
});

test("drag handle names the artist and does not activate the tile", () => {
  const markup = dragHandleMarkup('Mira & "Sol"');
  assert.match(markup, /class="artist-tile-handle"/);
  assert.match(markup, /draggable="true"/);
  assert.match(markup, /aria-label="Drag to reorder Mira &amp; &quot;Sol&quot;"/);
  assert.doesNotMatch(markup, /data-action/);
});

test("new artists stay newest-first until the roster is reordered", t => {
  const store = new Store(":memory:");
  t.after(() => store.close());
  const first = store.addArtist(artist("First"));
  const second = store.addArtist(artist("Second"));
  const third = store.addArtist(artist("Third"));
  assert.deepEqual(store.artists().map(item => item.name), ["Third", "Second", "First"]);
  assert.equal("sortOrder" in store.artists()[0], false);
  const ordered = store.reorderArtists([first.id, second.id, third.id]);
  assert.deepEqual(ordered.map(item => item.name), ["First", "Second", "Third"]);
  assert.deepEqual(store.artists().map(item => item.id), [first.id, second.id, third.id]);
  assert.throws(() => store.reorderArtists([first.id, second.id]), /exact permutation/);
  assert.throws(() => store.reorderArtists([first.id, second.id, second.id]), /exact permutation/);
  assert.throws(() => store.reorderArtists("nope"), /exact permutation/);
  assert.deepEqual(store.artists().map(item => item.id), [first.id, second.id, third.id]);
  const created = store.addArtist(artist("Fourth"));
  assert.equal(store.artists()[0].id, created.id);
  assert.deepEqual(store.artists().slice(1).map(item => item.id), [first.id, second.id, third.id]);
});

test("an existing artist table keeps newest-first until reorder survives reopen", t => {
  const dir = mkdtempSync(join(tmpdir(), "blossom-artists-"));
  const file = join(dir, "blossom.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const created = new DatabaseSync(file);
  created.exec(`CREATE TABLE artists (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    genre TEXT NOT NULL, language TEXT NOT NULL, countries TEXT NOT NULL, voice TEXT NOT NULL,
    dna TEXT NOT NULL, identity_verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`);
  const insert = created.prepare("INSERT INTO artists VALUES(?,?,?,?,?,?,?,?,?)");
  insert.run("old", "Older", "pop", "en", "[]", "female", "dna", 0, "2020-01-01T00:00:00.000Z");
  insert.run("new", "Newer", "pop", "en", "[]", "female", "dna", 0, "2024-01-01T00:00:00.000Z");
  created.close();
  const store = new Store(file);
  try {
    assert.deepEqual(store.artists().map(item => item.name), ["Newer", "Older"]);
    store.reorderArtists(["old", "new"]);
    assert.deepEqual(store.artists().map(item => item.id), ["old", "new"]);
  } finally {
    store.close();
  }
  const again = new Store(file);
  try {
    assert.deepEqual(again.artists().map(item => item.id), ["old", "new"]);
  } finally {
    again.close();
  }
});

test("POST /api/artists/order saves a permutation for the signed-in admin", async t => {
  const db = new Store(":memory:");
  const app = createAppServer({
    store: db, provider: { available: () => false }, password: "very-long-test-password"
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(async () => { await new Promise(resolve => app.close(resolve)); db.close(); });
  const root = "http://127.0.0.1:" + app.address().port;
  const anon = await fetch(root + "/api/artists/order", {
    method: "POST",
    headers: { "content-type": "application/json", "x-blossom-request": "ui" },
    body: JSON.stringify({ ids: [] })
  });
  assert.equal(anon.status, 401);
  const login = await fetch(root + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-blossom-request": "ui" },
    body: JSON.stringify({ username: "admin", password: "very-long-test-password" })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const req = async (path, json, headers = {}) => {
    const res = await fetch(root + path, {
      method: json === undefined ? "GET" : "POST",
      headers: { cookie, ...(json === undefined ? {} : { "content-type": "application/json", "x-blossom-request": "ui" }), ...headers },
      body: json === undefined ? undefined : JSON.stringify(json)
    });
    return { status: res.status, body: await res.json() };
  };
  const missingHeader = await req("/api/artists/order", { ids: [] }, { "x-blossom-request": "" });
  assert.equal(missingHeader.status, 403);
  const first = await req("/api/artists", artist("Alpha"));
  const second = await req("/api/artists", artist("Beta"));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const swapped = await req("/api/artists/order", { ids: [first.body.id, second.body.id] });
  assert.equal(swapped.status, 200);
  assert.deepEqual(swapped.body.map(item => item.name), ["Alpha", "Beta"]);
  assert.equal("sortOrder" in swapped.body[0], false);
  const repeat = await req("/api/artists/order", { ids: [first.body.id, second.body.id] });
  assert.deepEqual(repeat.body.map(item => item.id), [first.body.id, second.body.id]);
  const bad = await req("/api/artists/order", { ids: [first.body.id] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /exact permutation/);
  const listed = await req("/api/artists");
  assert.deepEqual(listed.body.map(item => item.name), ["Alpha", "Beta"]);
  const hidden = await fetch(root + "/artist-order.js");
  assert.equal(hidden.status, 401);
  const script = await fetch(root + "/artist-order.js", { headers: { cookie } });
  assert.equal(script.status, 200);
  assert.match(await script.text(), /export function moveItem/);
});

function card(id) {
  const node = {
    dataset: { artistId: id },
    classList: { add() {}, remove() {} },
    closest(selector) { return selector === ".artist-banner-card" ? node : null; }
  };
  node.handle = {
    closest(selector) {
      if (selector === ".artist-tile-handle") return node.handle;
      if (selector === ".artist-banner-card") return node;
      return null;
    }
  };
  return node;
}

function fakeDocument(cards, search = { value: "" }) {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    querySelectorAll(selector) { return selector === ".artist-banner-card" ? cards : []; },
    getElementById(id) { return id === "artist-search" ? search : null; }
  };
}

test("dropping a grip on another tile saves that order and restores search", async () => {
  const cards = [card("a"), card("b"), card("c")];
  const search = { value: "mi", dispatchEvent() { search.dispatched = (search.dispatched || 0) + 1; } };
  const doc = fakeDocument(cards, search);
  const state = { data: { artists: [{ id: "a" }, { id: "b" }, { id: "c" }] } };
  const calls = [];
  let refreshed = 0;
  bindArtistRoster(state, async (path, body) => {
    calls.push({ path, body });
    return body.ids.map(id => ({ id }));
  }, async () => { refreshed += 1; search.value = ""; }, () => {}, doc);
  const transfer = { setData() {}, effectAllowed: "" };
  await doc.listeners.dragstart[0]({ target: cards[0].handle, dataTransfer: transfer });
  const over = { target: cards[2], preventDefault() { over.defaultPrevented = true; } };
  doc.listeners.dragover[0](over);
  assert.equal(over.defaultPrevented, true);
  const event = { target: cards[2], preventDefault() { event.defaultPrevented = true; } };
  await doc.listeners.drop[0](event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(calls, [{ path: "artists/order", body: { ids: ["b", "c", "a"] } }]);
  assert.equal(refreshed, 1);
  assert.equal(search.value, "mi");
  assert.equal(search.dispatched, 1);
});

test("a failed or no-op drop does not reload the roster", async () => {
  const cards = [card("a"), card("b")];
  const doc = fakeDocument(cards);
  const state = { data: { artists: [{ id: "a" }, { id: "b" }] } };
  const notes = [];
  let refreshed = 0;
  let calls = 0;
  bindArtistRoster(state, async () => { calls += 1; throw new Error("nope"); }, async () => { refreshed += 1; }, message => notes.push(message), doc);
  const transfer = { setData() {}, effectAllowed: "" };
  await doc.listeners.dragstart[0]({ target: cards[0].handle, dataTransfer: transfer });
  await doc.listeners.drop[0]({ target: cards[0], preventDefault() {} });
  assert.equal(calls, 0);
  assert.equal(refreshed, 0);
  await doc.listeners.dragstart[0]({ target: cards[0].handle, dataTransfer: transfer });
  await doc.listeners.drop[0]({ target: cards[1], preventDefault() {} });
  assert.deepEqual(notes, ["nope"]);
  assert.equal(refreshed, 0);
  await doc.listeners.dragstart[0]({ target: cards[1], dataTransfer: transfer });
  await doc.listeners.drop[0]({ target: cards[0], preventDefault() {} });
  assert.equal(calls, 1);
});
