import test from "node:test";
import assert from "node:assert/strict";
import { artistBannerPrompt, selectBannerSongs } from "../src/artist-banner-prompt.mjs";

const BINDING = "Picture wardrobe, setting, age presentation, energy and attitude for this production. A club, house, techno or aggressive electronic production must not look soft, sweet, innocent or acoustic. An intimate acoustic, folk or singer-songwriter production must not look like a club or rave. Voice type chooses who may be pictured; it must not override the production look.";

const houseArtist = {
  name: "Night Signal",
  genre: "House",
  voice: "female",
  dna: "late-night warehouse house, distorted kicks"
};
const houseSong = {
  genre: "House",
  style: "melodic house, 124 BPM, club drums",
  moods: ["driving"],
  suggestedGenre: "Melodic House"
};

test("house production is named in the banner prompt and a soft portrait is not requested", () => {
  const prompt = artistBannerPrompt({ artist: houseArtist, songs: [houseSong] });
  assert.match(prompt, /late-night warehouse house, distorted kicks/);
  assert.match(prompt, /melodic house, 124 BPM, club drums/);
  assert.match(prompt, /female/);
  assert.match(prompt, /Night Signal/);
  assert.ok(prompt.includes(BINDING));
  assert.doesNotMatch(prompt, /soft, sweet portrait/);
});

test("acoustic production is named in the banner prompt", () => {
  const prompt = artistBannerPrompt({
    artist: {
      name: "Lantern",
      genre: "Indie Folk",
      voice: "female",
      dna: "fingerpicked intimacy"
    },
    songs: [{
      style: "quiet acoustic, close vocal",
      moods: ["tender"],
      suggestedGenre: "Indie Folk"
    }]
  });
  assert.match(prompt, /quiet acoustic, close vocal/);
  assert.match(prompt, /fingerpicked intimacy/);
  assert.ok(prompt.includes(BINDING));
});

test("a caller prompt stays and the production block is still appended", () => {
  const prompt = artistBannerPrompt({
    artist: houseArtist,
    songs: [houseSong],
    userPrompt: "A person standing in a meadow at noon"
  });
  assert.match(prompt, /^A person standing in a meadow at noon/);
  assert.match(prompt, /late-night warehouse house, distorted kicks/);
  assert.match(prompt, /melodic house, 124 BPM, club drums/);
  assert.ok(prompt.includes(BINDING));
});

test("no finished song uses artist genre and DNA only", () => {
  const prompt = artistBannerPrompt({
    artist: { name: "Blue Meadow Quartet", genre: "Indie Folk", voice: "mixed", dna: "Multi-part harmonies and acoustic instruments" }
  });
  assert.match(prompt, /Multi-part harmonies and acoustic instruments/);
  assert.match(prompt, /Indie Folk/);
  assert.match(prompt, /No finished song yet\. Use the artist genre and Artist DNA only\. Do not invent a conflicting scene\./);
  assert.ok(prompt.includes(BINDING));
});

test("analyzed recording style is included and a reference artist name is not invented", () => {
  const prompt = artistBannerPrompt({
    artist: houseArtist,
    analyzedStyle: "saturated club production, approximately 126 BPM"
  });
  assert.match(prompt, /saturated club production, approximately 126 BPM/);
  assert.doesNotMatch(prompt, /Daft Punk/);
});

test("one project keeps only that project's songs", () => {
  const house = project("house-id", "Night Signal", "melodic house, 124 BPM, club drums");
  const folk = project("folk-id", "Night Signal", "FOURTH-FOLK-ONLY quiet guitar");
  const songs = selectBannerSongs([house, folk], { project: house });
  assert.equal(songs.length, 1);
  const prompt = artistBannerPrompt({ artist: houseArtist, songs, projectStyle: "saturated kicks, short hats" });
  assert.match(prompt, /melodic house, 124 BPM, club drums/);
  assert.match(prompt, /saturated kicks, short hats/);
  assert.doesNotMatch(prompt, /FOURTH-FOLK-ONLY/);
});

test("artist-screen selection ignores a newer song from another artist", () => {
  const projects = [
    project("other", "Other Artist", "OTHER-ARTIST-HOUSE"),
    project("1", "Night Signal", "song-one-house"),
    project("2", "Night Signal", "song-two-house"),
    project("3", "Night Signal", "song-three-house"),
    project("4", "Night Signal", "song-four-folk")
  ];
  const songs = selectBannerSongs(projects, { artistId: "Night Signal" });
  assert.equal(songs.length, 3);
  assert.equal(songs.some(song => String(song.style).includes("OTHER-ARTIST-HOUSE")), false);
  assert.equal(songs.some(song => String(song.style).includes("song-three-house")), true);
  assert.equal(songs.some(song => String(song.style).includes("song-four-folk")), false);
});

test("artist-screen selection keeps the three newest songs and drops the fourth", () => {
  const projects = [
    project("1", "Night Signal", "song-one-house"),
    project("2", "Night Signal", "song-two-house"),
    project("3", "Night Signal", "song-three-house"),
    project("4", "Night Signal", "song-four-folk")
  ];
  const songs = selectBannerSongs(projects);
  assert.equal(songs.length, 3);
  assert.equal(songs.some(song => String(song.style).includes("song-four-folk")), false);
  const prompt = artistBannerPrompt({ artist: houseArtist, songs });
  assert.match(prompt, /song-one-house/);
  assert.match(prompt, /song-two-house/);
  assert.match(prompt, /song-three-house/);
  assert.doesNotMatch(prompt, /song-four-folk/);
});

test("capped DNA and production stay inside 4000 characters when every field is long", () => {
  const prompt = artistBannerPrompt({
    artist: { name: "N".repeat(80), genre: "G".repeat(100), voice: "instrumental", dna: "D".repeat(5000) },
    songs: [{
      genre: "House",
      additionalStyles: Array.from({ length: 16 }, () => "S".repeat(100)),
      style: "M".repeat(5000),
      moods: ["driving"],
      suggestedGenre: "Melodic House"
    }],
    analyzedStyle: "A".repeat(2000),
    projectStyle: "P".repeat(2000)
  });
  assert.ok(prompt.length <= 4000);
  assert.ok(prompt.includes("D".repeat(800)));
  assert.ok(prompt.includes(BINDING));
  assert.ok(!prompt.includes("D".repeat(801)));
});

test("the prompt stays within 4000 characters and never drops the binding sentence", () => {
  const dna = "D".repeat(2000);
  const prompt = artistBannerPrompt({
    artist: { ...houseArtist, dna },
    songs: [{ style: "M".repeat(2000) }],
    userPrompt: "U".repeat(5000) + "TAIL"
  });
  assert.ok(prompt.length <= 4000);
  assert.ok(prompt.includes(BINDING));
  assert.ok(prompt.includes("D".repeat(800)));
  assert.ok(!prompt.includes("D".repeat(801)));
  assert.ok(!prompt.includes("TAIL"));
});

function project(id, artistId, style) {
  return {
    id,
    artistId,
    parameters: { genre: "House", additionalStyles: [] },
    result: { style, moods: [], suggestedGenre: "" }
  };
}
