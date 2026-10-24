import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/storage.mjs";
import { StudioStore } from "../src/studio.mjs";
import { projectPickerMarkup, projectSongTitle, studioActiveId, studioInput } from "../public/studio.js";

const parameters = (genre, note) => ({
  sunoModel: "v6", lyricLanguage: "en", genre, additionalStyles: ["Americana"],
  excludeStyles: ["Auto-Tune"], vocalGender: "male", instrumental: false, maxMode: false,
  weirdness: 22, styleInfluence: 75, variety: 40, personalize: false,
  durationPreset: "radio", targetSeconds: 205, customInstructions: note,
  imagePrompt: genre + " cover", artistPhotoPrompt: genre + " photo"
});

test("Each project keeps its own title, lyrics and generation settings", () => {
  const store = new Store(":memory:");
  const studio = new StudioStore(store);
  const artist = store.addArtist({
    name: "Norright", genre: "Melodic House", language: "en", countries: ["NL"],
    voice: "male", dna: "172 BPM melodic house", identityVerified: true
  });
  const first = studio.save({
    title: "Untitled project", artistId: artist.id, article: "A border story long enough to keep.",
    parameters: parameters("Country Pop", "warm vocal"),
    result: { concept: "A drive", lyrics: "alpha verse", titles: ["You Tell Me Where"], style: "country", exclusions: [], moods: ["quiet"], coverPrompt: "", artistPhotoPrompt: "", suggestedGenre: "Country Pop", rationale: "" }
  });
  const second = studio.save({
    title: "Afternoon", artistId: artist.id, article: "Another story long enough to keep.",
    parameters: parameters("Melodic House", "club mix"),
    result: { concept: "A night", lyrics: "beta verse", titles: ["The Afternoon Clear"], style: "house", exclusions: [], moods: ["bright"], coverPrompt: "", artistPhotoPrompt: "", suggestedGenre: "Melodic House", rationale: "" }
  });
  const savedFirst = studio.save({
    ...first, title: "Untitled project", parameters: parameters("Country Pop", "warm vocal"),
    result: { ...first.result, lyrics: "alpha verse edited" }
  });
  const again = studio.project(first.id);
  const other = studio.project(second.id);
  assert.equal(savedFirst.title, "You Tell Me Where");
  assert.equal(again.parameters.genre, "Country Pop");
  assert.equal(again.parameters.customInstructions, "warm vocal");
  assert.equal(again.result.lyrics, "alpha verse edited");
  assert.equal(again.result.concept, "A drive");
  assert.equal(other.title, "Afternoon");
  assert.equal(other.parameters.genre, "Melodic House");
  assert.equal(other.result.lyrics, "beta verse");
});

test("The project picker shows the song under its artist", () => {
  const projects = [
    { id: "a", title: "Untitled project", artistId: "artist-1", result: { titles: ["You Tell Me Where"] } },
    { id: "b", title: "Afternoon", artistId: "artist-1", result: { titles: [] } },
    { id: "c", title: "Untitled project", artistId: "", result: {} }
  ];
  const artists = [{ id: "artist-1", name: "Norright" }];
  assert.equal(projectSongTitle(projects[0]), "You Tell Me Where");
  const markup = projectPickerMarkup(projects, artists, "a");
  assert.match(markup, /<optgroup label="Norright">/);
  assert.match(markup, /You Tell Me Where/);
  assert.match(markup, /Afternoon/);
  assert.match(markup, /<optgroup label="No artist">/);
  assert.match(markup, /value="a"[^>]*selected/);
});

test("Switching projects saves this song before opening the next one", async () => {
  const saved = [];
  const fields = Object.fromEntries([
    ["studio-title", "You Tell Me Where"], ["studio-article", "A border story long enough to keep."],
    ["studio-artist", "artist-1"], ["studio-source", ""], ["studio-lyrics", "edited lyric line"],
    ["studio-model", "v6"], ["studio-genre", "Country Pop"], ["studio-styles", "Americana, Acoustic"],
    ["studio-language", "en"], ["studio-excludes", "Auto-Tune"], ["studio-gender", "male"],
    ["studio-weirdness", "22"], ["studio-styleInfluence", "75"], ["studio-variety", "40"],
    ["studio-duration-preset", "radio"], ["studio-duration", "205"], ["studio-notes", "warm vocal"],
    ["studio-cover-prompt", "square cover"], ["studio-photo-prompt", "wide banner"]
  ].map(([id, value]) => [id, { value }]));
  fields["studio-instrumental"] = { checked: false };
  fields["studio-max-mode"] = { checked: false };
  fields["studio-personalize"] = { checked: false };
  globalThis.document = {
    querySelector(selector) { return fields[selector.slice(1)] ?? null; },
    getElementById(id) { return fields[id] ?? null; }
  };
  const state = { data: { studioProjects: [
    { id: "a", title: "You Tell Me Where", artistId: "artist-1", result: { lyrics: "older line", concept: "drive", titles: ["You Tell Me Where"] } },
    { id: "b", title: "Afternoon", artistId: "artist-1", result: { lyrics: "other song", concept: "night", titles: ["Afternoon"] } }
  ], artists: [{ id: "artist-1", name: "Norright" }] } };
  let refreshed = 0;
  await studioInput({ target: { id: "studio-project-picker", value: "b" } }, state, async () => { refreshed += 1; },
    async (_path, body) => { saved.push(body); return { id: body.id }; }, () => {});
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, "a");
  assert.equal(saved[0].title, "You Tell Me Where");
  assert.equal(saved[0].parameters.genre, "Country Pop");
  assert.equal(saved[0].parameters.customInstructions, "warm vocal");
  assert.equal(saved[0].result.lyrics, "edited lyric line");
  assert.equal(saved[0].result.concept, "drive");
  assert.equal(studioActiveId(state), "b");
  assert.equal(refreshed, 1);
});
