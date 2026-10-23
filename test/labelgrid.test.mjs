import test from "node:test";
import assert from "node:assert/strict";
import { LabelGrid } from "../src/providers/labelgrid.mjs";
test("LabelGrid uses bearer auth and documented validation path",async()=>{
  const requests=[];
  const api=new LabelGrid({token:"secret",fetcher:async(url,options)=>{
    requests.push({url,options});return {ok:true,text:async()=>JSON.stringify({valid:true})};
  }});
  assert.deepEqual(await api.validate("id-3"),{valid:true});
  assert.equal(requests[0].url,"https://api.labelgrid.com/api/public/releases/id-3/validate");
  assert.equal(requests[0].options.headers.Authorization,"Bearer secret");
});
test("No token means no distribution call",async()=>{
  const api=new LabelGrid({token:"",fetcher:async()=>{throw Error("Must not happen")}});
  await assert.rejects(()=>api.distribute("xyz"),/not configured/);
});
test("Reject off-domain distributor endpoints",()=>{
  assert.throws(()=>new LabelGrid({base:"https://internal.local/api",token:"test"}),/LabelGrid/);
});
