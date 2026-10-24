import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Store } from "../src/storage.mjs";
import { StudioStore } from "../src/studio.mjs";
import { createAppServer } from "../src/server.mjs";
import { studioView } from "../public/studio.js";
import { focusFromDrag, photoFocus, objectPosition, savedFocus, applyPhotoFocus } from "../public/artist-focus.js";
import { artistPage } from "../public/artists.js";

const pngName = "12345678-1234-1234-1234-123456789abc.png";
const artistData = {
  name: "Evan Mercer", genre: "Country Pop", language: "en",
  countries: ["US"], voice: "male", dna: "Intimate male baritone and fingerpicked guitar"
};

test("Dragging down inside a portrait crop moves the focus toward the top", () => {
  assert.deepEqual(focusFromDrag({
    containerWidth: 1600, containerHeight: 900,
    naturalWidth: 800, naturalHeight: 1200,
    focusX: 50, focusY: 35, dx: 0, dy: 100
  }), { focusX: 50, focusY: 28 });
});

test("A one-pixel drag moves the preview by a fraction of a percent", () => {
  const preview = focusFromDrag({
    containerWidth: 1600, containerHeight: 900,
    naturalWidth: 800, naturalHeight: 1200,
    focusX: 50, focusY: 35, dx: 0, dy: 1, round: false
  });
  assert.equal(preview.focusX, 50);
  assert.ok(preview.focusY > 34 && preview.focusY < 35, String(preview.focusY));
});

test("A drag past either edge clamps the focus to 0 or 100", () => {
  const base = {
    containerWidth: 1600, containerHeight: 900,
    naturalWidth: 800, naturalHeight: 1200,
    focusX: 50, focusY: 35, dx: 0
  };
  assert.equal(focusFromDrag({ ...base, dy: -10000 }).focusY, 100);
  assert.equal(focusFromDrag({ ...base, dy: 10000 }).focusY, 0);
});

test("A drag does nothing when the photo already fills that axis", () => {
  assert.deepEqual(focusFromDrag({
    containerWidth: 800, containerHeight: 1200,
    naturalWidth: 800, naturalHeight: 1200,
    focusX: 50, focusY: 35, dx: 40, dy: -80
  }), { focusX: 50, focusY: 35 });
});

test("A studio asset uses the linked artist photo focus, otherwise 50/35", () => {
  assert.deepEqual(photoFocus(
    { id: "asset-1" },
    [{ sourceAssetId: "asset-1", focusX: 12, focusY: 8 }]
  ), { focusX: 12, focusY: 8 });
  assert.deepEqual(photoFocus({ focusX: 20, focusY: 15 }, []), { focusX: 20, focusY: 15 });
  assert.deepEqual(photoFocus({ id: "missing" }, []), { focusX: 50, focusY: 35 });
  assert.deepEqual(savedFocus({}), { focusX: 50, focusY: 35 });
  assert.deepEqual(savedFocus({ focusX: 20 }), { focusX: 20, focusY: 35 });
  assert.equal(objectPosition(20, 15), "20% 15%");
});

test("A new photo starts at focus 50/35 and a saved point is returned with the banner", () => {
  const db = new Store(":memory:");
  try {
    const studio = new StudioStore(db);
    const artist = db.addArtist(artistData);
    const second = db.addArtist({ ...artistData, name: "Copper Lantern" });
    const photo = studio.registerArtistPhoto(artist.id, {
      filename: pngName, mime: "image/png", provider: "chatgpt", prompt: "Wide banner"
    });
    assert.equal(photo.focusX, 50);
    assert.equal(photo.focusY, 35);
    assert.deepEqual(
      { focusX: studio.artistBanners()[artist.id].focusX, focusY: studio.artistBanners()[artist.id].focusY },
      { focusX: 50, focusY: 35 }
    );
    const other = studio.registerArtistPhoto(artist.id, {
      filename: pngName, mime: "image/png", provider: "chatgpt", prompt: "Second banner"
    });
    studio.setArtistImageFocus(artist.id, photo.id, { focusX: 20, focusY: 15 });
    studio.setArtistImageFocus(artist.id, photo.id, { focusX: 20, focusY: 15 });
    const images = studio.artistImages(artist.id);
    assert.equal(images.find(image => image.id === photo.id).focusX, 20);
    assert.equal(images.find(image => image.id === photo.id).focusY, 15);
    assert.equal(images.find(image => image.id === other.id).focusY, 35);
    studio.selectArtistImage(artist.id, photo.id);
    assert.equal(studio.artistBanners()[artist.id].focusY, 15);
    assert.throws(() => studio.setArtistImageFocus(second.id, photo.id, { focusX: 1, focusY: 1 }),
      /not found for this artist/);
    assert.equal(studio.artistImages(artist.id).find(image => image.id === photo.id).focusX, 20);
    assert.equal(studio.artistImages(artist.id).find(image => image.id === photo.id).focusY, 15);
    for (const body of [
      {},
      { focusX: 20 },
      { focusX: 1.5, focusY: 10 },
      { focusX: -1, focusY: 10 },
      { focusX: 101, focusY: 10 },
      { focusX: "20", focusY: 15 },
      { focusX: null, focusY: 15 }
    ]) {
      assert.throws(() => studio.setArtistImageFocus(artist.id, photo.id, body), /integer from 0 to 100/);
    }
    assert.equal(studio.artistImages(artist.id).find(image => image.id === photo.id).focusY, 15);
    assert.throws(() => studio.setArtistImageFocus(artist.id, second.id, { focusX: 10, focusY: 10 }),
      /not found/);
  } finally { db.close(); }
});

test("An artist photo table from before focus columns gains the default crop", () => {
  const db = new Store(":memory:");
  try {
    db.db.exec(`CREATE TABLE studio_artist_images (
      id TEXT PRIMARY KEY, artist_id TEXT NOT NULL, source_asset_id TEXT UNIQUE,
      filename TEXT NOT NULL, mime TEXT NOT NULL, provider TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      selected INTEGER NOT NULL DEFAULT 0, deleted_at TEXT)`);
    const artist = db.addArtist(artistData);
    const studio = new StudioStore(db);
    const photo = studio.registerArtistPhoto(artist.id, {
      filename: pngName, mime: "image/png", provider: "chatgpt", prompt: "Legacy banner"
    });
    assert.equal(photo.focusX, 50);
    assert.equal(photo.focusY, 35);
  } finally { db.close(); }
});

test("Focus endpoint saves one photo and rejects a bad point or the wrong artist", async t => {
  const db = new Store(":memory:");
  const artist = db.addArtist(artistData);
  const second = db.addArtist({ ...artistData, name: "Copper Lantern" });
  const studio = new StudioStore(db);
  const photo = studio.registerArtistPhoto(artist.id, {
    filename: pngName, mime: "image/png", provider: "chatgpt", prompt: "Wide banner"
  });
  const server = createAppServer({
    store: db, password: "long-test-password", provider: { available: () => false },
    localComposer: { status: async () => ({ available: false }) }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(done => server.close(done));
    db.close();
  });
  const url = "http://127.0.0.1:" + server.address().port;
  const login = await fetch(url + "/auth/login", {
    method: "POST", headers: { "content-type": "application/json", "x-blossom-request": "ui" },
    body: JSON.stringify({ username: "admin", password: "long-test-password" })
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const post = (urlPath, body) => fetch(url + urlPath, {
    method: "POST",
    headers: { cookie, "content-type": "application/json", "x-blossom-request": "ui" },
    body: JSON.stringify(body)
  });
  const saved = await post("/api/studio/artists/" + artist.id + "/images/" + photo.id + "/focus",
    { focusX: 20, focusY: 15 });
  assert.equal(saved.status, 200);
  const images = await saved.json();
  assert.equal(images.find(image => image.id === photo.id).focusX, 20);
  assert.equal(images.find(image => image.id === photo.id).focusY, 15);
  const bad = await post("/api/studio/artists/" + artist.id + "/images/" + photo.id + "/focus",
    { focusX: 20.5, focusY: 15 });
  assert.equal(bad.status, 400);
  const wrong = await post("/api/studio/artists/" + second.id + "/images/" + photo.id + "/focus",
    { focusX: 1, focusY: 1 });
  assert.equal(wrong.status, 404);
  const banners = await (await fetch(url + "/api/studio/artists/banners", { headers: { cookie } })).json();
  assert.equal(banners[artist.id].focusX, 20);
  assert.equal(banners[artist.id].focusY, 15);
  assert.equal((await fetch(url + "/artists.js")).status, 401);
  const pageScript = await fetch(url + "/artists.js", { headers: { cookie } });
  assert.equal(pageScript.status, 200);
  assert.match(await pageScript.text(), /artist-create-dialog/);
  const focusScript = await fetch(url + "/artist-focus.js", { headers: { cookie } });
  assert.equal(focusScript.status, 200);
  assert.match(await focusScript.text(), /focusFromDrag/);
});

test("Artists page opens create in a dialog and offers a focus control per photo", () => {
  const html = artistPage({
    genres: { pop: ["Country Pop"] },
    artists: [{
      id: "artist-1", name: "Evan Mercer", genre: "Country Pop", language: "en",
      voice: "male", dna: "Baritone", countries: ["US"]
    }],
    artistBanners: {
      "artist-1": { url: "/banner.png", focusX: 20, focusY: 15 }
    },
    artistImages: {
      "artist-1": [{
        id: "image-1", url: "/photo.png", selected: true, focusX: 20, focusY: 15
      }]
    }
  });
  const createAt = html.indexOf('<dialog id="artist-create-dialog"');
  const beforeDialog = html.slice(0, createAt);
  assert.equal(beforeDialog.includes('id="artist-form"'), false);
  assert.match(beforeDialog, /data-action="artist-create-open"/);
  assert.match(beforeDialog, />Create artist</);
  const createDialog = html.slice(createAt, html.indexOf("</dialog>") + "</dialog>".length);
  assert.match(createDialog, /id="artist-form"/);
  assert.match(createDialog, /name="dna"/);
  assert.match(createDialog, /data-action="artist-create-close"/);
  assert.match(html, /data-photo-focus data-focus-x="20" data-focus-y="15"/);
  assert.equal(html.includes('style="object-position:'), false);
  assert.match(html, /data-action="artist-focus-open"[^>]*data-focus-x="20"[^>]*data-focus-y="15"/);
  assert.match(html, /<img alt="Crop preview for the artist banner" draggable="false">/);
  assert.match(html, /data-action="artist-focus-save"/);
  assert.match(html, /data-action="artist-focus-cancel"/);
  assert.match(html, /<h2>Roster/);
  const plain = artistPage({
    artists: [{
      id: "artist-1", name: "Evan Mercer", genre: "Country Pop", language: "en",
      voice: "male", dna: "Baritone", countries: []
    }],
    artistBanners: { "artist-1": { url: "/banner.png" } },
    artistImages: { "artist-1": [{ id: "image-1", url: "/photo.png", selected: true }] }
  });
  assert.match(plain, /data-photo-focus data-focus-x="50" data-focus-y="35"/);
});

test("Studio artist preview uses the linked photo focus", () => {
  const state = {
    data: {
      artists: [{ id: "band-1", name: "Blue Meadow Quartet", genre: "Folk" }],
      genres: {},
      studioProjects: [{
        id: "project-1", title: "One", artistId: "band-1",
        parameters: {
          sunoModel: "v6", genre: "Folk", additionalStyles: [], excludeStyles: [],
          vocalGender: "mixed", instrumental: false, maxMode: false, weirdness: 20,
          styleInfluence: 75, variety: 40, personalize: false, targetSeconds: 205,
          durationPreset: "radio", customInstructions: ""
        },
        result: {}
      }],
      studioAssets: [{
        id: "image-1", kind: "artist-photo", selected: true, createdAt: "2026-10-24T12:00:00.000Z",
        provider: "chatgpt", briefMatch: "current", prompt: "", url: "/api/studio/assets/image-1/content"
      }],
      artistImages: {
        "band-1": [{ id: "lib-1", sourceAssetId: "image-1", focusX: 12, focusY: 8, url: "/photo.png", selected: true }]
      },
      artistBanners: {},
      studioStatus: {}, studioReferences: [], studioArtistPresets: {}, studioPresets: { radio: {} }
    }
  };
  const preview = studioView(state);
  assert.match(preview, /data-photo-focus data-focus-x="12" data-focus-y="8"/);
  assert.equal(preview.includes('style="object-position:'), false);
});

test("Saved focus is painted with the CSSOM so the crop is not dropped", () => {
  const img = {
    getAttribute(name) {
      return { "data-focus-x": "20", "data-focus-y": "15" }[name] ?? null;
    },
    style: {}
  };
  const missing = { getAttribute() { return null; }, style: {} };
  const bad = {
    getAttribute(name) {
      return { "data-focus-x": "101", "data-focus-y": "20.5" }[name] ?? null;
    },
    style: {}
  };
  applyPhotoFocus({ querySelectorAll: () => [img, missing, bad] });
  assert.equal(img.style.objectPosition, "20% 15%");
  assert.equal(missing.style.objectPosition, "50% 35%");
  assert.equal(bad.style.objectPosition, "50% 35%");
});

test("Focus preview dialog can be dragged and is styled as a crop frame", async () => {
  const css = await readFile(new URL("../public/viewport.css", import.meta.url), "utf8");
  assert.match(css, /#artist-focus-dialog/);
  assert.match(css, /\.artist-focus-frame\{[^}]*touch-action:none/);
  assert.match(css, /\.artist-focus-frame img\{[^}]*pointer-events:none/);
  assert.match(css, /\.artist-focus-frame img\{[^}]*-webkit-user-drag:none/);
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /artist-focus-save/);
  assert.match(app, /focusFromDrag/);
  assert.match(app, /artist-create-dialog/);
  assert.match(app, /applyPhotoFocus\(view\)/);
  assert.match(app, /round:false/);
  assert.match(app, /preventDefault\(\)/);
});
