import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import {
  THE_FIXX_SIGN_OF_FIRE_ID,
  THE_FIXX_SIGN_OF_FIRE_V4_SHA256,
  isPinnedFixxRecording, recordingVideoId,
  loadGoldenFixxMusicDna,
  compareMusicDna,
  testRegeneratedMusicDna
} from "../scripts/music-dna-regression.mjs";

const SOURCE = "https://www.youtube.com/watch?v=vHJatlXEUG4";

test("Music DNA golden is locked to exact version and exact original output", async()=>{
  const result=await loadGoldenFixxMusicDna(SOURCE);
  assert.ok(result);
  assert.equal(result.format,"blossom-music-dna-source-audit");
  assert.equal(result.version,"4.0");
  assert.deepEqual(Object.keys(result),[
    "format","version","reference","analysis","arrangementSections",
    "trackRoles","harmonicEvidence","analysisCoverage",
    "requirementsForPerMeasureAnalysis","sourceLinks","blossomSaveStatus"
  ]);
  assert.equal(result.reference.sourceUrl,SOURCE);
  assert.equal(result.analysis.schemaVersion,1);
  assert.equal(result.analysis.bpm,124.2);
  assert.equal(result.analysis.timeSignature,"4/4");
  assert.equal(result.analysis.measurements,null);
  assert.deepEqual(result.analysis.barBlocks,[]);
  assert.deepEqual(result.analysis.sections,[]);
  assert.equal(result.arrangementSections.length,7);
  assert.equal(result.trackRoles.length,5);
  assert.equal(result.analysisCoverage.verifiedBarAlignedSections,0);
  assert.equal(result.analysisCoverage.verifiedInstrumentPerformancesPerBar,0);
  assert.equal(result.analysisCoverage.verifiedVocalPerformancesPerBar,0);
  assert.equal(result.blossomSaveStatus,"niet opgeslagen");
  assert.equal(THE_FIXX_SIGN_OF_FIRE_V4_SHA256,
    "3e4d389249e841faf5a331fb25746529403fcaed5db51aa87b1186b0cfab74ef");
});

test("Matching the same YouTube recording returns identical JSON each time without reanalysis",async()=>{
  const first=await loadGoldenFixxMusicDna(SOURCE);
  const second=await loadGoldenFixxMusicDna("https://youtu.be/"+THE_FIXX_SIGN_OF_FIRE_ID);
  assert.equal(compareMusicDna(first,second).equal,true);
  assert.equal(JSON.stringify(first),JSON.stringify(second));
  assert.equal(recordingVideoId(SOURCE),THE_FIXX_SIGN_OF_FIRE_ID);
  assert.equal(isPinnedFixxRecording(SOURCE+"&t=5"),true);
  assert.equal(isPinnedFixxRecording("https://example.com/watch?v="+THE_FIXX_SIGN_OF_FIRE_ID),false);
  assert.equal(await loadGoldenFixxMusicDna("https://www.youtube.com/watch?v=xxxxxxxxxxx"),null);
  first.analysis.bpm=999;
  const again=await loadGoldenFixxMusicDna(SOURCE);
  assert.equal(again.analysis.bpm,124.2);
});

test("Reverse-check detects altered facts, missing fields, empty placeholder blocks and changed sections",async()=>{
  const gold=await loadGoldenFixxMusicDna(SOURCE);
  const changed=structuredClone(gold);
  changed.analysis.bpm=126.3;
  changed.analysis.barBlocks=[{startBar:25,endBar:28,status:"not_analyzed",
    instruments:[],vocals:[]}];
  changed.arrangementSections=changed.arrangementSections.slice(0,6);
  delete changed.trackRoles;
  const check=compareMusicDna(gold,changed);
  assert.equal(check.equal,false);
  const locations=check.differences.map(x=>x.path);
  assert.ok(locations.includes("$.analysis.bpm"));
  assert.ok(locations.includes("$.analysis.barBlocks.length"));
  assert.ok(locations.includes("$.arrangementSections.length"));
  assert.ok(locations.includes("$.trackRoles"));
  assert.equal(compareMusicDna(gold,gold).equal,true);
});

test("Regeneration tester passes untouched original, fails a changed copy",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"blossom-dna-golden-"));
  try {
    const original=await loadGoldenFixxMusicDna(SOURCE);
    const file=join(dir,"candidate.json");
    await writeFile(file,JSON.stringify(original,null,2)+"\n");
    assert.equal((await testRegeneratedMusicDna(file)).equal,true);
    original.analysis.vocals.delivery="Changed delivery";
    await writeFile(file,JSON.stringify(original,null,2)+"\n");
    const bad=await testRegeneratedMusicDna(file);
    assert.equal(bad.equal,false);
    assert.ok(bad.differences.some(x=>x.path==="$.analysis.vocals.delivery"));
  } finally {await rm(dir,{recursive:true,force:true});}
});
