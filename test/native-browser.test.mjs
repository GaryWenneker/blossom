import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";
import { openProviderInSafari, localMacBrowserRequest } from "../src/native-browser.mjs";

test("Native macOS Safari launch is explicitly not WebDriver or Google OAuth spoofing",async()=>{
  const launched=[];
  const launcher=(bin,args,opts,done)=>{launched.push({bin,args,opts});done(null);};
  const result=await openProviderInSafari("suno",{platform:"darwin",launcher});
  assert.deepEqual(launched.map(v=>[v.bin,...v.args]),
    [["/usr/bin/open","-a","Safari","https://suno.com/create"]]);
  assert.equal(result.launched,true);
  assert.equal(result.apiConnected,false);
  assert.equal(result.authenticationVerified,false);
  assert.equal(launched[0].opts.timeout,12000);
  assert.equal(JSON.stringify(launched).includes("--remote-debugging-port"),false);
  assert.equal(JSON.stringify(launched).includes("--enable-automation"),false);
  await assert.rejects(openProviderInSafari("not-supported",{platform:"darwin",launcher}),/Unsupported browser provider/);
  await assert.rejects(openProviderInSafari("suno",{platform:"linux",launcher}),/only on macOS/);
  await assert.rejects(openProviderInSafari("spotify",{platform:"darwin",
    launcher:(_b,_a,_o,done)=>done(new Error("Safari missing"))}),/Could not open/);
  assert.equal(launched.length,1);
});

test("Native app launch is limited to authenticated localhost UI requests, never tunnels",async()=>{
  assert.equal(localMacBrowserRequest({headers:{host:"127.0.0.1:8787"},
    socket:{remoteAddress:"127.0.0.1"}}),true);
  assert.equal(localMacBrowserRequest({headers:{host:"localhost:8787"},
    socket:{remoteAddress:"::1"}}),true);
  assert.equal(localMacBrowserRequest({headers:{host:"my-cloudflare-site.example"},
    socket:{remoteAddress:"127.0.0.1"}}),false);
  assert.equal(localMacBrowserRequest({headers:{host:"127.0.0.1:8787"},
    socket:{remoteAddress:"10.0.0.3"}}),false);
});

test("Browser UI starts real Safari on Mac only after authenticated request",async t=>{
  const launches=[], store=new Store(":memory:");
  const server=createAppServer({
    store,provider:{available:()=>false},password:"long-test-password",
    nativeBrowserOptions:{platform:"darwin",launcher:(bin,args,opts,done)=>{
      launches.push({bin,args});done(null);
    }}
  });
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
  const base="http://127.0.0.1:"+server.address().port;
  const post=(path,cookie,headers={})=>fetch(base+path,{method:"POST",
    headers:{"Content-Type":"application/json","X-Blossom-Request":"ui",
      ...(cookie?{cookie}:{}),...headers},body:"{}"});
  assert.equal((await post("/api/browser-accounts/suno/open-safari")).status,401);
  assert.equal(launches.length,0);
  const login=await fetch(base+"/auth/login",{method:"POST",
    headers:{"Content-Type":"application/json","X-Blossom-Request":"ui"},
    body:JSON.stringify({username:"admin",password:"long-test-password"})});
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie").split(";")[0];
  assert.equal((await post("/api/browser-accounts/suno/open-safari",cookie,
    {Origin:"https://another-site.example"})).status,403);
  assert.equal(launches.length,0);
  const opened=await post("/api/browser-accounts/suno/open-safari",cookie);
  assert.equal(opened.status,200);
  const result=await opened.json();
  assert.equal(result.url,"https://suno.com/create");
  assert.equal(result.application,"Safari");
  assert.equal(result.apiConnected,false);
  assert.equal(launches.length,1);
  const state=await fetch(base+"/api/browser-accounts",{headers:{cookie}});
  assert.equal((await state.json()).nativeSafariAvailable,true);
  assert.equal((await post("/api/browser-accounts/bad/open-safari",cookie)).status,404);
  assert.equal(launches.length,1);
});

test("Connections warns about webdriver and Studio does not open a blocked popup",async()=>{
  const ui=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const studio=await readFile(new URL("../public/studio.js",import.meta.url),"utf8");
  const css=await readFile(new URL("../public/viewport.css",import.meta.url),"utf8");
  assert.match(ui,/navigator\.webdriver===true/);
  assert.match(ui,/browser-browser-warning/);
  assert.match(ui,/browser-safari/);
  assert.match(ui,/open-safari/);
  assert.match(css,/\.browser-browser-warning/);
  assert.match(studio,/browser-accounts\/suno\/open-safari/);
  assert.doesNotMatch(studio,/window\.open\("https:\/\/suno.com\/create"/);
  assert.match(studio,/save\(state,api\)/);
});
