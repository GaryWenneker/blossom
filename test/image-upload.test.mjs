import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainError } from "../src/domain.mjs";
import { MAX_UPLOAD_IMAGE_BYTES, validateUploadedImage } from "../src/image-bytes.mjs";
import { Store } from "../src/storage.mjs";
import { StudioStore } from "../src/studio.mjs";
import { createAppServer } from "../src/server.mjs";
import { studioView, STUDIO_ASSET_VERSION } from "../public/studio.js";

const png = () => {
  const bytes = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12);
  return bytes;
};
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 1)]);

test("uploaded images must be a real PNG or JPEG within 12MB", () => {
  assert.deepEqual(validateUploadedImage(png(), "image/png"), { mime: "image/png", extension: "png" });
  assert.equal(validateUploadedImage(jpeg(), "image/jpeg; charset=binary").extension, "jpg");
  assert.throws(() => validateUploadedImage(Buffer.from("not an image!!".padEnd(24, "!")), "image/png"),
    error => error instanceof DomainError && error.status === 400);
  assert.throws(() => validateUploadedImage(jpeg(), "image/png"),
    error => error.status === 400);
  assert.throws(() => validateUploadedImage(png(), "image/svg+xml"),
    error => error.status === 415);
  assert.throws(() => validateUploadedImage(Buffer.alloc(MAX_UPLOAD_IMAGE_BYTES + 1, 1), "image/jpeg"),
    error => error.status === 413);
});

test("banner, track art, and album art uploads stay in their own slots", async t => {
  const dir = await mkdtemp(join(tmpdir(), "blossom-image-upload-"));
  const db = new Store(":memory:");
  const artist = db.addArtist({
    name: "Blue Meadow Quartet", genre: "Indie Folk", language: "en",
    countries: ["NL"], voice: "mixed", dna: "Multi-part harmonies and acoustic instruments"
  });
  const server = createAppServer({
    store: db, password: "long-test-password", assetDir: dir,
    provider: { available: () => false },
    localComposer: { status: async () => ({ available: false }) }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(done => server.close(done));
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port;
  assert.equal((await fetch(base + "/api/studio/artists/" + artist.id + "/upload-banner", {
    method: "POST", headers: { "content-type": "image/png" }, body: png()
  })).status, 403);
  const login = await fetch(base + "/auth/login", {
    method: "POST", headers: { "content-type": "application/json", "x-blossom-request": "ui" },
    body: JSON.stringify({ username: "admin", password: "long-test-password" })
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const send = (path, body, type) => fetch(base + path, {
    method: "POST", headers: { cookie, "content-type": type, "x-blossom-request": "ui" }, body
  });

  const first = await send("/api/studio/artists/" + artist.id + "/upload-banner", jpeg(), "image/jpeg");
  assert.equal(first.status, 201);
  const banner = await first.json();
  assert.equal(banner.selected, true);
  assert.equal(banner.provider, "upload");
  const bannerBytes = await fetch(base + banner.url, { headers: { cookie } });
  assert.equal(bannerBytes.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await bannerBytes.arrayBuffer()), jpeg());

  const second = await send("/api/studio/artists/" + artist.id + "/upload-banner", png(), "image/png");
  assert.equal(second.status, 201);
  assert.equal((await second.json()).selected, false);
  const heroes = await (await fetch(base + "/api/studio/artists/banners", { headers: { cookie } })).json();
  assert.equal(heroes[artist.id].assetId, banner.id);

  const created = await send("/api/studio/projects", JSON.stringify({
    title: "Still by Hand", artistId: artist.id, article: "An original story"
  }), "application/json");
  const project = await created.json();
  const album = await send("/api/studio/projects/" + project.id + "/upload-image/cover", png(), "image/png");
  assert.equal(album.status, 201);
  const albumArt = await album.json();
  assert.equal(albumArt.kind, "cover");
  assert.equal(albumArt.selected, true);
  const track = await send("/api/studio/projects/" + project.id + "/upload-image/track-art", jpeg(), "image/jpeg");
  assert.equal(track.status, 201);
  const trackArt = await track.json();
  assert.equal(trackArt.kind, "track-art");
  assert.equal(trackArt.selected, true);
  assert.notEqual(trackArt.id, albumArt.id);
  const assets = await (await fetch(base + "/api/studio/projects/" + project.id + "/assets", { headers: { cookie } })).json();
  assert.equal(assets.find(asset => asset.kind === "cover" && asset.selected).id, albumArt.id);
  const heroesAfter = await (await fetch(base + "/api/studio/artists/banners", { headers: { cookie } })).json();
  assert.equal(heroesAfter[artist.id].assetId, banner.id, "album and track art do not become the artist banner");

  const again = await send("/api/studio/projects/" + project.id + "/upload-image/cover", jpeg(), "image/jpeg");
  const replaced = await again.json();
  assert.equal(replaced.selected, true);
  assert.equal(replaced.artistId, artist.id);
  const afterReplace = await (await fetch(base + "/api/studio/projects/" + project.id + "/assets", { headers: { cookie } })).json();
  assert.equal(afterReplace.find(asset => asset.kind === "cover" && asset.selected).id, replaced.id);
  const defaults = await (await fetch(base + "/api/studio/artists/covers", { headers: { cookie } })).json();
  assert.equal(defaults[artist.id].assetId, replaced.id);
  const rejected = await send("/api/studio/projects/" + project.id + "/upload-image/cover", Buffer.from("not-a-png".padEnd(24, "x")), "image/png");
  assert.equal(rejected.status, 400);
  const orphan = await (await fetch(base + "/api/studio/projects/" + project.id + "/assets", { headers: { cookie } })).json();
  assert.equal(orphan.filter(asset => asset.kind === "cover").length, 2);

  const bare = await send("/api/studio/projects", JSON.stringify({ title: "No artist", article: "Words" }), "application/json");
  const bareProject = await bare.json();
  const blocked = await send("/api/studio/projects/" + bareProject.id + "/upload-image/artist-photo", png(), "image/png");
  assert.equal(blocked.status, 409);

  const brief = await send("/api/studio/projects/" + project.id + "/result", JSON.stringify({
    concept: "Hands and daylight", lyrics: "Original verse"
  }), "application/json");
  assert.equal(brief.status, 200);
  const linked = await send("/api/studio/projects/" + project.id + "/create-track", JSON.stringify({}), "application/json");
  assert.equal(linked.status, 201);
  const song = await linked.json();
  const script = await fetch(base + "/image-upload.js", { headers: { cookie } });
  assert.equal(script.status, 200);
  assert.match(await script.text(), /uploadImageFile/);
  const catalog = await (await fetch(base + "/api/studio/artwork", { headers: { cookie } })).json();
  assert.equal(catalog[song.track.id].projectId, project.id);
  assert.equal(catalog[song.track.id].albumArt, replaced.url);
  assert.equal(catalog[song.track.id].trackArt, trackArt.url);
});

test("a project shows its artist's cover and not another artist's selected cover", () => {
  const store = new Store(":memory:");
  try {
    const norrlight = store.addArtist({
      name: "Norrlight", genre: "Melodic house", language: "en",
      countries: ["SE"], voice: "mixed", dna: "Night drive"
    });
    const evan = store.addArtist({
      name: "Evan Mercer", genre: "Country pop", language: "en",
      countries: ["US"], voice: "male", dna: "Open road"
    });
    const studio = new StudioStore(store);
    const project = studio.save({ title: "No Name on the Receipt", artistId: norrlight.id, article: "A receipt" });
    const older = "12345678-1234-1234-1234-123456789abc.png";
    const newer = "22345678-1234-1234-1234-123456789abc.png";
    const oldId = "32345678-1234-1234-1234-123456789abc";
    const newId = "42345678-1234-1234-1234-123456789abc";
    store.db.prepare(`INSERT INTO studio_assets(id,project_id,kind,filename,mime,created_at,provider,prompt,selected)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(oldId, project.id, "cover", older, "image/png", "2026-10-24T11:00:00.000Z", "chatgpt", "Evan Mercer", 1);
    store.db.prepare(`INSERT INTO studio_assets(id,project_id,kind,filename,mime,created_at,provider,prompt,selected)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(newId, project.id, "cover", newer, "image/png", "2026-10-24T13:44:00.000Z", "upload", "", 0);
    new StudioStore(store);
    const assets = studio.assets(project.id);
    assert.equal(assets.find(asset => asset.selected && asset.kind === "cover").id, newId);
    assert.equal(assets.find(asset => asset.id === newId).artistId, norrlight.id);
    assert.equal(assets.find(asset => asset.id === oldId).selected, false);
    assert.equal(assets.find(asset => asset.id === oldId).artistId, "");
    const moved = studio.save({ ...project, artistId: evan.id });
    const html = studioView({
      data: {
        studioProjects: [moved], studioAssets: studio.assets(moved.id), artists: [norrlight, evan],
        genres: {}, musicDnaProfiles: [], studioReferences: [], artistBanners: {}, artistImages: {},
        artistCovers: studio.artistCovers(),
        studioStatus: { studioVersion: STUDIO_ASSET_VERSION }
      }
    });
    const preview = html.split("Album artwork prompt")[0];
    assert.doesNotMatch(preview, new RegExp(newer));
    assert.doesNotMatch(preview, new RegExp(older));
    assert.match(preview, /ALBUM ART/);
    const own = studio.save({ title: "Second song", artistId: norrlight.id, article: "Another" });
    const ownHtml = studioView({
      data: {
        studioProjects: [own], studioAssets: [], artists: [norrlight],
        genres: {}, musicDnaProfiles: [], studioReferences: [], artistBanners: {}, artistImages: {},
        artistCovers: studio.artistCovers(),
        studioStatus: { studioVersion: STUDIO_ASSET_VERSION }
      }
    });
    assert.match(ownHtml.split("Album artwork prompt")[0], new RegExp(newId));
  } finally { store.close(); }
});

test("the screens offer an upload for each image", async () => {
  const studio = await readFile(new URL("../public/studio.js", import.meta.url), "utf8");
  const artists = await readFile(new URL("../public/artists.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(studio, /Upload album art/);
  assert.match(studio, /Generate track art with ChatGPT/);
  assert.match(studio, /Upload track art/);
  assert.match(studio, /Upload artist banner/);
  assert.match(artists, /Upload banner/);
  assert.match(app, /data-image-upload="track-art"/);
  assert.match(app, /data-image-upload="cover"/);
});
