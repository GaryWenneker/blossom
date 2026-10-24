import assert from "node:assert/strict";
import test from "node:test";
import { MusicDNA } from "../src/music-dna.mjs";
import { StudioReferences, artistMusicStyle } from "../src/music-dna-studio.mjs";
import { Store } from "../src/storage.mjs";
import { StudioAPI } from "../src/studio-api.mjs";
import { sunoRecipe } from "../src/studio.mjs";
import { buildChatGptLyricsPrompt } from "../src/chatgpt-playwright.mjs";

const analysis = {
  genres: ["country"],
  moods: ["wistful"],
  bpm: 92,
  musicalKey: "G",
  instruments: [{ name: "baritone guitar", technique: "fingerpicked", timbre: "warm", role: "lead" }],
  vocals: { timbre: "close", delivery: "spoken" },
  production: { texture: "dry", dynamics: "quiet" },
  sections: [],
  analysisMethod: "editorial",
  analyzer: "test"
};

function world() {
  const store = new Store(":memory:");
  const dna = new MusicDNA(store);
  const artist = store.addArtist({
    name: "Mira Solenne", genre: "Country", language: "en", countries: ["NL"],
    voice: "female", dna: "fingerpicked baritone, leave out autotune", identityVerified: true
  });
  const own = dna.create({ artist: "Mira Solenne", title: "Secret Hook Title", sourceKind: "manual" });
  dna.saveAnalysis(own.id, analysis);
  const other = dna.create({ artist: "Other Person", title: "Unrelated", sourceKind: "manual" });
  dna.saveAnalysis(other.id, { ...analysis, instruments: [{ name: "tuba", technique: "oompah", timbre: "blatty", role: "bass" }] });
  const api = new StudioAPI({
    store,
    vault: { list() { return {}; }, read() { return null; } },
    articleImporter: async () => ({ text: "" }),
    chatgptLyrics: { async generate() {}, async progress() { return {}; } }
  });
  const project = api.studio.save({
    title: "Drive Home",
    artistId: artist.id,
    article: "A long enough authorized article about a quiet drive home through winter hills and a parked car."
  });
  const inspiration = dna.create({ artist: "Other Person", title: "Chosen Inspiration", sourceKind: "manual" });
  dna.saveAnalysis(inspiration.id, {
    ...analysis,
    instruments: [{ name: "brush snare", technique: "swung", timbre: "soft", role: "drums" }]
  });
  new StudioReferences(store, api.studio, dna).set(project.id, [{ profileId: inspiration.id, weight: 70 }]);
  return { store, dna, api, project };
}

test("Finding an artist pulls that artist's DNA and selected Music DNA into Suno extraction", () => {
  const { api, project } = world();
  const context = api.extractionProject(project);
  assert.match(context.artistDna, /fingerpicked baritone/);
  assert.equal(context.artistMusicDna.some(item => item.instruments.some(i => i.name === "baritone guitar")), true);
  assert.equal(JSON.stringify(context.artistMusicDna).includes("Secret Hook Title"), false);
  assert.equal(context.referenceDna.some(item => item.instruments.some(i => i.name === "brush snare")), true);
  assert.equal(context.artistMusicDna.some(item => item.instruments.some(i => i.name === "tuba")), false);

  const prompt = buildChatGptLyricsPrompt(context);
  assert.match(prompt, /must follow that artist DNA/);
  assert.match(prompt, /fingerpicked baritone/);
  assert.match(prompt, /baritone guitar/);
  assert.match(prompt, /brush snare/);
  assert.equal(prompt.includes("Secret Hook Title"), false);

  const recipe = api.sunoBrief(project);
  assert.match(recipe.style, /fingerpicked baritone/);
  assert.match(recipe.style, /baritone guitar/);
  assert.match(recipe.style, /brush snare/);
});

test("A Suno recipe keeps artist DNA even when no inspiration is selected", () => {
  const recipe = sunoRecipe({
    title: "Drive Home",
    artistDna: "fingerpicked baritone, leave out autotune",
    parameters: { genre: "Country", additionalStyles: [], excludeStyles: [], instrumental: false, vocalGender: "female" },
    result: { lyrics: "", style: "quiet country", titles: ["Drive Home"], exclusions: [] }
  }, artistMusicStyle([]));
  assert.match(recipe.style, /fingerpicked baritone/);
});
