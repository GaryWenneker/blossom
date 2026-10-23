import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/storage.mjs";
import { checkTerms, WATCH_URLS } from "../src/monitor.mjs";
const response=text=>({ok:true,text:async()=>text});
test("Terms monitoring baselines, detects changes and gates distribution",async()=>{
  const db=new Store(":memory:");const url=WATCH_URLS[0];
  const before=await checkTerms(db,async()=>response("a".repeat(250)),[url]);
  assert.equal(before[0].state,"baseline");assert.equal(db.holds(),0);
  const unchanged=await checkTerms(db,async()=>response("a".repeat(250)),[url]);
  assert.equal(unchanged[0].changed,false);
  const changed=await checkTerms(db,async()=>response("b".repeat(250)),[url]);
  assert.equal(changed[0].state,"changed");assert.equal(db.holds(),1);
  db.acknowledgeWatch(db.watches()[0].id);
  assert.equal(db.holds(),0);db.close();
});
test("Monitoring failures never reset a previously detected hold",async()=>{
  const db=new Store(":memory:");const url=WATCH_URLS[0];
  db.upsertWatch(url,"old","changed");
  const result=await checkTerms(db,async()=>{throw Error("offline")},[url]);
  assert.equal(result[0].state,"fetch_failed");assert.equal(db.holds(),1);db.close();
});
