import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const sourceUrl = new URL("../src/chatgpt-playwright.mjs", import.meta.url);
const original = await readFile(sourceUrl, "utf8");
const control = process.argv.includes("--control");
const mutants = control
  ? [["viewport: { width: 1280, height: 880 }", "viewport: { width: 1281, height: 880 }"]]
  : [
      ["headless: seen", "headless: false"],
      ["value.length >= MIN_ARTICLE_PASTE", "value.length >= 1"],
      ['typeof parsed.lyrics !== "string"', "false"],
      ["if (this.busy) throw fail", "if (false) throw fail"],
      ["LYRIC_LANGUAGES[code] || LYRIC_LANGUAGES.en", "LYRIC_LANGUAGES.nl"]
    ];

let killed = 0;
try {
  for (const [from, to] of mutants) {
    if (!original.includes(from)) {
      console.error("mutant anchor missing: " + from);
      process.exit(1);
    }
    const mutated = original.replace(from, to);
    if (mutated === original) {
      console.error("mutant made no change: " + from);
      process.exit(1);
    }
    await writeFile(sourceUrl, mutated);
    const run = spawnSync(process.execPath, ["--test", "test/chatgpt-playwright.test.mjs"], { stdio: "pipe" });
    if (run.status === 0) {
      console.error("SURVIVED " + from);
    } else if (run.status === null) {
      console.error("mutant runner did not exit: " + from);
      process.exit(1);
    } else {
      killed += 1;
      console.log("KILLED " + from + " exit " + run.status);
    }
  }
} finally {
  await writeFile(sourceUrl, original);
}

const restored = await readFile(sourceUrl, "utf8");
if (restored !== original) {
  console.error("source was not restored");
  process.exit(1);
}
if (control) {
  if (killed !== 0) {
    console.error("control mutant was killed; it must survive so a green suite cannot hide a miss");
    process.exit(1);
  }
  console.error("control survivor detected, checker fails closed");
  process.exit(1);
}
if (killed !== mutants.length) process.exit(1);
console.log(killed + "/" + mutants.length + " killed, source restored");
