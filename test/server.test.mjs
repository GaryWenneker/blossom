import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../src/server.mjs";
import { Store } from "../src/storage.mjs";
import { RIGHTS_FIELDS, RELEASE_CHECKS } from "../src/domain.mjs";
async function fixture(t,{allowLive=false,provider}={}) {
  const db=new Store(":memory:");
  const gateway=provider||{available:()=>false,validate:async()=>({valid:true}),distribute:async()=>({ok:true})};
  const app=createAppServer({store:db,provider:gateway,password:"very-long-test-password",allowLive});
  app.listen(0,"127.0.0.1");await once(app,"listening");
  t.after(async()=>{await new Promise(resolve=>app.close(resolve));db.close()});
  const root="http://127.0.0.1:"+app.address().port;
  const login=await fetch(root+"/auth/login",{method:"POST",headers:{"content-type":"application/json","x-blossom-request":"ui"},
    body:JSON.stringify({username:"admin",password:"very-long-test-password"})});
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const req=async(path,{method="GET",json,headers={}}={})=>{
    const res=await fetch(root+path,{method,headers:{cookie,...(json!==undefined?{"content-type":"application/json","x-blossom-request":"ui"}:{}),...headers},body:json===undefined?undefined:JSON.stringify(json)});
    return {status:res.status,body:await res.json()};
  };
  return {db,app,root,req};
}
test("Server requires credentials and protects POST against cross-origin forms",async t=>{
  const {root,req}=await fixture(t);
  const anonymous=await fetch(root+"/api/artists");assert.equal(anonymous.status,401);
  const csrf=await req("/api/artists",{method:"POST",json:{name:"X"},headers:{"x-blossom-request":""}});
  assert.equal(csrf.status,403);
  assert.equal((await req("/api/summary")).status,200);
  assert.equal((await fetch(root+"/healthz")).status,200);
  assert.equal((await fetch(root+"/login")).status,200);
});
test("HTTP happy path: artist, track and blueprint",async t=>{
  const {req}=await fixture(t);
  const a=await req("/api/artists",{method:"POST",json:{name:"Velora Fields",genre:"piano",dna:"Minimal felt piano",language:"instrumental",countries:["NL"]}});
  assert.equal(a.status,201);
  const track=await req("/api/tracks",{method:"POST",json:{artistId:a.body.id,title:"First Light",mode:"instrumental",concept:"Concentration"}});
  assert.equal(track.status,201);
  const p=await req("/api/tracks/"+track.body.id+"/blueprint");
  assert.equal(p.status,200);assert.equal(p.body.instrumental,true);
  assert.equal((await req("/api/summary")).body.tracks,1);
});
test("Unapproved release and disabled live mode cannot push to distributor",async t=>{
  let called=0;
  const provider={available:()=>true,validate:async()=>({valid:true}),distribute:async()=>{called++;return {ok:true}}};
  const {db,req}=await fixture(t,{provider});
  const a=db.addArtist({name:"Norrlight",genre:"house",dna:"Dreamy",language:"en"});
  let track=db.addTrack({artistId:a.id,title:"Halo",mode:"instrumental",concept:"Night driving"});
  assert.equal((await req("/api/releases",{method:"POST",json:{trackId:track.id,externalReleaseId:"lg123"}})).status,409);
  for(const stage of ["brief","generated","review"])track=db.progressTrack(track.id,stage);
  track=db.progressTrack(track.id,"approved",Object.fromEntries(RIGHTS_FIELDS.map(k=>[k,true])),"https://example.com/master.wav");
  const release=db.addRelease({trackId:track.id,externalReleaseId:"lg123"});
  db.setChecks(release.id,Object.fromEntries(RELEASE_CHECKS.map(k=>[k,true])));
  assert.equal((await req("/api/releases/"+release.id+"/validate",{method:"POST",json:{}})).status,200);
  assert.equal((await req("/api/releases/"+release.id+"/approve",{method:"POST",json:{}})).status,200);
  assert.equal((await req("/api/releases/"+release.id+"/distribute",{method:"POST",json:{confirmation:"PUBLISH"}})).status,403);
  assert.equal(called,0);
});
test("Unknown network outcomes do not resubmit a second time",async t=>{
  let called=0;
  const provider={available:()=>true,validate:async()=>({valid:true}),distribute:async()=>{called++;throw Error("timeout")}};
  const {db,req}=await fixture(t,{provider,allowLive:true});
  const a=db.addArtist({name:"Mira Solenne",genre:"pop",dna:"Indie",language:"en"});
  let track=db.addTrack({artistId:a.id,title:"Waves",mode:"vocal",concept:"Memory"});
  for(const stage of ["brief","generated","review"])track=db.progressTrack(track.id,stage);
  track=db.progressTrack(track.id,"approved",Object.fromEntries(RIGHTS_FIELDS.map(k=>[k,true])),"https://example.com/audio.wav");
  const release=db.addRelease({trackId:track.id,externalReleaseId:"lg456"});
  db.setChecks(release.id,Object.fromEntries(RELEASE_CHECKS.map(k=>[k,true])));
  await req("/api/releases/"+release.id+"/validate",{method:"POST",json:{}});
  await req("/api/releases/"+release.id+"/approve",{method:"POST",json:{}});
  assert.equal((await req("/api/releases/"+release.id+"/distribute",{method:"POST",json:{confirmation:"PUBLISH"}})).status,502);
  assert.equal(db.release(release.id).status,"needs_reconciliation");
  assert.equal((await req("/api/releases/"+release.id+"/distribute",{method:"POST",json:{confirmation:"PUBLISH"}})).status,409);
  assert.equal(called,1);
});
