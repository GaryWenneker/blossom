import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const control = process.argv.includes("--control");
const mutants = control
  ? [{ name: "no-op", file: "src/uploaded-image.mjs", from: "Upload a PNG, JPEG, or WebP image", to: "Upload a PNG, JPEG, or WebP image" }]
  : [
      { name: "jpeg cover filename rejected", file: "src/discography.mjs", from: "if(!/\\.(?:png|jpe?g|webp)$/.test(filename))throw new DomainError('Use PNG, JPEG, or WebP cover artwork')", to: "if(!filename.endsWith('.png'))throw new DomainError('Use PNG cover artwork')" },
      { name: "album cover skips square check", file: "src/discography-api.mjs", from: "const data=await bytes(req,20*1024*1024),image=inspectUploadedImage(data,{square:true});", to: "const data=await bytes(req,20*1024*1024),image=inspectUploadedImage(data,{square:false});" },
      { name: "second artist photo replaces the hero", file: "src/studio.mjs", from: "if(!active)this.selectArtistImage(artistId,imageId);", to: "this.selectArtistImage(artistId,imageId);" },
      { name: "gif is accepted from the clipboard", file: "public/image-paste.js", from: 'new Set(["image/png", "image/jpeg", "image/webp"])', to: 'new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])' },
      { name: "jpg content type is not treated as jpeg", file: "src/studio-api.mjs", from: 'const mime=declared==="image/jpg"?"image/jpeg":declared;', to: "const mime=declared;" },
      { name: "studio upload does not select the new image", file: "src/studio-api.mjs", from: "this.studio.selectAsset(project.id,asset.id,kind);", to: "" }
    ];

let failed = false;
for (const mutant of mutants) {
  const original = readFileSync(mutant.file, "utf8");
  if (!original.includes(mutant.from)) {
    console.error("MISSING " + mutant.name);
    process.exit(1);
  }
  writeFileSync(mutant.file, original.replace(mutant.from, mutant.to));
  const run = spawnSync(process.execPath, ["--test", "test/uploaded-image.test.mjs"], { stdio: "ignore" });
  writeFileSync(mutant.file, original);
  const survived = run.status === 0;
  console.log((survived ? "SURVIVED " : "killed ") + mutant.name);
  if (survived) failed = true;
}
if (control) {
  if (!failed) {
    console.error("control did not survive");
    process.exit(1);
  }
  process.exit(1);
}
if (failed) process.exit(1);
console.log("killed " + mutants.length + "/" + mutants.length);
