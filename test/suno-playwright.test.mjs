import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { SunoBrowserHandoff, SUNO_CREATE_URL } from "../src/suno-playwright.mjs";
import { SunoSystemBrowser } from "../src/suno-system-browser.mjs";
import { createAppServer } from "../src/server.mjs";
import { Store } from "../src/storage.mjs";

const recipe = { provider: "suno", lyrics: "[Verse]\nMy own lyrics",
  style: "organic country blues, flute fills", exclude: "autotune",
  title: "My Original Song", instrumental: false };

function fakeBrowser() {
  const typed = [];
  const events = {};
  const form = {
    urlValue: SUNO_CREATE_URL,
    isClosed: () => false,
    url() { return this.urlValue; },
    async goto(url) { this.urlValue = url; },
    async bringToFront() {},
    getByRole(_role,{name}) { return fakeLocator(String(name),true); },
    locator(query) { return fakeLocator(query,false); }
  };
  function fakeLocator(name,role) {
    const key = /lyrics/i.test(name) ? "lyrics"
      : /style/i.test(name) ? "styles"
      : /exclude/i.test(name) ? "exclude"
      : /title/i.test(name) ? "title" : "";
    return {
      async count() { return role && key ? 1 : 0; },
      async isVisible() { return true; },
      async fill(value) { typed.push({ key, value }); }
    };
  }
  const context = {
    on(event,cb) {events[event]=cb;},
    pages() {return [form];},
    async newPage() {return form;},
    async close() {events.close?.();}
  };
  return { context, form, typed,
    library: {chromium:{launchPersistentContext:async(_dir, options)=>{
      assert.equal(options.headless,false);
      assert.equal(options.channel,"chrome");
      assert.equal(options.acceptDownloads,true);
      return context;
    }}} };
}

test("Consumer Suno Playwright is always supervised, uses visible Chrome and fills draft without submission",async()=>{
  const tmp=await mkdtemp(join(tmpdir(),"blossom-playwright-"));
  try {
    const browser=fakeBrowser();
    const bridge=new SunoBrowserHandoff({profileDir:join(tmp,"chrome"),
      loader:async()=>browser.library});
    assert.equal(bridge.status().apiConnected,false);
    await assert.rejects(bridge.prefill(recipe),/Open the supervised/);
    const opened=await bridge.open();
    assert.equal(opened.running,true);
    assert.equal(opened.requiresManualLogin,true);
    assert.equal(await bridge.open().then(r=>r.reopened),true);
    const drafted=await bridge.prefill(recipe);
    assert.deepEqual(drafted.filled,["lyrics","styles","exclude","title"]);
    assert.deepEqual(drafted.skipped,[]);
    assert.equal(drafted.submitted,false);
    assert.equal(browser.typed.length,4);
    assert.ok(browser.typed.every(x=>!x.value.includes("Generate")));
    browser.form.urlValue="https://accounts.google.com/signin";
    await assert.rejects(bridge.prefill(recipe),/Sign in with Google/);
    browser.form.urlValue="https://evil.example/create";
    await assert.rejects(bridge.prefill(recipe),/Sign in with Google/);
    const result=await bridge.close();
    assert.equal(result.running,false);
  } finally { await rm(tmp,{recursive:true,force:true}); }
});

test("Browser handoff cannot connect to platform domain or use unverified recipes",async()=>{
  const tmp=await mkdtemp(join(tmpdir(),"blossom-playwright-test-"));
  try{
    const browser=fakeBrowser(), bridge=new SunoBrowserHandoff({
      profileDir:join(tmp,"chrome"),loader:async()=>browser.library});
    await bridge.open();
    browser.form.urlValue="https://platform.suno.com/";
    await assert.rejects(bridge.prefill(recipe),/Sign in with Google/);
    browser.form.urlValue=SUNO_CREATE_URL;
    await assert.rejects(bridge.prefill({provider:"unofficial-api"}),/valid Suno production blueprint/);
    await bridge.close();
  } finally {await rm(tmp,{recursive:true,force:true});}
});

test("Browser launch failure reports missing Chrome or Playwright instead of fake success",async()=>{
  const tmp=await mkdtemp(join(tmpdir(),"blossom-playwright-errors-"));
  try {
    const missing=new SunoBrowserHandoff({profileDir:join(tmp,"no-deps"),
      loader:async()=>{throw Error("module not found");}});
    await assert.rejects(missing.open(),/not installed/);
    const failed=new SunoBrowserHandoff({profileDir:join(tmp,"no-chrome"),
      loader:async()=>({chromium:{launchPersistentContext:async()=>{throw Error("Chrome binary missing");}}})});
    await assert.rejects(failed.open(),/Cannot launch Google Chrome/);
    assert.equal(failed.status().running,false);
  } finally {await rm(tmp,{recursive:true,force:true});}
});

test("Signed-in Studio project can open and prepare Suno draft but unauthenticated browser calls fail",async t=>{
  const store=new Store(":memory:");
  const calls=[];
  const fake={
    status:()=>({running:true,apiConnected:false,requiresManualGeneration:true}),
    async open(){ calls.push("open"); return fake.status(); },
    async prefill(data){ calls.push("prefill"); assert.equal(data.provider,"suno"); return {filled:["styles"],skipped:["lyrics"],submitted:false}; },
    async close(){ calls.push("close"); return {running:false}; }
  };
  const server=createAppServer({store,provider:{available:()=>false},password:"long-test-password",
    sunoBrowser:fake});
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
  const base="http://127.0.0.1:"+server.address().port;
  const post=(path,payload,cookie)=>fetch(base+path,{
    method:"POST",headers:{"content-type":"application/json","x-blossom-request":"ui",
      ...(cookie?{cookie}:{})},body:JSON.stringify(payload)
  });
  const login=await post("/auth/login",{username:"admin",password:"long-test-password"});
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const profile=await post("/api/studio/projects",{title:"My original demo",parameters:undefined},cookie);
  assert.equal(profile.status,201);
  const {id}=await profile.json(), prefix="/api/studio/projects/"+id+"/suno-browser/";
  assert.equal((await post(prefix+"open",{})).status,401);
  const opened=await post(prefix+"open",{},cookie);
  assert.equal(opened.status,200);
  const prepared=await post(prefix+"prefill",{},cookie);
  assert.equal(prepared.status,200);
  assert.equal((await prepared.json()).submitted,false);
  const status=await fetch(base+"/api/studio/suno-browser/status",{headers:{cookie}});
  assert.equal((await status.json()).apiConnected,false);
  assert.deepEqual(calls.slice(0,2),["open","prefill"]);
  assert.equal((await post(prefix+"prefill",{},cookie)).status,200);
  const missing=await post("/api/studio/projects/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/suno-browser/open",{},cookie);
  assert.equal(missing.status,404);
});

test("A launch-option check is not reported as a missing Chrome install",async()=>{
  const tmp=await mkdtemp(join(tmpdir(),"blossom-playwright-assert-"));
  try{
    const mismatch=new Error("Expected values to be strictly equal:\n\ntrue !== false");
    mismatch.name="AssertionError";
    mismatch.code="ERR_ASSERTION";
    const bridge=new SunoBrowserHandoff({profileDir:join(tmp,"chrome"),loader:async()=>({
      chromium:{launchPersistentContext:async()=>{throw mismatch;}}
    })});
    await assert.rejects(bridge.open(),error=>{
      assert.equal(error.code,"ERR_ASSERTION");
      assert.equal(error,mismatch);
      assert.doesNotMatch(String(error.message),/Install Chrome/);
      return true;
    });
    assert.equal(bridge.status().running,false);
  } finally {await rm(tmp,{recursive:true,force:true});}
});

test("Studio Suno generate reports the normal Chrome handoff instead of an internal error",async t=>{
  const store=new Store(":memory:");
  const calls=[];
  const sunoBrowser=new SunoSystemBrowser({platform:"darwin",launcher(cmd,args,_options,done){
    calls.push([cmd,...args]);
    done(null,"LOGIN","");
  }});
  const server=createAppServer({store,provider:{available:()=>false},password:"long-test-password",sunoBrowser});
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
  const base="http://127.0.0.1:"+server.address().port;
  const post=(path,payload,cookie)=>fetch(base+path,{
    method:"POST",headers:{"content-type":"application/json","x-blossom-request":"ui",
      ...(cookie?{cookie}:{})},body:JSON.stringify(payload)
  });
  const login=await post("/auth/login",{username:"admin",password:"long-test-password"});
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const profile=await post("/api/studio/projects",{title:"My original demo"},cookie);
  assert.equal(profile.status,201);
  const {id}=await profile.json();
  const submitted=await post("/api/studio/projects/"+id+"/suno-browser/submit",{},cookie);
  const body=await submitted.json();
  assert.notEqual(body.error,"Internal error");
  assert.equal(submitted.status,409);
  assert.match(body.error,/Safari/);
  assert.equal(calls[0][0],"/usr/bin/osascript");
  assert.doesNotMatch(calls[0].join(" "),/--no-sandbox|--enable-automation/);
});
