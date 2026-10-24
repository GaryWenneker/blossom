import test from "node:test";
import assert from "node:assert/strict";
import { packSunoStyle, SUNO_STYLE_LIMIT } from "../src/suno-style-pack.mjs";
import { sunoRecipe } from "../src/studio.mjs";
import { officialSunoRequest } from "../src/providers/suno-platform.mjs";

const short = {
  genre: "Country",
  artistDna: "fingerpicked baritone, leave out autotune",
  additionalStyles: [],
  resultStyle: "quiet country",
  referenceStyles: "",
  customInstructions: ""
};

function longProject() {
  const referenceStyles = [
    "Southern rock, Hard rock, Blues rock, Reflective mood, Yearning mood, " + Array.from({length: 12}, (_, index) => "Electric guitar Sustained slide phrases and melodic fills number " + index).join(", ") + ", Piano Flowing chordal accompaniment, (inspiration weight 50/100)",
    "house, deep house, garage house, uplifting mood, Drum machine Four-on-the-floor kick pattern with crisp claps, Synthesizer bass Rounded syncopated repeating bass figure, Organ-style synthesizer Short rhythmic chord stabs, Loop-driven and spacious production, (inspiration weight 50/100)"
  ].join(", ");
  return {
    genre: "Neo-classical piano",
    artistDna: "Neo-classical solo piano, female vocal like Tori Amos. Felt piano in a natural room. No drums and no orchestra swell.",
    additionalStyles: ["Solo felt piano", "Acoustic minimalism", "Natural room recording"],
    resultStyle: "Neo-classical solo felt piano, 72 BPM. " + "Patient left-hand figures and spacious rests. ".repeat(30),
    referenceStyles,
    customInstructions: "Musical direction: instrumental solo felt piano, 72 BPM. " + "Patient left-hand figures and clean pedal changes. ".repeat(8) + "No drums or synth pads. It must sound like a real acoustic grand piano, and a string orchestra sits behind it."
  };
}

test("a style that already fits is left in the original order", () => {
  const style = packSunoStyle(short);
  assert.equal(style, "Country, fingerpicked baritone, leave out autotune, quiet country");
  assert.ok(style.length <= SUNO_STYLE_LIMIT);
});

test("an oversized style keeps genre, styles, both Music DNA refs, and the closing instruction", () => {
  const fields = longProject();
  const style = packSunoStyle(fields);
  assert.ok(style.length <= SUNO_STYLE_LIMIT, style.length);
  assert.match(style, /^Neo-classical piano, Solo felt piano, Acoustic minimalism, Natural room recording,/);
  assert.match(style, /string orchestra sits behind it/);
  assert.match(style, /Southern rock/);
  assert.match(style, /Electric guitar/);
  assert.match(style, /house/);
  assert.match(style, /Drum machine/);
  assert.match(style, /Synthesizer bass/);
  assert.match(style, /inspiration weight 50\/100/);
  assert.match(style, /Felt piano in a natural room/);
  assert.equal(style.split("Solo felt piano").length - 1, 1);
  const orchestra = style.indexOf("string orchestra sits behind it");
  const direction = style.indexOf("Musical direction:");
  assert.ok(orchestra >= 0 && orchestra < direction, "the closing instruction leads the earlier brief");
});

test("the Suno recipe and official request both carry the packed style", () => {
  const fields = longProject();
  const project = {
    title: "A Little Warmth Remains",
    artistDna: fields.artistDna,
    parameters: {
      genre: fields.genre,
      additionalStyles: fields.additionalStyles,
      excludeStyles: ["Vocals", "Orchestral swells"],
      customInstructions: fields.customInstructions,
      instrumental: true,
      vocalGender: "male",
      sunoModel: "v6",
      lyricLanguage: "en",
      weirdness: 16,
      styleInfluence: 88,
      variety: 25
    },
    result: { style: fields.resultStyle, lyrics: "", titles: ["A Little Warmth Remains"], exclusions: ["Vocals"] }
  };
  const recipe = sunoRecipe(project, fields.referenceStyles);
  assert.equal(recipe.style, packSunoStyle(fields));
  assert.equal(recipe.lyrics, "");
  assert.equal(recipe.exclude, "Vocals, Orchestral swells");
  const request = officialSunoRequest(recipe);
  assert.match(request.style, /Drum machine/);
  assert.match(request.style, /string orchestra sits behind it/);
  assert.equal(Object.hasOwn(request, "weirdness"), false);
  assert.equal(Object.hasOwn(request, "styleInfluence"), false);
});
