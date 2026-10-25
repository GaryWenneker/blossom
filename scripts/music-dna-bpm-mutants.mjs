import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Replays the BPM gauntlet mutants. A mutant that leaves its test green is a survivor
// and fails this process. --control plants a no-op and must exit 1, proving the
// survivor path is reachable.
const control = process.argv.includes("--control");
const mutants = control
  ? [{
      file: "src/music-dna-chatgpt.mjs",
      from: "function catalogBpm(value) {",
      to: "function catalogBpm(value) { /* no-op mutant */",
      args: ["--test", "--test-name-pattern", "catalog analysis is rejected", "test/music-dna-chatgpt.test.mjs"]
    }]
  : [
      {
        file: "src/music-dna.mjs",
        from: 'if (value == null) throw new DomainError("BPM is required");',
        to: "if (value == null) return null;",
        args: ["--test", "--test-name-pattern", "without a BPM", "test/music-dna.test.mjs"]
      },
      {
        file: "src/music-dna.mjs",
        from: 'if (analysisMethod === SIGNAL_ONLY_ANALYSIS) return optionalNumber(value, "BPM", 20, 350);\n',
        to: "",
        args: ["--test", "--test-name-pattern", "stores measured rather than fabricated", "test/music-audio.test.mjs"]
      },
      {
        file: "src/music-dna-chatgpt.mjs",
        from: "if (!Number.isFinite(bpm) || bpm < 20 || bpm > 350)",
        to: "if (!Number.isFinite(bpm) || bpm <= 20 || bpm > 350)",
        args: ["--test", "--test-name-pattern", "catalog analysis is rejected", "test/music-dna-chatgpt.test.mjs"]
      },
      {
        file: "src/music-dna-chatgpt.mjs",
        from: "if (!Number.isFinite(bpm) || bpm < 20 || bpm > 350)",
        to: "if (!Number.isFinite(bpm) || bpm > 350)",
        args: ["--test", "--test-name-pattern", "catalog analysis is rejected", "test/music-dna-chatgpt.test.mjs"]
      },
      {
        file: "src/music-dna-chatgpt.mjs",
        from: "if (!Number.isFinite(bpm) || bpm < 20 || bpm > 350)",
        to: "if (!Number.isFinite(bpm) || bpm < 20 || bpm >= 350)",
        args: ["--test", "--test-name-pattern", "catalog analysis is rejected", "test/music-dna-chatgpt.test.mjs"]
      },
      {
        file: "src/music-dna-chatgpt.mjs",
        from: "bpm (required number from 20 to 350, never null)",
        to: "bpm (number or null)",
        args: ["--test", "--test-name-pattern", "catalog analysis is rejected", "test/music-dna-chatgpt.test.mjs"]
      },
      {
        file: "src/music-dna-chatgpt.mjs",
        from: "const bpm = catalogBpm(parsed.bpm);",
        to: "const bpm = 120;",
        args: ["--test", "--test-name-pattern", "catalog analysis is rejected", "test/music-dna-chatgpt.test.mjs"]
      }
    ];

let failed = 0;
for (const mutant of mutants) {
  const original = readFileSync(mutant.file, "utf8");
  if (!original.includes(mutant.from)) {
    console.error("mutant source missing in " + mutant.file + ": " + mutant.from);
    process.exit(1);
  }
  writeFileSync(mutant.file, original.replace(mutant.from, mutant.to));
  let status = 1;
  try {
    const run = spawnSync(process.execPath, mutant.args, { stdio: "ignore" });
    if (run.error) throw run.error;
    status = run.status ?? 1;
  } finally {
    writeFileSync(mutant.file, original);
  }
  const killed = status !== 0;
  console.log((killed ? "killed" : "SURVIVED") + " " + mutant.file + " :: " + mutant.from.slice(0, 60));
  if (!killed) failed += 1;
}
if (control && failed === 0) {
  console.error("control failed open: the no-op mutant was reported killed");
  process.exit(1);
}
if (failed) process.exit(1);
console.log("killed " + mutants.length + "/" + mutants.length);
