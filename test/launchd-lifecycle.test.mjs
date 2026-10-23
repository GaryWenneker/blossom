import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configureLaunchd, launchdStatus, launchPlist, plistOnlyPathChanged } from "../scripts/setup-blossom.mjs";

const labels=["io.wenneker.blossom.server","io.wenneker.blossom.dna-worker"];
async function harness(t,{preinstalled=false, changedPlist=false, dropAfterBootstrap=false}={}) {
  const root=await mkdtemp(join(tmpdir(),"blossom-launchd-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const agentDir=join(root,"LaunchAgents"),logsDir=join(root,"logs");
  await Promise.all([mkdir(agentDir,{recursive:true}),mkdir(logsDir,{recursive:true})]);
  const envFile=join(root,".env"),nodePath="/opt/homebrew/bin/node";
  await writeFile(envFile,"BLOSSOM_HOST=127.0.0.1\n");
  const loaded=new Set(preinstalled?labels:[]),calls=[];
  for(const [i,label] of labels.entries()) {
    if(preinstalled) {
      const content=launchPlist({label,nodePath:changedPlist?"/old/node":nodePath,root,envPath:envFile,
        worker:!!i,logPath:join(logsDir,i?"worker.log":"server.log"),searchPath:"/usr/bin:/bin"});
      await writeFile(join(agentDir,label+".plist"),content);
    }
  }
  await writeFile(join(logsDir,"server.log"),"Recent server startup failure marker\n");
  const launch=async (cmd,args) => {
    assert.equal(cmd,"launchctl");
    calls.push(args);
    const [verb,target,file]=args;
    if(verb==="print") {
      if(!loaded.has(target.split("/").at(-1)))throw Error("Could not find service in domain");
      return {output:"state = running\npid = 12345\nruns = 2\n"};
    }
    if(verb==="kickstart") {
      assert.ok(loaded.has(args.at(-1).split("/").at(-1)));
      return {output:""};
    }
    if(verb==="bootout") {
      loaded.delete(target.split("/").at(-1));
      return {output:""};
    }
    if(verb==="bootstrap") {
      const label=file.split("/").at(-1).replace(/\.plist$/,"");
      if(!dropAfterBootstrap)loaded.add(label);
      return {output:""};
    }
    throw Error("unexpected launchctl command: "+verb);
  };
  const opts={root,agentDir,logsDir,nodePath,searchPath:"/usr/bin:/bin",uid:502,
    launch,health:async()=>false,sleep:async()=>{}};
  return {root,agentDir,logsDir,envFile,calls,loaded,opts};
}

test("Registered unchanged Blossom services restart in-place with no bootout/bootstrap race",async t=>{
  const {envFile,calls,opts,loaded}=await harness(t,{preinstalled:true});
  const result=await configureLaunchd(envFile,opts);
  assert.equal(result.length,2);
  assert.ok(result.every(s=>s.state.includes("restart")));
  assert.deepEqual(calls.filter(c=>c[0]==="kickstart").map(c=>c.slice(0,3)),
    labels.map(l=>["kickstart","-k","gui/502/"+l]));
  assert.equal(calls.filter(c=>c[0]==="bootout").length,0);
  assert.equal(calls.filter(c=>c[0]==="bootstrap").length,0);
  assert.equal(loaded.size,2);
});

test("First install bootstraps absent services directly without bootout",async t=>{
  const {envFile,calls,opts,agentDir}=await harness(t);
  const result=await configureLaunchd(envFile,opts);
  assert.ok(result.every(s=>s.state.includes("bootstrap")));
  assert.equal(calls.filter(c=>c[0]==="bootout").length,0);
  assert.equal(calls.filter(c=>c[0]==="bootstrap").length,2);
  const plist=await readFile(join(agentDir,labels[0]+".plist"),"utf8");
  assert.match(plist,/RunAtLoad/);
  assert.match(plist,/KeepAlive/);
  assert.doesNotMatch(plist,/BLOSSOM_ADMIN_PASSWORD/);
});

test("Only an actually changed plist requires a single bootout and bootstrap",async t=>{
  const {envFile,calls,opts}=await harness(t,{preinstalled:true,changedPlist:true});
  const result=await configureLaunchd(envFile,opts);
  assert.ok(result.every(s=>s.state.includes("reload plist")));
  assert.equal(calls.filter(c=>c[0]==="bootout").length,2);
  assert.equal(calls.filter(c=>c[0]==="bootstrap").length,2);
  assert.equal(calls.filter(c=>c[0]==="kickstart").length,0);
});

test("When launchd loses the service row, setup includes actionable recent server logs",async t=>{
  const {envFile,opts}=await harness(t,{dropAfterBootstrap:true});
  await assert.rejects(configureLaunchd(envFile,opts),
    error=>/launchd lost io\.wenneker\.blossom\.server/.test(error.message)&&
      /Recent server startup failure marker/.test(error.message)&&
      /launchctl print gui\/502/.test(error.message));
});

test("launchd running state is parsed correctly from output",async()=>{
  const status=await launchdStatus("io.wenneker.blossom.server",{
    uid:502,launch:async()=>({output:"state = running\npid = 20924\nruns = 2\n"})
  });
  assert.equal(status.registered,true);
  assert.equal(status.running,true);
  assert.match(status.detail,/pid = 20924/);
  assert.match(status.detail,/runs = 2/);
  const missing=await launchdStatus("io.wenneker.blossom.server",{
    uid:502,launch:async()=>{throw Error("Could not find service")}
  });
  assert.equal(missing.registered,false);
});


test("A different interactive shell PATH never triggers launchd bootout",async t=>{
  const {envFile,calls,opts,agentDir}=await harness(t,{preinstalled:true});
  const original=await readFile(join(agentDir,labels[0]+".plist"),"utf8");
  opts.searchPath="/opt/homebrew/bin:/usr/bin:/bin";
  const expected=launchPlist({label:labels[0],nodePath:opts.nodePath,root:opts.root,envPath:envFile,
    worker:false,logPath:join(opts.logsDir,"server.log"),searchPath:opts.searchPath});
  assert.equal(plistOnlyPathChanged(original,expected),true);
  const result=await configureLaunchd(envFile,opts);
  assert.ok(result.every(s=>s.state.includes("restart")));
  assert.equal(calls.filter(c=>c[0]==="bootout").length,0);
  assert.equal(calls.filter(c=>c[0]==="bootstrap").length,0);
  assert.equal(await readFile(join(agentDir,labels[0]+".plist"),"utf8"),original);
});
