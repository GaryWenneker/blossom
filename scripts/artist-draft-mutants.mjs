import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const file = new URL("../src/artist-draft.mjs", import.meta.url);
const original = readFileSync(file, "utf8");
const control = process.argv.includes("--control");
const mutants = [
  ["accept four artists", "total > 3", "total > 4"],
  ["allow a duplicate", "if (seen.has(id)) throw new DomainError(\"Duplicate artist\", 400);", "if (false) throw new DomainError(\"Duplicate artist\", 400);"],
  ["collapse mixed voices", ': "mixed"', ': "female"'],
  ["keep four songs", ".slice(0, 3)", ".slice(0, 4)"],
  ["raise the DNA cap", "const DNA_LIMIT = 3000;", "const DNA_LIMIT = 4000;"],
  ["keep a thirteenth country", "countries.length >= 12", "countries.length >= 13"],
  ["copy a recording name", "return referenceStyle(traits);", "return profile.artist + referenceStyle(traits);"]
];
if (control) mutants.push(["equivalent noop", "const DNA_LIMIT = 3000;", "const DNA_LIMIT = 3000; void 0;"]);

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
    const run = spawnSync(process.execPath, ["--test", "test/artist-draft.test.mjs"], {
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
  if (survivors.length !== 1 || survivors[0] !== "equivalent noop" || killed.length !== 7) process.exit(1);
  console.log("control: known survivor detected");
  process.exit(0);
}
if (survivors.length || killed.length !== 7) process.exit(1);
console.log("killed 7/7");
