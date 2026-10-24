import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/storage.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { MusicDnaAPI } from "../src/music-dna-api.mjs";

const sourceAnalysis = {
  analysisMethod:"Evidence-based published recording credits, no audio decoded",
  analyzer:"Music DNA evidence-first test",summary:"Published, unmeasured instrument credits",
  instruments:[{name:"Bass guitar",role:"Credited player; exact pattern unverified"}],
  sections:[],barBlocks:[],measurements:null,confidence:0.6
};
const reference=n=>({artist:"Spotify Test Band",title:"Liked Song "+n,
  sourceUrl:"https://open.spotify.com/track/"+String(n).padStart(22,"0"),sourceKind:"metadata"});

test("95 Spotify metadata jobs are all counted, not disguised as a 50-song queue",()=>{
  const store=new Store(":memory:"),dna=new MusicDNA(store);
  try {
    const refs=Array.from({length:95},(_,i)=>reference(i+1));
    const jobs=dna.importBatch(refs);
    assert.equal(jobs.length,95);
    assert.equal(dna.jobs().length,50);
    assert.deepEqual(dna.jobCounts(),{
      total:95,queued:95,running:0,completed:0,failed:0,
      waitingForEvidence:95,readyForAudio:0
    });
  }finally{store.close();}
});
test("A saved, source-reviewed audit closes queued metadata jobs, including deduplicated reimports",()=>{
  const store=new Store(":memory:"),dna=new MusicDNA(store);
  try {
    const [referenceJob]=dna.importBatch([reference(7)]);
    assert.equal(dna.jobCounts().waitingForEvidence,1);
    const saved=dna.saveAnalysis(referenceJob.profileId,sourceAnalysis);
    assert.equal(saved.analysisVersion,1);
    assert.equal(dna.jobCounts().queued,0);
    assert.equal(dna.jobCounts().completed,1);
    assert.equal(dna.jobs("completed")[0].worker,"source-audit");
    assert.equal(dna.jobs("completed")[0].error,"");
    const duplicate=dna.importBatch([reference(7)]);
    assert.equal(duplicate[0].duplicate,true);
    assert.equal(duplicate[0].jobId,null);
    assert.equal(dna.jobCounts().total,1);
    assert.equal(dna.get(referenceJob.profileId).analysis.barBlocks.length,0);
  }finally{store.close();}
});
test("Opening an existing library repairs old Spotify queued jobs that were already manually analyzed",()=>{
  const dir=join(tmpdir(),"blossom-queue-backfill-"+Date.now());
  const store=new Store(":memory:"),dna=new MusicDNA(store);
  try {
    const [job]=dna.importBatch([reference(12)]);
    // Simulates the old code: direct DNA version persisted before fixing jobs.
    store.db.prepare("UPDATE music_dna_profiles SET current_analysis_id=? WHERE id=?")
      .run("existing-audit-version",job.profileId);
    assert.equal(dna.jobCounts().queued,1);
    const reopened=new MusicDNA(store);
    assert.equal(reopened.jobCounts().queued,0);
    assert.equal(reopened.jobCounts().completed,1);
  } finally {store.close();}
});
test("Attached and authorized audio remains pending even after a separate source-only analysis",()=>{
  const store=new Store(":memory:"),dna=new MusicDNA(store);
  try {
    const [job]=dna.importBatch([reference(8)]);
    const validSha="a".repeat(64);
    dna.attachAudio(job.profileId,{rightsConfirmed:true,
      sha256:validSha,filename:"88888888-8888-4888-8888-888888888888.wav",
      mime:"audio/wav",byteSize:4096});
    assert.equal(dna.jobCounts().readyForAudio,1);
    dna.saveAnalysis(job.profileId,sourceAnalysis);
    assert.equal(dna.jobCounts().queued,1);
    assert.equal(dna.jobCounts().readyForAudio,1);
    assert.equal(dna.jobCounts().completed,0);
    // The worker can still claim and complete an actual audio analysis.
    const claimed=dna.claimJob("verified-local-audio",{audioOnly:true});
    assert.equal(claimed.jobId,job.jobId);
    assert.equal(dna.jobCounts().running,1);
    const done=dna.completeJob(job.jobId,{...sourceAnalysis,
      analysisMethod:"Measured authorized PCM",analyzer:"local-audio-test"});
    assert.equal(done.status,"completed");
    assert.equal(dna.jobCounts().queued,0);
    assert.equal(dna.jobCounts().completed,1);
    assert.equal(dna.get(job.profileId).analysisVersion,2);
  }finally{store.close();}
});

test("Clearing the queue drops waiting jobs and keeps a live run, a failure, and saved DNA",()=>{
  const store=new Store(":memory:"),dna=new MusicDNA(store);
  try {
    const [audited]=dna.importBatch([reference(1)]);
    const saved=dna.saveAnalysis(audited.profileId,sourceAnalysis);
    const waiting=dna.importBatch([reference(21),reference(22),reference(23)]);
    const [live]=dna.importBatch([reference(24)]);
    const claimed=dna.claimJob("chatgpt",{metadataOnly:true,profileId:live.profileId});
    assert.equal(claimed.profile.id,live.profileId);
    const [broken]=dna.importBatch([reference(25)]);
    const failedClaim=dna.claimJob("chatgpt",{metadataOnly:true,profileId:broken.profileId});
    dna.completeJob(failedClaim.jobId,null,"boom");
    const [stale]=dna.importBatch([reference(26)]);
    const staleClaim=dna.claimJob("chatgpt",{metadataOnly:true,profileId:stale.profileId});
    store.db.prepare("UPDATE music_dna_jobs SET leased_until=? WHERE id=?")
      .run("2000-01-01T00:00:00.000Z",staleClaim.jobId);

    const cleared=dna.clearQueuedJobs();
    assert.deepEqual(cleared,{cleared:4,running:1});
    assert.equal(dna.jobCounts().queued,0);
    assert.equal(dna.jobCounts().running,1);
    assert.equal(dna.jobCounts().failed,1);
    assert.equal(dna.jobCounts().completed,1);
    assert.equal(dna.get(audited.profileId).analysisVersion,saved.analysisVersion);
    assert.equal(dna.get(waiting[0].profileId).title,"Liked Song 21");
    assert.equal(dna.jobs("running")[0].id,live.jobId);
    assert.deepEqual(dna.clearQueuedJobs(),{cleared:0,running:1});

    const again=dna.queueProfile(waiting[0].profileId);
    assert.equal(again.status,"queued");
    const next=dna.claimJob("chatgpt",{metadataOnly:true,profileId:waiting[0].profileId});
    assert.equal(next.profile.id,waiting[0].profileId);
    assert.equal(dna.jobCounts().queued,0);
  }finally{store.close();}
});

test("Analyze again after three failures queues the recording instead of locking it", () => {
  const store = new Store(":memory:"), dna = new MusicDNA(store);
  try {
    const [job] = dna.importBatch([reference(41)]);
    for (let attempt = 0; attempt < 3; attempt++) {
      const claimed = dna.claimJob("chatgpt", { metadataOnly: true, profileId: job.profileId });
      dna.completeJob(claimed.jobId, null, "ChatGPT reply was not a music analysis");
      if (attempt < 2) dna.queueProfile(job.profileId);
    }
    assert.equal(dna.jobCounts().failed, 1);
    assert.equal(dna.jobs("failed")[0].attempts, 3);
    const again = dna.queueProfile(job.profileId);
    assert.equal(again.status, "queued");
    const claimed = dna.claimJob("chatgpt", { metadataOnly: true, profileId: job.profileId });
    assert.equal(claimed.profile.id, job.profileId);
    assert.equal(dna.jobCounts().running, 1);
  } finally { store.close(); }
});

test("POST /api/music-dna/jobs/clear removes queued jobs", async () => {
  const store=new Store(":memory:"),dna=new MusicDNA(store),api=new MusicDnaAPI(dna);
  try {
    dna.importBatch([reference(31),reference(32)]);
    const res={
      writeHead(status,headers){this.status=status;this.headers=headers;},
      end(body){this.body=body;}
    };
    const req={
      method:"POST",
      headers:{"content-type":"application/json"},
      async *[Symbol.asyncIterator](){yield Buffer.from("{}");}
    };
    await api.handle(req,res,"/api/music-dna/jobs/clear",new URLSearchParams());
    assert.equal(res.status,200);
    assert.equal(res.headers["Content-Type"],"application/json; charset=utf-8");
    assert.deepEqual(JSON.parse(res.body),{cleared:2,running:0});
    assert.equal(dna.jobCounts().queued,0);
    assert.equal(dna.jobCounts().total,0);
  }finally{store.close();}
});
