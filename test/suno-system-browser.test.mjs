import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage.mjs";
import { StudioStore } from "../src/studio.mjs";
import { SunoSystemBrowser, buildSunoClipScript, buildSunoCoverScript, buildSunoCreateScript, copySunoMp3s, parseSunoHarvest, selectedCoverFile, sunoImageFile, titleDownloadMp3s } from "../src/suno-system-browser.mjs";

const recipe = { provider: "suno", lyrics: "[Verse]\nMy own lyrics",
  style: "organic country blues", exclude: "autotune",
  title: "My Original Song", instrumental: false };

function launcherOf(stdout = "CREATED") {
  const calls = [];
  const launcher = (cmd, args, _options, done) => {
    calls.push({ cmd, args: [...args] });
    done(null, stdout, "");
  };
  return { calls, launcher };
}

test("Suno create opens normal Safari and never passes Playwright flags", async () => {
  const { calls, launcher } = launcherOf();
  const browser = new SunoSystemBrowser({ launcher, platform: "darwin" });
  const opened = await browser.open();
  assert.equal(opened.application, "Safari");
  assert.equal(opened.apiConnected, false);
  assert.deepEqual(calls, [{
    cmd: "/usr/bin/open",
    args: ["-a", "Safari", "https://suno.com/create"]
  }]);
  assert.doesNotMatch(calls[0].args.join(" "), /--no-sandbox|--enable-automation|playwright/i);
});

test("Suno submit talks to normal Chrome and refuses a Google sign-in page", async () => {
  const { calls, launcher } = launcherOf("LOGIN");
  const browser = new SunoSystemBrowser({ launcher, platform: "darwin" });
  await assert.rejects(browser.submit(recipe), /Safari/);
  assert.equal(calls[0].cmd, "/usr/bin/osascript");
  assert.equal(calls[0].args.length, 2);
  assert.match(calls[0].args[0], /suno-safari-create\.applescript$/);
  const script = calls[0].args[1];
  assert.match(script, /location\.hostname!=="suno\.com"/);
  assert.match(script, /Lyrics editor|lyrics\/i/);
  assert.match(script, /song title/i);
  assert.match(script, /return"WAIT"/);
  assert.match(script, /My Original Song/);
  assert.doesNotMatch(script, /--no-sandbox|--enable-automation|navigator\.webdriver|stealth|AutomationControlled/i);
  const hostile = buildSunoCreateScript({
    ...recipe,
    title: '"); location="https://accounts.google.com/'
  });
  assert.doesNotMatch(hostile, /location="https:\/\/accounts\.google\.com\//);
});

test("Suno create clicks the song button, not the lyrics Generate control", () => {
  const script = buildSunoCreateScript(recipe);
  assert.match(script, /create song/i);
  assert.match(script, /return"WAIT"/);
  assert.doesNotMatch(script, /\^\(create\|generate\)\$/);
});

test("The Safari script keeps trying until the create page is ready", async () => {
  const source = await readFile(new URL("../scripts/suno-safari-create.applescript", import.meta.url), "utf8");
  assert.match(source, /lastStatus/);
  assert.match(source, /button "Create song"/);
  assert.doesNotMatch(source, /MISSING:" then return actionStatus/);
  assert.doesNotMatch(source, /NOBUTTON" then return actionStatus/);
});

test("The Chrome script only runs on suno.com/create and does not click Google", async () => {
  const source = await readFile(new URL("../scripts/suno-safari-create.applescript", import.meta.url), "utf8");
  assert.match(source, /https:\/\/suno\.com\/create/);
  assert.match(source, /https:\/\/accounts\.google\.com\//);
  assert.match(source, /return "LOGIN"/);
  assert.doesNotMatch(source, /--no-sandbox|webdriver|stealth/i);
  assert.doesNotMatch(source, /click.*[Gg]oogle/);
});

test("A disabled Suno Generate button is reported after the form is filled", async () => {
  const { launcher } = launcherOf("DISABLED");
  const browser = new SunoSystemBrowser({ launcher, platform: "darwin" });
  await assert.rejects(browser.submit(recipe), /Generate button is disabled/);
});

test("A finished normal-Chrome create is reported as submitted", async () => {
  const { launcher } = launcherOf("CREATED");
  const browser = new SunoSystemBrowser({ launcher, platform: "darwin" });
  const result = await browser.submit(recipe);
  assert.equal(result.submitted, true);
  assert.deepEqual(result.filled, ["lyrics", "styles", "exclude", "title"]);
  assert.equal(result.cover, "none");
});

const coverName = "12345678-1234-1234-1234-123456789abc.png";
const artistPhotoName = "22345678-1234-1234-1234-123456789abc.png";

test("the Suno handoff uses the selected album cover, not an artist photo", () => {
  const store = new Store(":memory:");
  try {
    const studio = new StudioStore(store);
    const project = studio.save({ title: "Covered" });
    const cover = studio.registerAsset(project.id, "cover", coverName, "image/png");
    const photo = studio.registerAsset(project.id, "artist-photo", artistPhotoName, "image/png");
    studio.selectAsset(project.id, cover.id, "cover");
    studio.selectAsset(project.id, photo.id, "artist-photo");
    assert.equal(selectedCoverFile(studio, project.id, "/assets"), "/assets/" + coverName);
    const bare = studio.save({ title: "No cover" });
    assert.equal(selectedCoverFile(studio, bare.id, "/assets"), null);
  } finally { store.close(); }
});

test("the create script marks songs that already exist before Create", () => {
  const script = buildSunoCreateScript(recipe);
  assert.match(script, /blossomSeen/);
  assert.match(script, /__blossomMarked/);
  const index = script.indexOf("__blossomMarked");
  assert.ok(index > -1 && index < script.indexOf('return"READY"'));
});

test("the cover script opens Song Details on a new clip and ignores the artist banner", () => {
  const script = buildSunoCoverScript({ title: "My Original Song" });
  assert.match(script, /Song Details/);
  assert.match(script, /image\//);
  assert.match(script, /blossom-cover-file/);
  assert.match(script, /blossomSeen/);
  assert.match(script, /My Original Song/);
  assert.doesNotMatch(script, /artist-photo|artist photo|Create Cover Art/i);
  const hostile = buildSunoCoverScript({ title: '"); location="https://accounts.google.com/' });
  assert.doesNotMatch(hostile, /location="https:\/\/accounts\.google\.com\//);
});

test("submit gives Safari the album cover as its own file-dialog argument", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blossom-cover-"));
  const cover = join(dir, coverName);
  await writeFile(cover, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const { calls, launcher } = launcherOf("CREATED_COVER");
  const browser = new SunoSystemBrowser({ launcher, platform: "darwin" });
  const result = await browser.submit(recipe, { coverFile: cover });
  assert.equal(calls[0].args.at(-1), cover);
  assert.ok(calls[0].args.length >= 4);
  assert.doesNotMatch(calls[0].args[1], /12345678-1234-1234-1234-123456789abc/);
  assert.equal(result.submitted, true);
  assert.equal(result.cover, "attached");
  assert.match(result.note, /album cover/i);
});

test("a cover that never reaches Song Details is not reported as attached", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blossom-cover-"));
  const cover = join(dir, coverName);
  await writeFile(cover, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const { launcher } = launcherOf("CREATED_NOCOVER");
  const browser = new SunoSystemBrowser({ launcher, platform: "darwin" });
  const result = await browser.submit(recipe, { coverFile: cover });
  assert.equal(result.submitted, true);
  assert.equal(result.cover, "missing");
  assert.match(result.note, /not attached/i);
});

test("the Safari script types the cover path into the file dialog and does not click Google", async () => {
  const source = await readFile(new URL("../scripts/suno-safari-create.applescript", import.meta.url), "utf8");
  assert.match(source, /CREATED_COVER/);
  assert.match(source, /CREATED_NOCOVER/);
  assert.match(source, /keystroke coverPath/);
  assert.match(source, /ignoring application responses/);
  assert.doesNotMatch(source, /click.*[Gg]oogle/);
  assert.match(source, /harvestClips/);
  assert.match(source, /CLIP_WAIT/);
  assert.match(source, /DOWNLOAD_CLICKED/);
  assert.match(source, /blossom-cover-file/);
  assert.match(source, /od -An -t x1/);
  assert.match(source, /aria-label/);
});

test("track art is the image sent to Suno, and the album cover is the fallback", () => {
  const store = new Store(":memory:");
  try {
    const studio = new StudioStore(store);
    const project = studio.save({ title: "Covered" });
    const cover = studio.registerAsset(project.id, "cover", coverName, "image/png");
    const track = studio.registerAsset(project.id, "track-art", artistPhotoName, "image/png");
    studio.selectAsset(project.id, cover.id, "cover");
    studio.selectAsset(project.id, track.id, "track-art");
    assert.equal(sunoImageFile(studio, project.id, "/assets"), "/assets/" + artistPhotoName);
    studio.deleteAsset(project.id, track.id);
    assert.equal(sunoImageFile(studio, project.id, "/assets"), "/assets/" + coverName);
  } finally { store.close(); }
});

test("the clip script waits for two completed new songs and never opens Create Cover Art", () => {
  const script = buildSunoClipScript(recipe);
  assert.match(script, /data-clip-status/);
  assert.match(script, /aria-label/);
  assert.match(script, /blossomSeen/);
  assert.match(script, /blossomDone/);
  assert.match(script, /CLIP_WAIT/);
  assert.match(script, /Song Details/);
  assert.match(script, /MP3/);
  assert.match(script, /My Original Song/);
  assert.doesNotMatch(script, /Create Cover Art|artist-photo/);
  const hostile = buildSunoClipScript({ title: '"); location="https://accounts.google.com/' });
  assert.doesNotMatch(hostile, /location="https:\/\/accounts\.google\.com\//);
});

test("harvest asks Safari to collect both finished songs", async () => {
  const { calls, launcher } = launcherOf("CREATED_COVER\n/tmp/one.mp3\n/tmp/two.mp3");
  const browser = new SunoSystemBrowser({ launcher, platform: "darwin" });
  const result = await browser.harvest(recipe);
  assert.equal(calls[0].args[1], "harvest");
  assert.match(calls[0].args[2], /data-clip-status/);
  assert.equal(result.art, "attached");
  assert.deepEqual(result.audioFiles, ["/tmp/one.mp3", "/tmp/two.mp3"]);
});

test("a harvest result that is not a finished create is rejected", () => {
  assert.throws(() => parseSunoHarvest("CLIP_WAIT"), /did not finish/);
});

test("only a real MP3 inside the home folder is copied", async () => {
  const home = await mkdtemp(join(tmpdir(), "blossom-home-"));
  const outside = await mkdtemp(join(tmpdir(), "blossom-outside-"));
  const assets = await mkdtemp(join(tmpdir(), "blossom-assets-"));
  const good = join(home, "song.mp3");
  const bad = join(outside, "song.mp3");
  const link = join(home, "linked.mp3");
  const audio = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200)]);
  await writeFile(good, audio);
  await writeFile(bad, audio);
  await symlink(bad, link);
  const saved = await copySunoMp3s([good, bad, link, "relative.mp3"], { assetDir: assets, home });
  assert.equal(saved.length, 1);
  assert.deepEqual(await readFile(join(assets, saved[0])), audio);
});

test("both generated songs become catalog tracks and keep the project artwork", () => {
  const store = new Store(":memory:");
  try {
    const studio = new StudioStore(store);
    const artist = store.addArtist({ name: "Fictional Singer", genre: "Country Pop", voice: "female", language: "en", countries: [], dna: "Acoustic guitars" });
    const project = studio.save({ title: "No Name on the Receipt", artistId: artist.id, parameters: { genre: "Country Pop" } });
    studio.setResult(project.id, { concept: "An original song about a receipt", lyrics: "[Verse]\nNo name", style: "house", exclusions: [], moods: [], titles: ["No Name on the Receipt"], coverPrompt: "square", artistPhotoPrompt: "wide", suggestedGenre: "House", rationale: "Original" });
    const trackArt = studio.registerAsset(project.id, "track-art", artistPhotoName, "image/png");
    studio.selectAsset(project.id, trackArt.id, "track-art");
    const ids = studio.linkSunoTakes(project.id, ["12345678-1234-1234-1234-123456789abc", "22345678-1234-1234-1234-123456789abd"]);
    assert.equal(ids.length, 2);
    assert.deepEqual(studio.linkSunoTakes(project.id, []), ids);
    const artwork = studio.linkedArtwork();
    assert.equal(artwork[ids[0]].projectId, project.id);
    assert.equal(artwork[ids[1]].trackArt, "/api/studio/assets/" + trackArt.id + "/content");
    assert.equal(artwork[ids[0]].trackArt, artwork[ids[1]].trackArt);
  } finally { store.close(); }
});

test("an existing Suno song is collected even when it was already on the page", () => {
  const script = buildSunoClipScript(recipe, { existing: true });
  assert.match(script, /const existing=true/);
  assert.match(script, /existing\?rows/);
  assert.match(script, /waits>4\)\{row\.dataset\.blossomStep="audio"/);
  assert.doesNotMatch(script, /Create Cover Art|accounts\.google\.com/);
});

test("MP3s already saved under the song title are imported without another Safari download", async () => {
  const home = await mkdtemp(join(tmpdir(), "blossom-home-"));
  const downloads = join(home, "Downloads");
  await mkdir(downloads);
  const first = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 1)]);
  const second = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 2)]);
  const wrong = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 3)]);
  await writeFile(join(downloads, "My Original Song.mp3"), first);
  await writeFile(join(downloads, "My Original Song-2.mp3"), second);
  await writeFile(join(downloads, "My Original Song.m4a"), first);
  await writeFile(join(downloads, "Someone Else.mp3"), wrong);
  const found = await titleDownloadMp3s(recipe.title, { home });
  assert.equal(found.length, 2);
  const bodies = await Promise.all(found.map(file => readFile(file)));
  assert.ok(bodies.some(body => body.equals(first)));
  assert.ok(bodies.some(body => body.equals(second)));
  const destination = join(home, "imported.mp3");
  const browser = new SunoSystemBrowser({
    launcher() { throw new Error("Safari should not run when the MP3 is already downloaded"); },
    platform: "darwin"
  });
  const result = await browser.downloadSelected(destination, { recipe, home });
  assert.equal(result.audioFiles.length, 2);
  assert.ok((await readFile(destination)).equals(first) || (await readFile(destination)).equals(second));
});

test("importing the song already in Safari downloads a checked MP3", async () => {
  const home = await mkdtemp(join(tmpdir(), "blossom-home-"));
  const destDir = await mkdtemp(join(tmpdir(), "blossom-dest-"));
  const source = join(home, "song.mp3");
  const destination = join(destDir, "imported.mp3");
  const audio = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200)]);
  await writeFile(source, audio);
  const { calls, launcher } = launcherOf("CREATED_COVER\n" + source);
  const browser = new SunoSystemBrowser({ launcher, platform: "darwin" });
  const result = await browser.downloadSelected(destination, { recipe, home });
  assert.equal(calls[0].args[1], "harvest");
  assert.match(calls[0].args[2], /const existing=true/);
  assert.equal(result.art, "attached");
  assert.deepEqual(result.audioFiles, [await realpath(source)]);
  assert.deepEqual(await readFile(destination), audio);
});

test("a downloaded file that is not an MP3 is rejected", async () => {
  const home = await mkdtemp(join(tmpdir(), "blossom-home-"));
  const source = join(home, "song.mp3");
  await writeFile(source, Buffer.alloc(200, 1));
  const { launcher } = launcherOf("CREATED\n" + source);
  const browser = new SunoSystemBrowser({ launcher, platform: "darwin" });
  await assert.rejects(
    () => browser.downloadSelected(join(tmpdir(), "not-audio.mp3"), { recipe, home }),
    /did not download the MP3/
  );
});

test("a Suno import with no downloaded MP3 is rejected", async () => {
  const { launcher } = launcherOf("CREATED_NOCOVER");
  const browser = new SunoSystemBrowser({ launcher, platform: "darwin" });
  await assert.rejects(
    () => browser.downloadSelected(join(tmpdir(), "missing.mp3"), { recipe }),
    /did not download the MP3/
  );
});
