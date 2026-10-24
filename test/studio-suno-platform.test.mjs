
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage.mjs";
import { StudioStore, sunoRecipe } from "../src/studio.mjs";
import { createAppServer } from "../src/server.mjs";
import { sunoReady, officialSunoRequest, trustedSunoAudioUrl,
  fetchSunoAudio, SunoPlatform } from "../src/providers/suno-platform.mjs";
import { studioSunoReadiness, studioStepState, studioView } from "../public/studio.js";

const artist={name:"Fictional Singer",genre:"Country Pop",voice:"female",language:"en",
  countries:[],dna:"Acoustic guitars, soft harmonies"};
const brief={concept:"An original song about old countryside roads",lyrics:"[Verse 1]\nTake the old road\n[Chorus]\nHere we are",
 style:"warm acoustic Americana",exclusions:[],moods:[],titles:["New Road"],
 coverPrompt:"square picture",artistPhotoPrompt:"wide photograph",suggestedGenre:"Country",rationale:"Original folk"};
const audio=Buffer.concat([Buffer.from("ID3"),Buffer.alloc(210)]);

test("Suno readiness and Studio five steps agree on required inputs",()=>{
 const p={title:"New Road",artistId:"artist",article:"Story about the old road",
   parameters:{genre:"Country",instrumental:false},result:brief};
 assert.deepEqual(sunoReady(p).missing,[]);
 assert.deepEqual(studioSunoReadiness(p).missing,[]);
 const steps=studioStepState({...p,sunoJob:{importedAssetId:"asset"}},[{kind:"cover",selected:true}]);
 assert.equal(steps.length,5);assert.ok(steps.every(x=>x.done));
 assert.equal(sunoReady({...p,artistId:""}).ready,false);
 assert.equal(sunoReady({...p,parameters:{genre:"Country",instrumental:true},result:{concept:"Song",lyrics:""}}).ready,true);
 const request=officialSunoRequest({...sunoRecipe({...p,parameters:{
   ...p.parameters,additionalStyles:[],excludeStyles:[],sunoModel:"v6",vocalGender:"female",maxMode:false,
   weirdness:22,styleInfluence:75,variety:40,personalize:false,targetSeconds:205,
   lyricLanguage:"en",customInstructions:""}})});
 assert.equal(request.title,"New Road");
 assert.equal(request.lyrics,brief.lyrics);
 assert.ok(!Object.hasOwn(request,"weirdness"),"Unsupported fields must not be silently sent to provider");
});

test("Official Suno submission uses API key server-side and queries progress",async()=>{
 const seen=[];
 const client=new SunoPlatform({fetcher:async(url,opts)=>{
   seen.push({url,opts});
   return {ok:true,json:async()=>url.endsWith("/v0/audio")?
     {id:"abcdef12-1234",status:"submitted"}:{id:"abcdef12-1234",status:"complete",
       audio_url:"https://cdn1.suno.ai/song.mp3"}};
 }});
 const recipe={provider:"suno",title:"My Song",lyrics:"[Verse 1] sample",style:"Folk",instrumental:false};
 const submitted=await client.submit(recipe,"my-real-credential");
 assert.equal(submitted.id,"abcdef12-1234");
 const done=await client.status(submitted.id,"my-real-credential");
 assert.equal(done.status,"complete");
 assert.equal(done.audioUrl,"https://cdn1.suno.ai/song.mp3");
 assert.equal(seen[0].opts.headers.Authorization,"Bearer my-real-credential");
 assert.equal(seen[0].opts.body.includes("my-real-credential"),false);
 assert.deepEqual(JSON.parse(seen[0].opts.body),
   {title:"My Song",style:"Folk",instrumental:false,lyrics:"[Verse 1] sample"});
 await assert.rejects(client.submit(recipe,""),/API key/);
});

test("Final Suno audio import rejects arbitrary remote URLs and invalid audio",async()=>{
 for(const url of ["http://cdn1.suno.ai/a.mp3","http://127.0.0.1/","https://evil.test/a.mp3",
   "https://cdn1.suno.ai.evil.test/a.mp3","https://user:pass@cdn1.suno.ai/a.mp3"])
   assert.throws(()=>trustedSunoAudioUrl(url),/approved Suno/);
 let requested=false;
 const fetcher=async()=>{requested=true;return {
   ok:true,headers:{get:()=>String(audio.length)},
   body:(async function*(){yield audio;})()
 }};
 const imported=await fetchSunoAudio("https://cdn1.suno.ai/song.mp3",{fetcher});
 assert.equal(requested,true);
 assert.equal(imported.mime,"audio/mpeg");
 assert.equal(imported.bytes.length,audio.length);
 await assert.rejects(fetchSunoAudio("https://cdn1.suno.ai/invalid.mp3",
   {fetcher:async()=>({...await fetcher(),body:(async function*(){yield Buffer.alloc(160);})()})}),
   /not valid MP3\/WAV/);
});

test("Studio Suno API creates durable generation, polls and links real MP3",async t=>{
 const db=new Store(":memory:");
 const directory=await mkdtemp(join(tmpdir(),"blossom-suno-test-"));
 const vaultKey=randomBytes(32).toString("base64");
 const musician=db.addArtist(artist);
 let submits=0,checks=0;
 const fake={submit:async()=>{submits++;return {id:"suno-job-1234",status:"submitted"};},
   status:async()=>{checks++;return {id:"suno-job-1234",status:"complete",
     audioUrl:"https://cdn1.suno.ai/test.mp3"};}};
 const server=createAppServer({store:db,password:"a-long-local-password",vaultKey,
   provider:{available:()=>false},sunoPlatform:fake,assetDir:directory,
   sunoAudioFetcher:async()=>({ok:true,headers:{get:()=>String(audio.length)},
      body:(async function*(){yield audio;})()}),
   localComposer:{status:async()=>({available:false})}});
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{await new Promise(ok=>server.close(ok));db.close();await rm(directory,{recursive:true,force:true});});
 const base="http://127.0.0.1:"+server.address().port;
 let cookie="";
 const post=(path,payload={})=>fetch(base+path,{method:"POST",
   headers:{"Content-Type":"application/json","x-blossom-request":"ui",...(cookie?{cookie}:{})},
   body:JSON.stringify(payload)});
 const login=await post("/auth/login",{username:"admin",password:"a-long-local-password"});
 cookie=login.headers.get("set-cookie").split(";")[0];
 assert.equal((await post("/api/connections/suno",{apiKey:"suno-platform-token",email:"test@example.org"})).status,200);
 const project=await (await post("/api/studio/projects",{artistId:musician.id,
   title:"New Road",article:"A true story told as a wholly fictional countryside song",parameters:{genre:"Country Pop"}})).json();
 assert.equal((await post("/api/studio/projects/"+project.id+"/result",brief)).status,200);
 const generated=await post("/api/studio/projects/"+project.id+"/suno/generate");
 assert.equal(generated.status,202);
 assert.equal((await generated.json()).id,"suno-job-1234");
 assert.equal(submits,1);
 assert.equal((await post("/api/studio/projects/"+project.id+"/suno/generate")).status,409);
 const status=await fetch(base+"/api/studio/projects/"+project.id+"/suno/status",{headers:{cookie}});
 assert.equal((await status.json()).status,"complete");
 assert.equal(checks,1);
 const listed=await (await fetch(base+"/api/studio/projects",{headers:{cookie}})).json();
 assert.equal(listed[0].sunoJob.status,"complete");
 // Network import is deliberately separated from submitted job; don't use
 // the real Suno network in tests. Verify importer restrictions and the
 // project recording remain durable until an audio file is safely downloaded.
 const importResponse=await post("/api/studio/projects/"+project.id+"/suno/import");
 assert.equal(importResponse.status,201);
 const imported=await importResponse.json();
 assert.equal(imported.asset.mime,"audio/mpeg");
 assert.ok(imported.job.importedAssetId);
 const savedAsset=(await fetch(base+imported.asset.url,{headers:{cookie}}));
 assert.equal(savedAsset.status,200);
 assert.deepEqual(Buffer.from(await savedAsset.arrayBuffer()),audio);
 assert.equal((await post("/api/studio/projects/"+project.id+"/suno/import")).status,409);
 const studio=new StudioStore(db);
 assert.equal(studio.sunoJob(project.id).id,"suno-job-1234");
 assert.equal(studio.sunoJob(project.id).importedAssetId,imported.asset.id);
 assert.ok(studio.require(project.id).trackId,"Imported audio links a production track");
});

test("Studio Release UI contains five navigable steps and non-fake Suno action",()=>{
 const state={data:{artists:[],genres:{},studioProjects:[],studioAssets:[],
   studioStatus:{sunoApiConfigured:true},studioReferences:[],musicDnaProfiles:[],studioPresets:{},
   studioArtistPresets:{}}};
 const markup=studioView(state);
 assert.equal((markup.match(/data-action="studio-step"/g)||[]).length,5);
 assert.match(markup,/data-action="studio-suno-generate"/);
 assert.match(markup,/data-action="studio-suno-import"/);
 assert.match(markup,/data-action="studio-suno-status"/);
 assert.match(markup,/id="studio-step-5"/);
 assert.match(markup,/Generate music in Suno/);
});
