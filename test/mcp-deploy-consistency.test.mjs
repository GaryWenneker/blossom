import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureLaunchd, probeMcpHealth, verifyLiveMcpTools
} from "../scripts/setup-blossom.mjs";
import { diagnoseMcpTools } from "../scripts/check-mcp-tools.mjs";
import { musicDnaMcpToolFingerprint, musicDnaMcpToolNames } from "../src/music-dna-mcp.mjs";

const TOKEN="secure-write-token-at-least-32-characters";
const NAMES=musicDnaMcpToolNames();
const response=(body,status=200)=>({
  ok:status>=200&&status<300,
  status,
  json:async()=>body
});
function host({localNames=NAMES,healthFingerprint=musicDnaMcpToolFingerprint,
  healthCount=NAMES.length,authStatus=200,publicFingerprint=healthFingerprint,
  publicCount=healthCount}={}){
  const calls=[];
  return {calls,fetcher:async(url,init={})=>{
    calls.push({url,init});
    if(url.endsWith("/healthz")){
      const external=url.startsWith("https://");
      return response({status:"ok",service:"blossom-mcp",mcp:{
        toolCount:external?publicCount:healthCount,
        toolFingerprint:external?publicFingerprint:healthFingerprint,
        spotifyLikedSupported:true}});
    }
    if(url.endsWith("/mcp")){
      assert.equal(init.method,"POST");
      assert.equal(init.headers.Authorization,"Bearer "+TOKEN);
      assert.deepEqual(JSON.parse(init.body),{jsonrpc:"2.0",id:1,method:"tools/list",params:{}});
      return response({jsonrpc:"2.0",id:1,result:{
        tools:localNames.map(name=>({name,inputSchema:{type:"object"}}))
      }},authStatus);
    }
    throw Error("Unexpected fetch "+url);
  }};
}
test("Live MCP manifest includes both Spotify tools and differs from old 12-tool version",()=>{
  assert.equal(NAMES.length,16);
  assert.ok(NAMES.includes("spotify_liked_tracks"));
  assert.ok(NAMES.includes("spotify_liked_import_page"));
  assert.equal(musicDnaMcpToolFingerprint.length,20);
});
test("Installer requires authenticated tools/list, not only 200 /healthz",async()=>{
  const h=host();
  assert.equal((await probeMcpHealth({fetcher:h.fetcher})).compatible,true);
  const result=await verifyLiveMcpTools({writeToken:TOKEN,fetcher:h.fetcher});
  assert.deepEqual(result,{toolCount:16,toolFingerprint:musicDnaMcpToolFingerprint,
    spotifyLiked:true});
  assert.equal(h.calls.filter(x=>x.url.endsWith("/mcp")).length,1);
});
test("Old process with generic status ok, but no fingerprint, MUST fail",async()=>{
  const bad=host({healthFingerprint:null,healthCount:null});
  const status=await probeMcpHealth({fetcher:bad.fetcher});
  assert.equal(status.reachable,true);
  assert.equal(status.compatible,false);
  await assert.rejects(verifyLiveMcpTools({writeToken:TOKEN,fetcher:bad.fetcher}),/older\/other Blossom process/);
});
test("Old 12-tool handler hidden behind matching /healthz must still fail",async()=>{
  const old=NAMES.filter(name=>!name.startsWith("spotify_liked_"));
  const bad=host({localNames:old});
  await assert.rejects(verifyLiveMcpTools({writeToken:TOKEN,fetcher:bad.fetcher}),
    /does not match current source/);
});
test("Wrong MCP write token must fail without disclosing credentials in diagnostics",async()=>{
  const bad=host({authStatus:401});
  let error;
  try{await verifyLiveMcpTools({writeToken:TOKEN,fetcher:bad.fetcher});}
  catch(e){error=e.message;}
  assert.match(error,/HTTP 401/);
  assert.doesNotMatch(error,/secure-write-token/);
});
test("Installer refuses silent adoption of unmanaged localhost server",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"blossom-unmanaged-"));
  try{
    await assert.rejects(configureLaunchd(join(dir,".env"),{
      root:dir,agentDir:join(dir,"agents"),logsDir:join(dir,"logs"),
      uid:77,launch:async()=>{throw Error("launchd not loaded")},
      health:async()=>true,occupied:async()=>true
    }),/Another process already occupies localhost:8787/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("Diagnostic identifies stale PUBLIC Cloudflare even when LOCAL MCP is correct",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"blossom-mcp-diagnose-"));
  const env=join(dir,".env"),logs=[];
  try{
    await writeFile(env,"BLOSSOM_MCP_WRITE_TOKEN="+TOKEN+
      "\nBLOSSOM_MCP_PUBLIC_URL=https://blossom.wenneker.dev\n");
    const good=await diagnoseMcpTools({envFile:env,publicCheck:true,
      fetcher:host().fetcher,log:line=>logs.push(line)});
    assert.equal(good.matching,true);
    assert.match(logs[0],/LOCAL: OK \| 16 MCP tools/);
    assert.match(logs[1],/PUBLIC: OK/);
    const bad=host({publicFingerprint:"stale_old_fingerprint"});
    await assert.rejects(diagnoseMcpTools({envFile:env,publicCheck:true,
      fetcher:bad.fetcher,log:()=>{}}),/Cloudflare\/public URL does not expose/);
    assert.ok(!logs.join(" ").includes(TOKEN));
  }finally{await rm(dir,{recursive:true,force:true});}
});
