import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { MusicDnaMCP, musicDnaMcpToolNames } from "../src/music-dna-mcp.mjs";
import { invokeOperation, operationCatalog } from "../src/mcp-operations.mjs";

const READ = "r".repeat(32);
const WRITE = "w".repeat(32);
const ARTIST = {
  name: "Nocturne Vale", genre: "ambient", language: "instrumental",
  countries: ["CH"], voice: "instrumental", dna: "Soft drones"
};

function mcpFor(store, tokenMode) {
  const dna = new MusicDNA(store);
  return new MusicDnaMCP(dna, {
    readToken: READ,
    writeToken: tokenMode === "write" ? WRITE : "x".repeat(32)
  });
}

async function rpc(mcp, token, method, params = {}) {
  const server = createServer((req, res) => mcp.handle(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    assert.equal(response.status, 200);
    return response.json();
  } finally {
    await new Promise(done => server.close(done));
  }
}

test("operation catalog exposes label adjustments and withholds secrets", () => {
  const catalog = operationCatalog();
  const names = catalog.operations.map(item => item.name);
  assert.equal(catalog.operations.find(item => item.name === "artist_create").write, true);
  assert.equal(catalog.operations.find(item => item.name === "label_summary").write, false);
  assert.ok(names.includes("studio_project_create"));
  assert.ok(names.includes("catalog_album_create"));
  assert.ok(names.includes("release_distribute"));
  const withheld = catalog.withheld.map(item => item.name).sort();
  assert.deepEqual(withheld, ["binary_media", "browser_automation", "credentials", "gateway_admin", "website_lyrics"]);
  assert.equal(names.some(name => /password|apiKey|token|cookie/i.test(name)), false);
});

test("read token can see the catalog tools and cannot create an artist", async () => {
  const store = new Store(":memory:");
  const mcp = mcpFor(store, "read");
  const listed = await rpc(mcp, READ, "tools/list");
  const names = listed.result.tools.map(tool => tool.name);
  for (const name of ["blossom_operations", "blossom_invoke", "studio_projects", "music_dna_search"])
    assert.ok(names.includes(name), name);
  assert.deepEqual(musicDnaMcpToolNames({ write: false }).filter(name => name.startsWith("blossom_")),
    ["blossom_operations", "blossom_invoke"]);
  const denied = await rpc(mcp, READ, "tools/call", {
    name: "blossom_invoke",
    arguments: { operation: "artist_create", input: ARTIST }
  });
  assert.match(denied.error.message, /write/i);
  assert.equal(store.artists().length, 0);
  store.close();
});

test("write token creates an artist and lists it", async () => {
  const store = new Store(":memory:");
  const mcp = mcpFor(store, "write");
  const created = await rpc(mcp, WRITE, "tools/call", {
    name: "blossom_invoke",
    arguments: { operation: "artist_create", input: ARTIST }
  });
  assert.equal(created.error, undefined);
  const body = JSON.parse(created.result.content[0].text);
  assert.equal(body.name, "Nocturne Vale");
  const listed = await rpc(mcp, WRITE, "tools/call", {
    name: "blossom_invoke",
    arguments: { operation: "artists_list", input: {} }
  });
  const artists = JSON.parse(listed.result.content[0].text);
  assert.equal(artists.some(artist => artist.id === body.id), true);
  store.close();
});

test("unknown operations and credential fields are rejected", async () => {
  const store = new Store(":memory:");
  const dna = new MusicDNA(store);
  const ctx = { store, studio: null, dna, vault: null, studioApi: null, catalog: null,
    provider: null, allowLive: false, spotifyCatalog: null };
  await assert.rejects(() => invokeOperation(ctx, { operation: "connections_save", input: {} }, { write: true }),
    /Unknown operation/);
  await assert.rejects(() => invokeOperation(ctx, {
    operation: "artist_create",
    input: { ...ARTIST, apiKey: "secret-value" }
  }, { write: true }), /credentials/i);
  assert.equal(store.artists().length, 0);
  await assert.rejects(() => invokeOperation(ctx, {
    operation: "release_distribute", input: { id: "missing", confirmation: "no" }
  }, { write: true }), /PUBLISH/);
  store.close();
});
