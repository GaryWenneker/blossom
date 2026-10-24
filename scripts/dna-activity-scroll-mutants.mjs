import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const tests = ["test/music-dna-activity-scroll.test.mjs"];
const mutants = [
  {
    name: "oldest createdAt sorts first",
    file: "public/music-dna.js",
    from: "  return bStamp.localeCompare(aStamp);",
    to: "  return aStamp.localeCompare(bStamp);"
  },
  {
    name: "activity repaint drops the saved scroll",
    file: "public/music-dna.js",
    from: "  node.outerHTML = musicDnaActivityMarkup(activityJobs(state), activitySpotify(state));\n  restoreDnaActivityScroll(anchor);",
    to: "  node.outerHTML = musicDnaActivityMarkup(activityJobs(state), activitySpotify(state));"
  },
  {
    name: "a list already at the top follows the previous first row",
    file: "public/music-dna.js",
    from: "  if (scrollTop <= 0) return { pinned: \"top\" };\n",
    to: ""
  },
  {
    name: "a missing row resets the list to the top",
    file: "public/music-dna.js",
    from: "list.scrollTop = match ? Math.max(0, match.offsetTop - anchor.offset) : anchor.scrollTop;",
    to: "list.scrollTop = match ? Math.max(0, match.offsetTop - anchor.offset) : 0;"
  },
  {
    name: "a full redraw skips restoring the activity scroll",
    file: "public/app.js",
    from: " if(activityScroll)restoreDnaActivityScroll(activityScroll);\n",
    to: ""
  }
];

function runTests() {
  const result = spawnSync(process.execPath, ["--test", ...tests], { encoding: "utf8" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function replaceOnce(file, from, to) {
  const original = readFileSync(file, "utf8");
  const found = original.indexOf(from);
  if (found < 0 || original.indexOf(from, found + from.length) >= 0) {
    throw new Error(file + " does not contain exactly one mutant anchor");
  }
  writeFileSync(file, original.replace(from, to));
  return original;
}

const control = process.argv.includes("--control");
let failed = 0;
for (const mutant of mutants) {
  const original = replaceOnce(mutant.file, mutant.from, control ? mutant.from : mutant.to);
  let status = 1;
  try {
    status = runTests();
  } finally {
    writeFileSync(mutant.file, original);
  }
  const killed = status !== 0;
  if (control) {
    if (killed) {
      console.error("CONTROL FAIL " + mutant.name + " (clean source was killed, exit " + status + ")");
      failed += 1;
    } else {
      console.log("CONTROL PASS " + mutant.name + " (clean source stayed green)");
    }
  } else if (!killed) {
    console.error("SURVIVOR " + mutant.name);
    failed += 1;
  } else {
    console.log("KILLED " + mutant.name + " (exit " + status + ")");
  }
}
if (failed) process.exit(1);
console.log(control ? "control green: " + mutants.length : "killed " + mutants.length + "/" + mutants.length);
