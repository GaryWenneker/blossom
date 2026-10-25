import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/storage.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { StudioStore, sunoRecipe } from "../src/studio.mjs";
import { StudioReferences } from "../src/music-dna-studio.mjs";
import { dnaSunoPlan, annotateLyrics } from "../src/dna-suno-style.mjs";
import { officialSunoRequest } from "../src/providers/suno-platform.mjs";
import { studioView } from "../public/studio.js";

const parameters = {
  sunoModel: "v6", genre: "French punk rap", additionalStyles: ["programmed drums"],
  excludeStyles: [], vocalGender: "male", instrumental: false, maxMode: false,
  weirdness: 35, styleInfluence: 50, variety: 20, personalize: false,
  durationPreset: "album", targetSeconds: 180, lyricLanguage: "fr",
  customInstructions: "dry close vocal"
};

function traits(over) {
  return {
    referenceId: over.referenceId, weight: over.weight,
    genres: over.genres || [], moods: over.moods || [], bpm: over.bpm,
    vocals: over.vocals || {}, instruments: over.instruments || [],
    production: over.production || {}, structure: over.structure || []
  };
}

test("evidence caveats and performer notes stay out of the Suno line", () => {
  const plan = dnaSunoPlan([traits({
    referenceId: "ref-a", weight: 100, genres: ["New wave"], bpm: 130,
    vocals: { timbre: "Door recensies als hypnotisch beschreven" },
    instruments: [{
      name: "Electric bass",
      timbre: "Niet op audio uitgemeten",
      role: "Peter Hook"
    }],
    production: { texture: "Bandgeluid met funkachtige groove" }
  })]);
  assert.match(plan.style, /New wave/);
  assert.match(plan.style, /uptempo/);
  assert.match(plan.style, /Electric bass/);
  assert.doesNotMatch(plan.style, /Niet op audio|recensies|Peter Hook|unmeasured/i);
});

test("one reference leads with Suno tags and drops the weight phrase", () => {
  const plan = dnaSunoPlan([traits({
    referenceId: "ref-a", weight: 100, genres: ["French rock"], moods: ["melancholic"],
    bpm: 96, vocals: { type: "male", timbre: "dry" },
    instruments: [{ name: "Guitar", timbre: "clean" }],
    production: { texture: "roomy" },
    structure: [{ label: "Chorus", instruments: ["wide guitars"], techniques: ["stacked voices"] }]
  })]);
  assert.equal(plan.style.startsWith("French rock"), true);
  assert.match(plan.style, /mid-slow tempo/);
  assert.match(plan.style, /dry vocals/);
  assert.match(plan.style, /clean Guitar/);
  assert.match(plan.style, /roomy/);
  assert.doesNotMatch(plan.style, /inspiration weight|Noir|Desir/i);
  assert.ok(plan.characters <= 700);
  assert.deepEqual(plan.arrangement, [{ label: "Chorus", direction: "wide guitars, stacked voices" }]);
});

test("equal weights keep tempo and vocal with the first reference", () => {
  const plan = dnaSunoPlan([
    traits({ referenceId: "first", weight: 50, genres: ["chanson"], bpm: 90,
      vocals: { type: "male" }, instruments: [{ name: "Accordion" }] }),
    traits({ referenceId: "second", weight: 50, genres: ["punk"], bpm: 170,
      vocals: { type: "female" }, instruments: [{ name: "Distorted guitar" }] })
  ]);
  assert.match(plan.style, /mid-slow tempo/);
  assert.match(plan.style, /male vocals/);
  assert.match(plan.style, /punk/);
  assert.doesNotMatch(plan.style, /fast tempo|female vocals/);
  const second = plan.contributions.find(item => item.profileId === "second");
  assert.ok(second.tags.length <= 3);
  assert.ok(plan.characters <= 700);
});

test("a small weight contributes one tag and does not take the lead", () => {
  const plan = dnaSunoPlan([
    traits({ referenceId: "lead", weight: 80, genres: ["chanson"], bpm: 96,
      vocals: { type: "male" }, instruments: [{ name: "Accordion" }, { name: "Piano" }] }),
    traits({ referenceId: "color", weight: 20, genres: ["punk"], bpm: 170,
      vocals: { type: "female" }, instruments: [{ name: "Distorted guitar" }] })
  ]);
  const color = plan.contributions.find(item => item.profileId === "color");
  assert.deepEqual(color.tags, ["punk"]);
  assert.match(plan.style, /chanson/);
  assert.ok(plan.style.indexOf("chanson") < plan.style.indexOf("punk"));
});

test("DNA style stays inside the official 1000-character Suno request", () => {
  const lyrics = "[Verse]\nOriginal line\n[Chorus]\nOriginal refrain\n[Bridge: leave this note]";
  const project = {
    id: "p", title: "Original", artistId: "a", parameters, revision: 1,
    result: { lyrics, style: "x".repeat(900), titles: ["Original"] }
  };
  const plan = dnaSunoPlan([traits({
    referenceId: "ref-a", weight: 100, genres: ["French rock"], bpm: 96,
    vocals: { type: "male" }, instruments: [{ name: "Guitar" }],
    structure: [{ label: "Chorus", instruments: ["wide guitars"], techniques: [] }]
  })]);
  const recipe = sunoRecipe(project, plan);
  assert.equal(recipe.style.startsWith("French rock"), true);
  assert.equal(recipe.style.includes("x".repeat(40)), false);
  assert.match(recipe.style, /French punk rap/);
  assert.match(recipe.style, /dry close vocal/);
  assert.ok(recipe.style.length <= 1000);
  const request = officialSunoRequest(recipe);
  assert.equal(request.style, recipe.style);
  assert.match(recipe.lyrics, /\[Chorus: wide guitars\]/);
  assert.match(recipe.lyrics, /\[Verse\]/);
  assert.match(recipe.lyrics, /\[Bridge: leave this note\]/);
  const untouched = sunoRecipe(project, "");
  assert.match(untouched.style, /x{40}/);
  assert.equal(untouched.lyrics, lyrics);
});

test("lyric notes attach only to a matching header without a note", () => {
  const lyrics = annotateLyrics("[chorus]\nLine\n[Intro]\nHmm", [
    { label: "Chorus", direction: "wide guitars" }
  ]);
  assert.match(lyrics, /\[chorus: wide guitars\]/);
  assert.match(lyrics, /\[Intro\]/);
});

test("a recording with no genres or instruments cannot be linked", () => {
  const store = new Store(":memory:");
  try {
    const dna = new MusicDNA(store), studio = new StudioStore(store);
    const refs = new StudioReferences(store, studio, dna);
    const thin = dna.create({ artist: "Catalog Only", title: "Untitled take", sourceKind: "metadata" });
    dna.saveAnalysis(thin.id, {
      analysisMethod: "decoded PCM signal measurements (no instrument or vocal classification)",
      analyzer: "signal", bpm: 100, genres: [], moods: [], instruments: [], sections: []
    });
    const project = studio.save({
      title: "Fresh Composition",
      article: "A thoughtful, original paragraph about the changing seasons and an old family garden, with room for a story and emotion."
    });
    assert.throws(() => refs.set(project.id, [{ profileId: thin.id, weight: 50 }]), /no style traits/);
  } finally { store.close(); }
});

test("the DNA card shows the Suno line and disables a thin recording", () => {
  const html = studioView({ data: {
    artists: [], genres: {}, studioProjects: [], studioAssets: [], studioStatus: {},
    musicDnaProfiles: [
      { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", artist: "Noir Desir", title: "Le vent",
        analysisVersion: 1, analysis: { genres: ["rock"], instruments: [{ name: "Guitar" }] } },
      { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", artist: "Thin Song", title: "BPM only",
        analysisVersion: 1, analysis: { genres: [], instruments: [], bpm: 90 } }
    ],
    studioReferences: [{
      profileId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", weight: 50,
      profile: { artist: "Noir Desir", title: "Le vent" }
    }],
    studioDnaSuno: {
      style: "rock, mid-tempo, clean Guitar", characters: 31,
      contributions: [{ profileId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", weight: 50, tags: ["rock", "clean Guitar"] }],
      arrangement: []
    }
  } });
  assert.match(html, /Suno will be told/);
  assert.match(html, /rock, mid-tempo, clean Guitar/);
  assert.match(html, /Noir Desir · Le vent \(50%\)/);
  assert.match(html, /Thin Song · BPM only — no style traits yet/);
  assert.match(html, /<option value="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" disabled>/);
  assert.doesNotMatch(html, /inspiration weight/);
});
