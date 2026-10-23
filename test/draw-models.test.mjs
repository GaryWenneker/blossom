import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PREFERRED_DRAW_MODEL, modelFromDownloadedList, verifyDrawModel,
  listDownloadedDrawModels, validateDrawModelId } from "../src/draw-models.mjs";
import { configureEnv, parseEnv } from "../scripts/setup-blossom.mjs";

function cliRunner(message, code = 0) {
  return (command, args, options) => {
    assert.equal(command, "draw-things-cli");
    assert.deepEqual(args, ["models", "list", "--downloaded-only"]);
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.end(message);
      child.stderr.end(code ? "Simulated CLI error" : "");
      child.emit("close", code);
    });
    return child;
  };
}

test("Preferred Draw Things model is exactly the screenshot identifier", () => {
  assert.equal(PREFERRED_DRAW_MODEL, "lustifySDXLNSFWSFW_v20");
  assert.equal(validateDrawModelId(PREFERRED_DRAW_MODEL), PREFERRED_DRAW_MODEL);
  assert.throws(() => validateDrawModelId("model;rm -rf /"), /Invalid/);
});

test("Downloaded inventory resolves human-readable identifiers or checkpoint suffix but not partial matches", () => {
  assert.equal(modelFromDownloadedList(
    "Filename  Downloaded\nlustifySDXLNSFWSFW_v20.ckpt  yes\n", PREFERRED_DRAW_MODEL),
    PREFERRED_DRAW_MODEL + ".ckpt");
  assert.equal(modelFromDownloadedList("lustifySDXLNSFWSFW_v20 (downloaded)",PREFERRED_DRAW_MODEL),
    PREFERRED_DRAW_MODEL);
  assert.equal(modelFromDownloadedList("lustifySDXLNSFWSFW_v200.ckpt",PREFERRED_DRAW_MODEL),null);
  assert.equal(modelFromDownloadedList("OtherModel_v3.ckpt",PREFERRED_DRAW_MODEL),null);
});

test("CLI inspection is read-only and must verify the installed model before declaring success", async () => {
  const options = { runner: cliRunner("lustifySDXLNSFWSFW_v20.ckpt\n") };
  assert.match(await listDownloadedDrawModels(options),/lustify/);
  assert.equal(await verifyDrawModel(PREFERRED_DRAW_MODEL,options),
    "lustifySDXLNSFWSFW_v20.ckpt");
  await assert.rejects(verifyDrawModel(PREFERRED_DRAW_MODEL,
    { runner: cliRunner("notinstalled_v10.ckpt") }),/not in the CLI downloaded model inventory/);
  await assert.rejects(verifyDrawModel(PREFERRED_DRAW_MODEL,
    { runner: cliRunner("",1) }),/Could not list locally downloaded/);
});

test("Old blank .env values are repaired, but existing chosen model and credentials are preserved", async () => {
  const dir=await mkdtemp(join(tmpdir(),"blossom-draw-config-"));
  try {
    const file=join(dir,".env");
    await writeFile(file,"BLOSSOM_DRAW_MODEL=\n");
    const first=await configureEnv(file);
    assert.equal(first.settings.BLOSSOM_DRAW_MODEL,PREFERRED_DRAW_MODEL);
    assert.equal(parseEnv(await readFile(file,"utf8")).BLOSSOM_DRAW_MODEL,PREFERRED_DRAW_MODEL);
    const original=await readFile(file,"utf8");
    const again=await configureEnv(file);
    assert.equal(again.settings.BLOSSOM_DRAW_MODEL,PREFERRED_DRAW_MODEL);
    assert.equal(await readFile(file,"utf8"),original);
    const custom=original.replace("BLOSSOM_DRAW_MODEL="+PREFERRED_DRAW_MODEL,
      "BLOSSOM_DRAW_MODEL=another_model_v3.ckpt");
    await writeFile(file,custom);
    const preserved=await configureEnv(file);
    assert.equal(preserved.settings.BLOSSOM_DRAW_MODEL,"another_model_v3.ckpt");
    assert.equal(await readFile(file,"utf8"),custom);
    await writeFile(file,custom.replace("BLOSSOM_DRAW_MODEL=another_model_v3.ckpt","BLOSSOM_DRAW_MODEL=''"));
    assert.equal((await configureEnv(file)).settings.BLOSSOM_DRAW_MODEL,PREFERRED_DRAW_MODEL);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("Draw Things missing CLI fails with actionable installation message", async () => {
  const runner=() => {
    const child=new EventEmitter();
    child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    setImmediate(()=>child.emit("error",Object.assign(Error("ENOENT"),{code:"ENOENT"})));
    return child;
  };
  await assert.rejects(listDownloadedDrawModels({runner}),/brew install drawthingsai/);
});
