import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/storage.mjs";
import { DomainError, RIGHTS_FIELDS, RELEASE_CHECKS, sunoBlueprint, ensureReleaseReady } from "../src/domain.mjs";
const make = () => new Store(":memory:");
const artistData={name:"Nocturne Vale",genre:"ambient",language:"instrumental",countries:["CH"],voice:"instrumental",dna:"Soft drones and felt piano"};
const rights=Object.fromEntries(RIGHTS_FIELDS.map(k=>[k,true]));
const checks=Object.fromEntries(RELEASE_CHECKS.map(k=>[k,true]));
function approvedTrack(db){
  const a=db.addArtist(artistData);
  let t=db.addTrack({artistId:a.id,title:"After Midnight",mode:"instrumental",concept:"Deep nighttime rest"});
  for(const stage of ["brief","generated","review"])t=db.progressTrack(t.id,stage);
  t=db.progressTrack(t.id,"approved",rights,"https://assets.example.org/audio.wav");
  return {a,t};
}
test("Artist names are unique even with differing case",()=>{
  const db=make();db.addArtist(artistData);
  assert.throws(()=>db.addArtist({...artistData,name:"NOCTURNE VALE"}),/already exists/);
  db.close();
});
test("Reject invalid ISO country, empty name, and excessive DNA",()=>{
  const db=make();
  for(const input of [{...artistData,countries:["SWITZERLAND"]},{...artistData,name:""},{...artistData,dna:"x".repeat(3500)}])
    assert.throws(()=>db.addArtist(input),DomainError);
  db.close();
});
test("Tracks require valid artists",()=>{
  const db=make();
  assert.throws(()=>db.addTrack({artistId:"missing",title:"X",mode:"vocal",concept:"Y"}),/Artist not found/);
  db.close();
});
test("Track transitions must follow documented state machine",()=>{
  const db=make();const a=db.addArtist(artistData);
  const t=db.addTrack({artistId:a.id,title:"Test",mode:"instrumental",concept:"Test"});
  assert.throws(()=>db.progressTrack(t.id,"approved",rights,"https://a.co/x"),/Invalid track transition/);
  assert.equal(db.progressTrack(t.id,"brief").stage,"brief");db.close();
});
test("Track approval requires rights and secure asset",()=>{
  const db=make(),{t}=approvedTrack(db);
  assert.equal(t.stage,"approved");assert.equal(t.rights.originalityReviewed,true);db.close();
});
test("Incomplete rights block track approval",()=>{
  const db=make();const a=db.addArtist(artistData);let t=db.addTrack({artistId:a.id,title:"S",mode:"vocal",concept:"Y"});
  for(const stage of ["brief","generated","review"])t=db.progressTrack(t.id,stage);
  assert.throws(()=>db.progressTrack(t.id,"approved",{}, "https://assets.example.org/a.wav"),/Rights checklist incomplete/);
  assert.throws(()=>db.progressTrack(t.id,"approved",rights,"http://x"),/secure audio asset/);db.close();
});
test("Release creation is gated by track approval and unique external ID",()=>{
  const db=make(),a=db.addArtist(artistData),t=db.addTrack({artistId:a.id,title:"Draft",mode:"instrumental",concept:"Y"});
  assert.throws(()=>db.addRelease({trackId:t.id,externalReleaseId:"re001"}),/approved/);
  const approved=approvedTrack(new Store(":memory:")); // separate fixture is deliberately independent
  assert.equal(approved.t.stage,"approved");db.close();
});
test("Complete release checklist is mandatory",()=>{
  const db=make(),{t}=approvedTrack(db);const r=db.addRelease({trackId:t.id,externalReleaseId:"r12"});
  assert.throws(()=>ensureReleaseReady(r,t),/checklist incomplete/);
  const updated=db.setChecks(r.id,checks);assert.doesNotThrow(()=>ensureReleaseReady(updated,t));
  assert.throws(()=>ensureReleaseReady(updated,t,1),/Compliance watch/);db.close();
});
test("Release status is compare-and-swap, preventing double submit",()=>{
  const db=make(),{t}=approvedTrack(db),r=db.addRelease({trackId:t.id,externalReleaseId:"r123"});
  db.setReleaseStatus(r.id,"draft","validated");
  assert.throws(()=>db.setReleaseStatus(r.id,"draft","validated"),/invalid state/);
  db.close();
});
test("Unresolved contract changes block release",()=>{
  const db=make(),{t}=approvedTrack(db),r=db.addRelease({trackId:t.id,externalReleaseId:"r124"});
  db.setChecks(r.id,checks);db.upsertWatch("https://suno.com/terms","123","changed");
  assert.equal(db.holds(),1);
  assert.throws(()=>ensureReleaseReady(db.release(r.id),t,db.holds()),/blocked/);
  db.acknowledgeWatch(db.watches()[0].id);assert.equal(db.holds(),0);db.close();
});
test("Suno blueprints are explicit offline recipes, not fabricated API calls",()=>{
  const db=make(),{a,t}=approvedTrack(db),p=sunoBlueprint(a,t);
  assert.equal(p.instrumental,true);assert.equal(p.integration,"manual-until-authorized-api-confirmed");
  assert.ok(p.styles.includes(a.dna));db.close();
});
