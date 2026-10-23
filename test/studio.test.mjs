import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { StudioStore, normalizeParameters, DEFAULT_PARAMETERS, sunoRecipe } from "../src/studio.mjs";
import { DrawThings } from "../src/drawthings.mjs";
import { OpenAIComposer } from "../src/providers/openai.mjs";
import { createAppServer } from "../src/server.mjs";
const article="A local craftsperson worked for decades to make handmade guitars, and their small workshop suddenly attracted a community of new listeners and customers after one heartfelt video went viral.";
const artist={name:"Orion Sundown",genre:"Contemporary Country",language:"en",countries:["US"],voice:"male",dna:"Organic acoustic guitar, gentle male voice and live-band Nashville feel"};
const result={concept:"Fictional guitar maker rediscovering community",lyrics:"[Verse 1]\nThe room smells of cedar\n[Chorus]\nStill made by hand",style:"1961 Nashville acoustic country",exclusions:["autotune"],moods:["nostalgic","heartfelt"],titles:["Still by Hand","String by String"],coverPrompt:"A handmade guitar on a wooden porch in Tennessee at sunset, cinematic original photograph",artistPhotoPrompt:"Original fictional country singer in denim on an outdoor stage, photorealistic",suggestedGenre:"Country Pop",rationale:"Original storytelling with organic sound"};
test("Project CRUD preserves original article, genre, source and artist preset",()=>{
 const db=new Store(":memory:"),studio=new StudioStore(db),a=db.addArtist(artist);
 const project=studio.save({title:"Still by Hand",article,artistId:a.id,
   sourceUrl:"https://example.com/news",parameters:{...DEFAULT_PARAMETERS,genre:"Americana",durationPreset:"focus",targetSeconds:270}});
 assert.equal(studio.project(project.id).article,article);
 assert.equal(studio.project(project.id).parameters.targetSeconds,270);
 assert.equal(studio.projects().length,1);
 studio.savePreset(a.id,{...DEFAULT_PARAMETERS,genre:"Bluegrass"});
 assert.equal(studio.preset(a.id).genre,"Bluegrass");
 const updated=studio.save({...project,title:"New title"});assert.equal(updated.id,project.id);
 db.close();
});
test("Song length presets and numeric controls are bounded and checked",()=>{
 assert.equal(normalizeParameters(DEFAULT_PARAMETERS).targetSeconds,205);
 assert.throws(()=>normalizeParameters({...DEFAULT_PARAMETERS,styleInfluence:101}),/Style|styleInfluence|0-100/);
 assert.throws(()=>normalizeParameters({...DEFAULT_PARAMETERS,durationPreset:"radio",targetSeconds:30}),/duration/);
 assert.throws(()=>normalizeParameters({...DEFAULT_PARAMETERS,durationPreset:"ambience"}),/preset/);
 assert.throws(()=>normalizeParameters({...DEFAULT_PARAMETERS,excludeStyles:Array(17).fill("X")}),/excludeStyles/);
});
test("AI output is linked to original project and track with Suno handoff",()=>{
 const db=new Store(":memory:"),studio=new StudioStore(db),a=db.addArtist(artist);
 const project=studio.save({title:"Still by Hand",article,artistId:a.id});
 studio.setResult(project.id,result);
 const created=studio.makeTrack(project.id);
 assert.equal(created.track.stage,"brief");
 assert.equal(created.track.lyrics,result.lyrics);
 assert.equal(sunoRecipe(studio.project(project.id)).mode,"authorized-manual-handoff");
 assert.throws(()=>studio.makeTrack(project.id),/already has/);
 db.close();
});
test("OpenAI structured output uses secure API headers and returns original fields",async()=>{
 const calls=[];
 const composer=new OpenAIComposer({key:"test-api-key",fetcher:async(url,options)=>{
   calls.push({url,options});
   return {ok:true,json:async()=>({output:[{content:[{type:"output_text",text:JSON.stringify(result)}]}]})};
 }});
 const project={title:"Test",article,artistId:"test",parameters:DEFAULT_PARAMETERS};
 assert.equal((await composer.generate(project)).titles[0],"Still by Hand");
 assert.equal(calls.length,1);
 const payload=JSON.parse(calls[0].options.body);
 assert.equal(payload.store,false);
 assert.equal(payload.text.format.strict,true);
 assert.equal(calls[0].options.headers.Authorization,"Bearer test-api-key");
});
test("Draw Things CLI argument array cannot become shell injection; PNG output is attached",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"blossom-image-"));
 let runArgs;
 const runner=(command,args,options)=>{
   runArgs={command,args,options};
   const child=new EventEmitter();
   child.stdout=new PassThrough();child.stderr=new PassThrough();
   child.kill=()=>{};
   const output=args[args.indexOf("--output")+1];
   setImmediate(async()=>{
     const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(140)]);
     await writeFile(output,png);child.emit("close",0,null);
   });
   return child;
 };
 try{
   const draw=new DrawThings({command:"draw-things-cli",model:"flux.ckpt",directory:dir,runner});
   const file=await draw.generate({kind:"cover",prompt:"A rustic acoustic guitar on a porch; $(touch /tmp/forbidden)"});
   assert.equal(file.mime,"image/png");
   assert.equal(runArgs.command,"draw-things-cli");
   assert.equal(runArgs.options.shell,false);
   assert.ok(runArgs.args.includes("--output"));
   assert.ok(runArgs.args.includes("A rustic acoustic guitar on a porch; $(touch /tmp/forbidden)"));
   assert.ok((await readFile(join(dir,file.filename))).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("Studio API requires session, stores project, generates AI and links track",async t=>{
 const db=new Store(":memory:");
 const api=new OpenAIComposer({key:"testing",fetcher:async()=>({ok:true,json:async()=>({output:[{content:[{type:"output_text",text:JSON.stringify(result)}]}]})})});
 const server=createAppServer({store:db,provider:{available:()=>false},password:"long-test-password",composer:api});
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{await new Promise(done=>server.close(done));db.close();});
 const base="http://127.0.0.1:"+server.address().port;
 const request=async(path,payload,cookie="")=>{
   const response=await fetch(base+path,{method:payload===undefined?"GET":"POST",headers:{
     ...(cookie?{cookie}:{}),...(payload===undefined?{}:{"content-type":"application/json","x-blossom-request":"ui"})
   },...(payload===undefined?{}:{body:JSON.stringify(payload)})});
   return {status:response.status,data:await response.json()};
 };
 assert.equal((await request("/api/studio/projects")).status,401);
 const login=await fetch(base+"/auth/login",{method:"POST",headers:{"content-type":"application/json","x-blossom-request":"ui"},
   body:JSON.stringify({username:"admin",password:"long-test-password"})});
 const cookie=login.headers.get("set-cookie").split(";")[0];
 const a=await request("/api/artists",artist,cookie);
 assert.equal(a.status,201);
 const p=await request("/api/studio/projects",{title:"Test Song",artistId:a.data.id,article,parameters:DEFAULT_PARAMETERS},cookie);
 assert.equal(p.status,201);
 const extracted=await request("/api/studio/projects/"+p.data.id+"/extract",{},cookie);
 assert.equal(extracted.data.result.titles[0],"Still by Hand");
 const recipe=await request("/api/studio/projects/"+p.data.id+"/recipe",undefined,cookie);
 assert.equal(recipe.data.provider,"suno");
 const track=await request("/api/studio/projects/"+p.data.id+"/create-track",{},cookie);
 assert.equal(track.status,201);assert.equal(track.data.track.stage,"brief");
 const noKey=await request("/api/studio/openai-key",{apiKey:"unavailable"},cookie);
 assert.equal(noKey.status,503);
});

test("Draw Things without configured model uses CLI default model",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"blossom-image-default-"));
 let runArgs;
 const runner=(command,args)=>{
   runArgs=args;
   const child=new EventEmitter();
   child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
   setImmediate(async()=>{
     await writeFile(args[args.indexOf("--output")+1],
       Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(140)]));
     child.emit("close",0,null);
   });
   return child;
 };
 try {
   const draw=new DrawThings({model:"",directory:dir,runner});
   const result=await draw.generate({kind:"artist-photo",prompt:"A cinematic natural-light portrait of a fictional musician"});
   assert.equal(result.mime,"image/png");
   assert.equal(runArgs.includes("--model"),false);
 } finally {await rm(dir,{recursive:true,force:true});}
});
