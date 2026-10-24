import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const file = new URL("../public/image-upload.js", import.meta.url);
const original = readFileSync(file, "utf8");
const control = process.argv.includes("--control");
const mutants = [
  ["ignore clipboard image", "return clipboardFiles(clipboard).find(isClipboardImageCandidate) || null;", "return null;"],
  ["ignore open artist dialog", "photosArtistId || focusedArtistId || soleArtistId", "focusedArtistId || soleArtistId"],
  ["upload without a target", "if (!destination) return { handled: true, missingTarget: true };", "if (!destination) return { handled: true, data: await upload(file, \"/missing\") };"],
  ["skip clipboard byte sniff", "if (imageMime(file)) return file;", "return file;"]
];
if (control) mutants.push(["loosen album message", "return \"Album art uploaded\";", "return \"Album picture uploaded\";"]);
const killed = [];
const survivors = [];
try {
  for (const [name, from, to] of mutants) {
    if (original.split(from).length !== 2) {
      console.error("anchor missing: " + name);
      process.exit(1);
    }
    writeFileSync(file, original.replace(from, to));
    const run = spawnSync(process.execPath, ["--test", "test/image-paste.test.mjs"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8"
    });
    if (run.status === null) {
      console.error("not executed: " + name);
      process.exit(1);
    }
    if (run.status === 0) survivors.push(name);
    else killed.push(name);
  }
} finally {
  writeFileSync(file, original);
}
if (readFileSync(file, "utf8") !== original) process.exit(1);
console.log("killed " + killed.length + "/" + mutants.length);
for (const name of survivors) console.error("SURVIVOR " + name);
if (control) {
  if (survivors.length !== 1 || survivors[0] !== "loosen album message" || killed.length !== 4) process.exit(1);
  console.log("control: known-bad survivor detected");
  process.exit(0);
}
process.exit(survivors.length || killed.length !== 4 ? 1 : 0);
