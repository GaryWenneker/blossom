import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { createServer as reservePort } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage.mjs";
import { StudioStore } from "../src/studio.mjs";
import { createAppServer } from "../src/server.mjs";
import { inspectUploadedImage } from "../src/uploaded-image.mjs";
import { clipboardImage } from "../public/image-paste.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1cAAAAASUVORK5CYII=", "base64");

function jpeg(width, height) {
  const data = Buffer.alloc(21);
  data[0] = 0xff; data[1] = 0xd8;
  data[2] = 0xff; data[3] = 0xe0; data.writeUInt16BE(4, 4);
  data[8] = 0xff; data[9] = 0xc0; data.writeUInt16BE(11, 10); data[12] = 0x08;
  data.writeUInt16BE(height, 13);
  data.writeUInt16BE(width, 15);
  return data;
}

function webp(width, height) {
  const data = Buffer.alloc(30);
  data.write("RIFF", 0); data.writeUInt32LE(22, 4); data.write("WEBP", 8);
  data.write("VP8X", 12); data.writeUInt32LE(10, 16);
  const w = width - 1, h = height - 1;
  data[24] = w & 255; data[25] = (w >> 8) & 255; data[26] = (w >> 16) & 255;
  data[27] = h & 255; data[28] = (h >> 8) & 255; data[29] = (h >> 16) & 255;
  return data;
}

test("uploaded images accept PNG, JPEG, and WebP and reject everything else", () => {
  assert.deepEqual(inspectUploadedImage(png), { mime: "image/png", extension: "png", width: 1, height: 1 });
  assert.deepEqual(inspectUploadedImage(jpeg(12, 8)), { mime: "image/jpeg", extension: "jpg", width: 12, height: 8 });
  assert.deepEqual(inspectUploadedImage(webp(16, 9)), { mime: "image/webp", extension: "webp", width: 16, height: 9 });
  assert.throws(() => inspectUploadedImage(Buffer.from("not an image")), /PNG, JPEG, or WebP/);
  assert.throws(() => inspectUploadedImage(jpeg(10, 12), { square: true }), /square/);
  assert.equal(inspectUploadedImage(jpeg(10, 10), { square: true }).width, 10);
});

test("a pasted or chosen file is an image only when the clipboard holds PNG, JPEG, or WebP", () => {
  const photo = { type: "image/jpeg", name: "band.jpg" };
  assert.equal(clipboardImage({ files: [photo] }), photo);
  assert.equal(clipboardImage({ files: [{ type: "image/jpg", name: "band.jpg" }] }).type, "image/jpg");
  assert.equal(clipboardImage({ items: [{ kind: "file", getAsFile: () => ({ type: "image/png" }) }] }).type, "image/png");
  assert.equal(clipboardImage({ files: [{ type: "image/gif" }], items: [] }), null);
  assert.equal(clipboardImage(null), null);
});

test("an artist gallery stores an uploaded JPEG and refuses a non-image name", () => {
  const store = new Store(":memory:");
  try {
    const studio = new StudioStore(store), artist = store.addArtist({
      name: "Upload Band", genre: "Rock", language: "en", countries: ["NL"], voice: "mixed", dna: "Wide photo"
    });
    const image = studio.registerArtistPhoto(artist.id, {
      filename: "12345678-1234-4234-8234-123456789abc.jpg", mime: "image/jpeg", provider: "upload"
    });
    assert.equal(image.provider, "upload");
    assert.equal(image.selected, true);
    const extra = studio.registerArtistPhoto(artist.id, {
      filename: "12345678-1234-4234-8234-123456789abd.webp", mime: "image/webp", provider: "upload"
    });
    assert.equal(extra.selected, false);
    assert.equal(studio.artistImages(artist.id).find(item => item.selected).id, image.id);
    assert.throws(() => studio.registerArtistPhoto(artist.id, {
      filename: "12345678-1234-4234-8234-123456789abc.gif", mime: "image/gif", provider: "upload"
    }), /Unsupported artist photo/);
  } finally { store.close(); }
});

test("an uploaded studio image replaces the selected cover or artist photo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "blossom-upload-"));
  const store = new Store(join(dir, "db"));
  const studio = new StudioStore(store);
  const artist = store.addArtist({
    name: "Upload Band", genre: "Rock", language: "en", countries: ["NL"], voice: "mixed", dna: "Wide photo"
  });
  const project = studio.save({ title: "Uploaded cover", artistId: artist.id });
  const first = studio.registerAsset(project.id, "cover", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png", "image/png", { provider: "upload" });
  studio.selectAsset(project.id, first.id, "cover");
  const reserved = reservePort();
  reserved.listen(0, "127.0.0.1");
  await once(reserved, "listening");
  const port = reserved.address().port;
  await new Promise(resolve => reserved.close(resolve));
  const base = "http://127.0.0.1:" + port;
  const server = createAppServer({
    store, assetDir: dir, publicUrl: base, password: "upload-password",
    provider: { available: () => false }, localComposer: { status: async () => ({ available: false }) }
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  try {
    const login = await fetch(base + "/auth/login", {
      method: "POST", headers: { "content-type": "application/json", "x-blossom-request": "ui" },
      body: JSON.stringify({ username: "admin", password: "upload-password" })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const post = (path, body, type) => fetch(base + path, {
      method: "POST", headers: { cookie, "content-type": type, "x-blossom-request": "ui" }, body
    });
    const cover = await post("/api/studio/projects/" + project.id + "/upload-image?kind=cover", jpeg(8, 8), "image/jpeg");
    assert.equal(cover.status, 201);
    const saved = await cover.json();
    assert.equal(saved.selected, true);
    assert.equal(saved.mime, "image/jpeg");
    const alias = await post("/api/studio/projects/" + project.id + "/upload-image?kind=cover", jpeg(8, 8), "image/jpg");
    assert.equal(alias.status, 201);
    assert.equal((await alias.json()).mime, "image/jpeg");
    assert.equal(studio.assets(project.id).filter(item => item.kind === "cover" && item.selected).length, 1);
    const portrait = await post("/api/studio/projects/" + project.id + "/upload-image?kind=artist-photo", jpeg(16, 9), "image/jpeg");
    assert.equal(portrait.status, 201);
    const linked = await portrait.json();
    assert.equal(linked.selected, true);
    assert.equal(studio.artistImages(artist.id).find(item => item.selected).sourceAssetId, linked.id);
    const wide = jpeg(16, 9);
    const gallery = await post("/api/studio/artists/" + artist.id + "/photos", wide, "image/jpeg");
    assert.equal(gallery.status, 201);
    const added = await gallery.json();
    assert.equal(added.selected, false);
    assert.equal(studio.artistImages(artist.id).find(item => item.selected).sourceAssetId, linked.id);
    const created = await fetch(base + "/api/albums", {
      method: "POST", headers: { cookie, "content-type": "application/json", "x-blossom-request": "ui" },
      body: JSON.stringify({ artistId: artist.id, title: "Square", kind: "album" })
    });
    assert.equal(created.status, 201);
    const album = await created.json();
    const square = await post("/api/albums/" + album.id + "/cover?expectedRevision=" + album.revision, jpeg(8, 8), "image/jpeg");
    assert.equal(square.status, 200);
    const savedCover = await square.json();
    assert.equal(savedCover.coverUrl, "/api/albums/" + album.id + "/cover");
    const wideCover = await post("/api/albums/" + album.id + "/cover?expectedRevision=" + savedCover.revision, jpeg(16, 9), "image/jpeg");
    assert.equal(wideCover.status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
