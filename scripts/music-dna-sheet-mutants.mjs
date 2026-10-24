import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../public/music-dna.js", import.meta.url);
const original = readFileSync(file, "utf8");
const control = process.argv.includes("--control");
const mutants = control
  ? [{ name: "legend label only", from: "Human verified", to: "Person checked" }]
  : [
      { name: "catalog analysis marked heard", from: 'analysis.analysisMethod === "chatgpt-catalog" || analysis.measurements == null) return "source_inferred"', to: 'analysis.analysisMethod === "chatgpt-catalog" || analysis.measurements == null) return "audio_observed"' },
      { name: "lyrics sentence dropped", from: "Lyrics are not stored for reference recordings.", to: "Notes are stored." },
      { name: "audio color becomes not analyzed", from: 'status === "audio_observed") return "dna-source-audio"', to: 'status === "audio_observed") return "dna-source-none"' },
      { name: "initials erased", from: 'return chosen.map(part => part[0]).join("").toUpperCase() || "?"', to: 'return "?"' }
    ];

function run(mutant) {
  if (!original.includes(mutant.from)) {
    console.error("missing needle: " + mutant.name);
    return "missing";
  }
  const next = original.replace(mutant.from, mutant.to);
  if (next === original) return "unchanged";
  writeFileSync(file, next);
  const result = spawnSync(process.execPath, ["--test", "test/music-dna-catalog.test.mjs"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8"
  });
  return result.status;
}

let failed = 0;
try {
  for (const mutant of mutants) {
    const status = run(mutant);
    if (control) {
      if (status !== 0) {
        console.error("control was killed (" + status + "); it does not prove survivor detection");
        failed = 1;
      } else {
        console.error("control: survivor detected");
        failed = 2;
      }
      break;
    }
    if (status === 0 || status === "missing" || status === "unchanged") {
      console.error("SURVIVED " + mutant.name + " (" + status + ")");
      failed = 1;
    } else {
      console.log("KILLED " + mutant.name + " exit " + status);
    }
  }
} finally {
  writeFileSync(file, original);
}
process.exit(failed);
