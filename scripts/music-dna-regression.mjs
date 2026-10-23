import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const GOLDEN_PATH = new URL("../test/fixtures/music-dna/the-fixx-sign-of-fire.v4.json", import.meta.url);
export const THE_FIXX_SIGN_OF_FIRE_ID = "vHJatlXEUG4";
export const THE_FIXX_SIGN_OF_FIRE_V4_SHA256 =
  "3e4d389249e841faf5a331fb25746529403fcaed5db51aa87b1186b0cfab74ef";

export function recordingVideoId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const short = url.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})(?:\/|$)/);
      return short?.[1] || null;
    }
  } catch { /* never treat arbitrary strings as YouTube URLs */ }
  return null;
}
export function isPinnedFixxRecording(sourceUrl) {
  return recordingVideoId(sourceUrl) === THE_FIXX_SIGN_OF_FIRE_ID;
}
export async function loadGoldenFixxMusicDna(sourceUrl) {
  if (!isPinnedFixxRecording(sourceUrl)) return null;
  const bytes = await readFile(GOLDEN_PATH);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== THE_FIXX_SIGN_OF_FIRE_V4_SHA256)
    throw new Error("Music DNA golden fixture was unexpectedly changed; review before reusing");
  const result = JSON.parse(bytes.toString("utf8"));
  if (result.reference?.sourceUrl !== "https://www.youtube.com/watch?v=" + THE_FIXX_SIGN_OF_FIRE_ID ||
      result.version !== "4.0" || result.format !== "blossom-music-dna-source-audit")
    throw new Error("Music DNA golden fixture source or format is invalid");
  return result;
}

export function compareMusicDna(expected, candidate, { maxDifferences = 50 } = {}) {
  const differences = [];
  const walk = (left, right, path) => {
    if (differences.length >= maxDifferences) return;
    if (Object.is(left, right)) return;
    const typeOf = value => value === null ? "null" :
      Array.isArray(value) ? "array" : typeof value;
    const lt = typeOf(left), rt = typeOf(right);
    if (lt !== rt) {
      differences.push({ path, expected: left, actual: right }); return;
    }
    if (lt === "object") {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) {
        if (differences.length >= maxDifferences) break;
        const location = path + "." + key;
        if (!Object.hasOwn(left, key)) differences.push({ path: location, expected: "<missing>", actual: right[key] });
        else if (!Object.hasOwn(right, key)) differences.push({ path: location, expected: left[key], actual: "<missing>" });
        else walk(left[key], right[key], location);
      }
      return;
    }
    if (lt === "array") {
      if (left.length !== right.length)
        differences.push({ path: path + ".length", expected: left.length, actual: right.length });
      for (let i = 0; i < Math.min(left.length, right.length); i++) {
        if (differences.length >= maxDifferences) break;
        walk(left[i], right[i], path + "[" + i + "]");
      }
      return;
    }
    differences.push({ path, expected: left, actual: right });
  };
  walk(expected, candidate, "$");
  return { equal: differences.length === 0, differences };
}

export async function testRegeneratedMusicDna(candidatePath) {
  const expected = await loadGoldenFixxMusicDna("https://www.youtube.com/watch?v=vHJatlXEUG4");
  if (!expected) throw new Error("Music DNA fixture unavailable");
  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  const comparison = compareMusicDna(expected, candidate);
  return { ...comparison, expectedSource: expected.reference.sourceUrl,
    expectedVersion: expected.version, expectedGoldenSha256: THE_FIXX_SIGN_OF_FIRE_V4_SHA256 };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const candidate = process.argv[2];
  if (!candidate) {
    console.error("Usage: node scripts/music-dna-regression.mjs <candidate.json>");
    process.exitCode = 2;
  } else {
    testRegeneratedMusicDna(candidate).then(result => {
      if (result.equal) console.log("PASS: Music DNA output matches the locked v4 JSON in every field and value.");
      else {
        console.error("FAIL: Music DNA differs from v4 golden snapshot (" +
          result.differences.length + " differences shown).");
        for (const difference of result.differences)
          console.error(JSON.stringify(difference));
        process.exitCode = 1;
      }
    }).catch(error => { console.error("Music DNA regression failed:", error.message); process.exitCode = 2; });
  }
}
