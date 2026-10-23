import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";
import { ConnectedBrowsers, VisibleBrowserSession, PROVIDER_URLS } from "../src/browser-connections.mjs";

test("Google and Facebook browser sign-ins use official websites without Playwright or cookies",async()=>{
  const browsers=new ConnectedBrowsers();
  assert.deepEqual(Object.keys(PROVIDER_URLS),["suno","spotify","chatgpt"]);
  for(const provider of Object.keys(PROVIDER_URLS)){
    const session=browsers.instance(provider);
    const state=await session.open();
    assert.equal(state.url,PROVIDER_URLS[provider]);
    assert.equal(state.mode,"system-browser");
    assert.equal(state.openInUserBrowser,true);
    assert.equal(state.browserOpen,false);
    assert.equal(state.localProfilePresent,false);
    assert.equal(state.authenticationVerified,false);
    assert.equal(state.apiConnected,false);
    assert.equal(JSON.stringify(state).includes("access_token"),false);
    assert.equal(JSON.stringify(state).includes("cookie"),false);
    assert.equal((await session.close()).browserOpen,false);
  }
  assert.throws(()=>new VisibleBrowserSession("google"),/Unsupported browser service/);
  await assert.rejects(browsers.open("../../tmp/file"),/Unsupported browser provider/);
  const result=await browsers.suno.prefill({provider:"suno",lyrics:"My lyrics",style:"country",title:"A song"});
  assert.deepEqual(result.filled,[]);
  assert.deepEqual(result.skipped,["lyrics","styles","title"]);
  assert.equal(result.submitted,false);
  await assert.rejects(browsers.suno.prefill({provider:"fake"}),/valid Suno production blueprint/);
});

test("Browser account API requires Blossom session, refuses arbitrary sites, returns only safe link",async t=>{
  const store=new Store(":memory:");
  const server=createAppServer({store,provider:{available:()=>false},
    password:"a-secure-local-admin-password"});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
  const base="http://127.0.0.1:"+server.address().port;
  assert.equal((await fetch(base+"/api/browser-accounts")).status,401);
  const login=await fetch(base+"/auth/login",{method:"POST",
    headers:{"Content-Type":"application/json","X-Blossom-Request":"ui"},
    body:JSON.stringify({username:"admin",password:"a-secure-local-admin-password"})});
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const req=(provider,action,headers={})=>fetch(base+"/api/browser-accounts/"+provider+"/"+action,
    {method:"POST",headers:{"content-type":"application/json","X-Blossom-Request":"ui",cookie,...headers},body:"{}"});
  assert.equal((await req("suno","open",{"Origin":"https://bad.example"})).status,403);
  assert.equal((await req("unknown","open")).status,404);
  const opened=await req("suno","open");
  assert.equal(opened.status,200);
  const result=await opened.json();
  assert.equal(result.url,"https://suno.com/create");
  assert.equal(result.openInUserBrowser,true);
  assert.equal(result.authenticationVerified,false);
  assert.equal(result.apiConnected,false);
  assert.equal((await req("spotify","close")).status,200);
  const status=await fetch(base+"/api/browser-accounts",{headers:{cookie}});
  assert.equal(status.status,200);
  const body=await status.json();
  assert.equal(body.spotify.website,"https://open.spotify.com/");
  assert.equal(body.chatgpt.website,"https://chatgpt.com/");
  assert.equal(body.suno.localProfilePresent,false);
});

test("Connections sign-in and Suno Studio actions use the real browser, never Playwright for Google",async()=>{
  const ui=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const studio=await readFile(new URL("../public/studio.js",import.meta.url),"utf8");
  const server=await readFile(new URL("../src/server.mjs",import.meta.url),"utf8");
  const studioApi=await readFile(new URL("../src/studio-api.mjs",import.meta.url),"utf8");
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  const css=await readFile(new URL("../public/viewport.css",import.meta.url),"utf8");
  const section=ui.slice(ui.indexOf("function browserAccountCard("),ui.indexOf("function render(){"));
  assert.match(section,/browser-accounts-grid/);
  assert.match(section,/browser-connect/);
  assert.match(section,/browser-reopen/);
  assert.match(section,/does not grant Blossom API access/);
  assert.match(section,/Continue with Facebook/);
  assert.match(section,/details class="panel browser-advanced"/);
  assert.match(ui,/window.open\(url,"_blank","noopener,noreferrer"\)/);
  assert.match(studio,/window.open\("https:\/\/suno.com\/create","_blank","noopener,noreferrer"\)/);
  assert.match(studio,/View \/ copy Suno blueprint/);
  assert.doesNotMatch(studio,/Open Suno \(Playwright\)/);
  assert.match(server,/new ConnectedBrowsers/);
  assert.match(studioApi,/new VisibleBrowserSession\("suno"\)/);
  assert.match(html,/id="account-login-dialog"/);
  assert.match(css,/body\[data-view="connections"\] \.content\{overflow:hidden/);
});
