import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const file = new URL("../src/artist-banner-prompt.mjs", import.meta.url);
const original = readFileSync(file, "utf8");
const control = process.argv.includes("--control");
const mutants = [
  ["dna cap", "const DNA_MAX = 800;", "const DNA_MAX = 801;"],
  ["drop binding", "parts.push(BINDING);", "parts.push(\"\");"],
  ["keep four songs", "owned.slice(0, 3)", "owned.slice(0, 4)"],
  ["ignore artist boundary", "!options.artistId || item.artistId === options.artistId", "true"],
  ["drop empty-song sentence", "return lines.length ? lines.join(\"\\n\") : NO_SONG;", "return lines.length ? lines.join(\"\\n\") : \"\";"],
  ["ignore caller", "let caller = text(userPrompt) || DEFAULT_OPENING;", "let caller = DEFAULT_OPENING;"]
];
if (control) mutants.push(["music cap loosen", "const MUSIC_MAX = 1000;", "const MUSIC_MAX = 1001;"]);

const killed = [];
const survivors = [];
try {
  for (const [name, from, to] of mutants) {
    const count = original.split(from).length - 1;
    if (count !== 1) {
      console.error("mutant anchor must match once: " + name + " (" + count + ")");
      process.exit(1);
    }
    writeFileSync(file, original.replace(from, to));
    if (readFileSync(file, "utf8") === original) {
      console.error("mutant was not written: " + name);
      process.exit(1);
    }
    const run = spawnSync(process.execPath, ["--test", "test/artist-banner-prompt.test.mjs"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8"
    });
    if (run.error || run.status === null) {
      console.error("mutant test did not run: " + name);
      process.exit(1);
    }
    if (run.status === 0) survivors.push(name);
    else killed.push(name + " exit " + run.status);
  }
} finally {
  writeFileSync(file, original);
}
if (readFileSync(file, "utf8") !== original) {
  console.error("restore failed");
  process.exit(1);
}
for (const line of killed) console.log("killed " + line);
for (const name of survivors) console.error("SURVIVOR " + name);
if (control) {
  if (survivors.length !== 1 || survivors[0] !== "music cap loosen" || killed.length !== 6) process.exit(1);
  console.log("control: known-bad survivor detected");
  process.exit(0);
}
if (survivors.length || killed.length !== 6) process.exit(1);
console.log("killed 6/6");
