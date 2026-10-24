import test from "node:test";
import assert from "node:assert/strict";
import { coverArtPrompt, sleeveDirection } from "../src/cover-art-prompt.mjs";

const houseArtist = {
  name: "Night Signal",
  genre: "House",
  dna: "late-night warehouse house, distorted kicks"
};
const houseSong = {
  genre: "House",
  style: "melodic house, 124 BPM, club drums",
  moods: ["driving"],
  suggestedGenre: "Melodic House"
};
const TOP = "Do not place a small title centered along the top.";

test("a house sleeve names the music, the DNA, and a club type treatment", () => {
  const prompt = coverArtPrompt({
    surface: "album",
    title: "Warehouse Hour",
    artist: houseArtist,
    songs: [houseSong]
  });
  assert.match(prompt, /late-night warehouse house, distorted kicks/);
  assert.match(prompt, /melodic house, 124 BPM, club drums/);
  assert.match(prompt, /Warehouse Hour/);
  assert.match(prompt, /Night Signal/);
  assert.match(prompt, /condensed industrial grotesque/);
  assert.match(prompt, /song title very large/);
  assert.match(prompt, /Square album sleeve/);
  assert.ok(prompt.includes(TOP));
  assert.ok([
    "lower third, flush left",
    "vertical along the right edge",
    "oversized and cropped through the middle"
  ].some(place => prompt.includes("Position: " + place)));
  assert.equal(sleeveDirection("melodic house, distorted kicks", "Warehouse Hour").family, "club");
});

test("an acoustic sleeve uses a quiet serif and a modest scale", () => {
  const prompt = coverArtPrompt({
    title: "Lantern",
    artist: { name: "Lantern", genre: "Indie Folk", dna: "fingerpicked intimacy" },
    songs: [{ style: "quiet acoustic, close vocal", moods: ["tender"], suggestedGenre: "Indie Folk" }]
  });
  assert.match(prompt, /quiet literary serif/);
  assert.match(prompt, /modest, never a billboard/);
  assert.match(prompt, /fingerpicked intimacy/);
  assert.match(prompt, /quiet acoustic, close vocal/);
  assert.ok(prompt.includes(TOP));
});

test("a caller scene stays, and the type direction still overrides a top title", () => {
  const prompt = coverArtPrompt({
    title: "Warehouse Hour",
    artist: houseArtist,
    songs: [houseSong],
    userPrompt: "A concrete loading dock at night, title centered along the top."
  });
  assert.match(prompt, /^A concrete loading dock at night/);
  assert.match(prompt, /condensed industrial grotesque/);
  assert.ok(prompt.includes(TOP));
  assert.match(prompt, /overrides any earlier request to put the title at the top/);
});

test("track art is a song sleeve and album art is a release sleeve", () => {
  const shared = { title: "Warehouse Hour", artist: houseArtist, songs: [houseSong] };
  const album = coverArtPrompt({ ...shared, surface: "album" });
  const track = coverArtPrompt({ ...shared, surface: "track" });
  assert.match(album, /Square album sleeve for the release/);
  assert.match(track, /Square track sleeve for this one song/);
  assert.match(track, /song title carries more weight/);
  assert.doesNotMatch(track, /Square album sleeve for the release/);
});

test("two titles in the same production do not share one position", () => {
  const base = { artist: houseArtist, songs: [houseSong], surface: "album" };
  const first = coverArtPrompt({ ...base, title: "Warehouse Hour" });
  const second = coverArtPrompt({ ...base, title: "Afterglow Circuit" });
  const position = prompt => prompt.split("Position: ")[1].split("\n")[0];
  assert.notEqual(position(first), position(second));
});

test("lyrics are not copied onto the sleeve prompt", () => {
  const prompt = coverArtPrompt({
    title: "Warehouse Hour",
    artist: houseArtist,
    songs: [{ ...houseSong, lyrics: "SECRET_LYRIC_LINE about the chorus" }]
  });
  assert.doesNotMatch(prompt, /SECRET_LYRIC_LINE/);
});

test("a huge caller prompt is cut before the type direction", () => {
  const prompt = coverArtPrompt({
    title: "Warehouse Hour",
    artist: houseArtist,
    songs: [houseSong],
    userPrompt: "dock ".repeat(2000)
  });
  assert.ok(prompt.length <= 4000);
  assert.match(prompt, /condensed industrial grotesque/);
  assert.ok(prompt.includes(TOP));
});

test("with no song, DNA still chooses the type and no conflicting scene is invented", () => {
  const prompt = coverArtPrompt({
    title: "Untitled",
    artist: houseArtist
  });
  assert.match(prompt, /late-night warehouse house, distorted kicks/);
  assert.match(prompt, /No finished song yet/);
  assert.match(prompt, /condensed industrial grotesque/);
});
