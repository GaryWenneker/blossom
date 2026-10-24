import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { MusicDNA } from "../src/music-dna.mjs";
import { StudioReferences } from "../src/music-dna-studio.mjs";
import { Store } from "../src/storage.mjs";
import { StudioAPI } from "../src/studio-api.mjs";
import { access } from "node:fs/promises";

const analysis = {
  genres: ["country"], moods: ["quiet"], bpm: 90, musicalKey: "G",
  instruments: [{ name: "guitar", technique: "picked", timbre: "warm", role: "lead" }],
  vocals: { timbre: "close", delivery: "soft" },
  production: { texture: "dry", dynamics: "quiet" },
  sections: [], analysisMethod: "editorial", analyzer: "test"
};

test("Deleting a Studio project removes the draft and keeps the artist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blossom-project-delete-"));
  const store = new Store(":memory:");
  const api = new StudioAPI({
    store, assetDir: dir,
    vault: { list() { return {}; }, read() { return null; } },
    articleImporter: async () => ({ text: "" }),
    chatgptLyrics: { async generate() {}, async progress() { return {}; } }
  });
  const artist = store.addArtist({
    name: "Mira Solenne", genre: "Country", language: "en", countries: ["NL"],
    voice: "female", dna: "fingerpicked baritone", identityVerified: true
  });
  const keep = api.studio.save({ title: "You Tell Me Where", artistId: artist.id });
  const drop = api.studio.save({ title: "Untitled project", artistId: artist.id });
  const track = store.addTrack({
    artistId: artist.id, title: "Kept song", mode: "vocal", concept: "A kept song",
    lyrics: "original line", stage: "draft"
  });
  api.studio.db.prepare("UPDATE studio_projects SET track_id=? WHERE id=?").run(track.id, drop.id);
  const cover = randomUUID() + ".png";
  const portrait = randomUUID() + ".png";
  await writeFile(join(dir, cover), Buffer.from("cover"));
  await writeFile(join(dir, portrait), Buffer.from("portrait"));
  const coverAsset = api.studio.registerAsset(drop.id, "cover", cover, "image/png");
  const photoAsset = api.studio.registerAsset(drop.id, "artist-photo", portrait, "image/png");
  api.studio.linkArtistImage(artist.id, photoAsset.id, { select: true });
  const dna = new MusicDNA(store);
  const profile = dna.create({ artist: "Mira Solenne", title: "Reference", sourceKind: "manual" });
  dna.saveAnalysis(profile.id, analysis);
  new StudioReferences(store, api.studio, dna).set(drop.id, [{ profileId: profile.id, weight: 40 }]);

  const response = await post(api, "/api/studio/projects/" + drop.id + "/delete");
  assert.equal(response.status, 200);
  assert.equal(response.body.deleted, drop.id);
  assert.equal(api.studio.projects().some(project => project.id === drop.id), false);
  assert.equal(api.studio.projects().some(project => project.id === keep.id), true);
  assert.equal(store.track(track.id).title, "Kept song");
  assert.equal(store.artist(artist.id).name, "Mira Solenne");
  const image = api.studio.db.prepare(
    "SELECT filename, source_asset_id FROM studio_artist_images WHERE artist_id=? AND deleted_at IS NULL"
  ).get(artist.id);
  assert.equal(image.filename, portrait);
  assert.equal(image.source_asset_id, null);
  assert.equal(api.studio.db.prepare("SELECT COUNT(*) AS n FROM studio_assets WHERE id=?").get(coverAsset.id).n, 0);
  assert.equal(api.studio.db.prepare("SELECT COUNT(*) AS n FROM studio_music_dna_refs WHERE project_id=?").get(drop.id).n, 0);
  await assert.rejects(access(join(dir, cover)));
  await access(join(dir, portrait));
  await assert.rejects(() => post(api, "/api/studio/projects/" + drop.id + "/delete"), /not found/i);
});

function post(api, path) {
  const req = {
    method: "POST",
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() { yield Buffer.from("{}"); }
  };
  const res = { status: 0, text: "", writeHead(code) { this.status = code; }, end(data) { this.text = data; } };
  return api.handle(req, res, path).then(() => ({ status: res.status, body: res.text ? JSON.parse(res.text) : {} }));
}
