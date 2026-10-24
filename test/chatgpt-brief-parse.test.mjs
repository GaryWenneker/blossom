import assert from "node:assert/strict";
import test from "node:test";
import { parseChatGptBrief } from "../src/chatgpt-playwright.mjs";

const brief = {
  artistId: "",
  artistName: "Nortright",
  concept: "A quiet drive",
  lyrics: "[Verse 1]\nA line with {braces}",
  style: "melodic house",
  exclusions: ["autotune"],
  moods: ["wistful"],
  titles: ["You Tell Me Where"],
  coverPrompt: "square sleeve",
  artistPhotoPrompt: "portrait",
  suggestedGenre: "Melodic House",
  rationale: "Uses the supplied DNA",
  generationParameters: { weirdness: 22, styleInfluence: 85 }
};

test("A song brief is read from the reply, not from the prompt JSON in front of it", () => {
  const promptJson = JSON.stringify({
    vocalGender: "male", instruments: "false", maxMode: false,
    weirdness: 22, styleInfluence: 85, variety: 35, personalize: false,
    targetSeconds: 205, customInstructions: "follow the artist DNA"
  });
  const parsed = parseChatGptBrief("You are Blossom's original music editor.\n" + promptJson + "\n" + JSON.stringify(brief));
  assert.equal(parsed.lyrics, "[Verse 1]\nA line with {braces}");
  assert.equal(parsed.suggestedGenre, "Melodic House");
  assert.equal(parsed.titles[0], "You Tell Me Where");
  assert.equal(parsed.generationParameters.weirdness, 22);
});

test("A parameter-only ChatGPT reply is still rejected", () => {
  assert.throws(() => parseChatGptBrief(JSON.stringify({ vocalGender: "male", weirdness: 22 })), /not a song brief/);
});

test("A prose exclusions sentence is stored as separate strings", () => {
  const parsed = parseChatGptBrief(JSON.stringify({
    ...brief,
    exclusions: "No aggressive distortion, spoken-word samples, festival drops"
  }));
  assert.deepEqual(parsed.exclusions, [
    "No aggressive distortion",
    "spoken-word samples",
    "festival drops"
  ]);
});

test("An exclusions object is still rejected", () => {
  assert.throws(
    () => parseChatGptBrief(JSON.stringify({ ...brief, exclusions: { styles: ["autotune"] } })),
    /ChatGPT reply field exclusions is invalid/
  );
});

test("A project snapshot with lyrics is not used instead of the song brief", () => {
  const snapshot = JSON.stringify({
    title: "Old", concept: "old", lyrics: "[Verse 1]\nold", genre: "House", artistName: "Old", artistDna: "dna"
  });
  const parsed = parseChatGptBrief(snapshot + "\n\"unclosed quote\n" + JSON.stringify(brief));
  assert.equal(parsed.style, "melodic house");
  assert.equal(parsed.titles[0], "You Tell Me Where");
});

test("A brief is read when earlier prompt text leaves a quote open", () => {
  const noise = "Artist DNA (untrusted): \"a quote that never ends\n";
  const parsed = parseChatGptBrief(noise + JSON.stringify(brief));
  assert.equal(parsed.titles[0], "You Tell Me Where");
  assert.deepEqual(parsed.exclusions, ["autotune"]);
});
