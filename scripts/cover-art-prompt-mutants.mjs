import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const file = new URL("../src/cover-art-prompt.mjs", import.meta.url);
const original = readFileSync(file, "utf8");
const control = process.argv.includes("--control");
const mutants = [
  ["drop top ban", "const TOP_BAN = \"Do not place a small title centered along the top.", "const TOP_BAN = \"Place the title."],
  ["track uses album surface", "surface === \"track\" ? TRACK_SURFACE : ALBUM_SURFACE", "ALBUM_SURFACE"],
  ["drop dna", "\"Artist DNA: \" + dna", "\"Artist DNA: \""],
  ["always open family", "const family = FAMILIES.find(item => item.test.test(source)) || OPEN;", "const family = OPEN;"],
  ["one position", "return options[(hash >>> 0) % options.length];", "return options[0];"],
  ["copy lyrics", "if (style) parts.push(\"style \" + style);", "if (style) parts.push(\"style \" + style); if (song?.lyrics) parts.push(String(song.lyrics));"]
];
if (control) mutants.push(["dna cap loosen", "const DNA_MAX = 800;", "const DNA_MAX = 801;"]);

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
    const run = spawnSync(process.execPath, ["--test", "test/cover-art-prompt.test.mjs"], {
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
  if (survivors.length !== 1 || survivors[0] !== "dna cap loosen" || killed.length !== 6) process.exit(1);
  console.log("control: known-bad survivor detected");
  process.exit(0);
}
if (survivors.length || killed.length !== 6) process.exit(1);
console.log("killed 6/6");
