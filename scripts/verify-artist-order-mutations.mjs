import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const tests = ["--test", "test/artist-order.test.mjs"];
const mutants = [
  ["no move", "public/artist-order.js",
    "next.splice(to, 0, next.splice(from, 1)[0]);",
    "/* mutant: leave ids unmoved */"],
  ["accept partial roster", "src/storage.mjs",
    'throw new DomainError("Ordering must be an exact permutation of artists");',
    "return this.artists();"],
  ["new artists share sort zero", "src/storage.mjs",
    "SELECT COALESCE(MIN(sort_order), 1) - 1 AS sort_order FROM artists",
    "SELECT 0 AS sort_order FROM artists"],
  ["hide save errors", "public/artist-order.js",
    "message(error.message, true);",
    "/* mutant: hide the save error */"],
  ["dragover blocks the drop", "public/artist-order.js",
    "event.preventDefault();\n    cards().forEach(item => item.classList.remove(\"is-drop-target\"));",
    "cards().forEach(item => item.classList.remove(\"is-drop-target\"));"]
];
const control = {
  file: "public/artist-order.js",
  from: "export function moveItem(ids, fromId, toId) {",
  to: "export function moveItem(ids, fromId, toId) { /* control */"
};

function apply(file, from, to) {
  const original = readFileSync(file, "utf8");
  const changed = original.replace(from, to);
  if (changed === original) {
    console.error("mutant anchor missing in " + file);
    process.exit(1);
  }
  writeFileSync(file, changed);
  return original;
}

function run() {
  const result = spawnSync(process.execPath, tests, { encoding: "utf8" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status === null) {
    console.error("mutant runner did not exit");
    process.exit(1);
  }
  return result.status;
}

const controlOriginal = apply(control.file, control.from, control.to);
let controlStatus;
try { controlStatus = run(); }
finally { writeFileSync(control.file, controlOriginal); }
if (controlStatus !== 0) {
  console.error("control mutant was killed; a no-op must stay green");
  process.exit(1);
}
console.log("control survived");

let killed = 0;
for (const [name, file, from, to] of mutants) {
  const original = apply(file, from, to);
  let status;
  try { status = run(); }
  finally { writeFileSync(file, original); }
  if (status === 0) {
    console.error("SURVIVED " + name);
    process.exit(1);
  }
  killed += 1;
  console.log("killed " + name + " exit " + status);
}
if (killed !== mutants.length) process.exit(1);
console.log("killed " + killed + "/" + mutants.length);
