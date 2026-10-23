import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";
import { VisibleBrowserSession, ConnectedBrowsers } from "../src/browser-connections.mjs";

function fakeChrome() {
  const visits = [], launches = [], closes = [];
  let cookieAttempts = 0;
  const loader = async () => ({ chromium: {
    launchPersistentContext: async (path, settings) => {
      launches.push({ path, settings });
      const events = new EventEmitter();
      const page = {
        closed: false, isClosed(){return this.closed;},
        async goto(url) { visits.push(url); },
        async bringToFront() {}
      };
      return {
        on: (...args) => events.on(...args),
        pages: () => [page],
        async newPage() { return page; },
        async cookies() { cookieAttempts++; throw Error("Never inspect provider cookies"); },
        async close() { closes.push(path); page.closed=true; events.emit("close"); }
      };
    }
  }});
  return { loader, launches, visits, closes, get cookieAttempts() { return cookieAttempts; } };
}
test("Spotify and ChatGPT each use a distinct persistent isolated headful Chrome profile", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blossom-browser-session-"));
  try {
    const fake = fakeChrome();
    const spotify = new VisibleBrowserSession("spotify", {profileDir:join(dir,"spotify"),loader:fake.loader});
    const chatgpt = new VisibleBrowserSession("chatgpt", {profileDir:join(dir,"chatgpt"),loader:fake.loader});
    assert.equal(spotify.status().localProfilePresent,false);
    const a = await spotify.open(), b = await chatgpt.open();
    assert.equal(a.browserOpen,true);
    assert.equal(b.browserOpen,true);
    assert.equal(a.authenticationVerified,false);
    assert.equal(b.apiConnected,false);
    assert.equal(a.localProfilePresent,true);
    assert.equal(fake.launches.length,2);
    assert.notEqual(fake.launches[0].path,fake.launches[1].path);
    assert.ok(fake.launches.every(v=>v.settings.headless===false));
    assert.ok(fake.launches.every(v=>v.settings.acceptDownloads===false));
    assert.deepEqual(fake.visits,["https://open.spotify.com/","https://chatgpt.com/"]);
    assert.equal((await spotify.open()).reusedWindow,true);
    assert.equal(fake.launches.length,2);
    await spotify.close();
    await chatgpt.close();
    assert.equal(fake.cookieAttempts,0);
    assert.equal(spotify.status().localProfilePresent,true);
    const restarted=new VisibleBrowserSession("spotify",{profileDir:join(dir,"spotify"),loader:fake.loader});
    assert.equal(restarted.status().localProfilePresent,true);
    assert.equal(restarted.status().authenticationVerified,false);
    await restarted.open();
    assert.equal(fake.launches[2].path,fake.launches[0].path);
    await restarted.close();
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test("Unrecognized providers are rejected and no arbitrary URL or cookies are exposed", async () => {
  assert.throws(()=>new VisibleBrowserSession("google-drive"),/Unsupported browser service/);
  const stub={profileDir:".data/test-unused",status:()=>({running:false}),
    async open(){return {running:true,reopened:false};},async close(){}};
  const manager=new ConnectedBrowsers({suno:stub,spotify:{status:()=>({browserOpen:false}),close:async()=>{}},
    chatgpt:{status:()=>({browserOpen:false}),close:async()=>{}}});
  await assert.rejects(manager.open("../../etc/passwd"),/Unsupported browser provider/);
  const result=await manager.open("suno");
  assert.equal(result.apiConnected,false);
  assert.equal(result.authenticationVerified,false);
  assert.equal(JSON.stringify(result).includes("cookie"),false);
});

test("Browser account HTTP endpoints require a signed-in Blossom session and are deliberately not API grants",async t=>{
  const store=new Store(":memory:");
  const opened=[], closed=[];
  const browsers={
    async status(){return {
      suno:{browserOpen:opened.includes("suno"),localProfilePresent:true,authenticationVerified:false,apiConnected:false},
      spotify:{browserOpen:opened.includes("spotify"),localProfilePresent:false,authenticationVerified:false,apiConnected:false},
      chatgpt:{browserOpen:opened.includes("chatgpt"),localProfilePresent:false,authenticationVerified:false,apiConnected:false}
    };},
    async open(name){opened.push(name);return {provider:name,browserOpen:true,authenticationVerified:false,apiConnected:false};},
    async close(name){closed.push(name);return {provider:name,browserOpen:false};},
    async closeAll(){closed.push("all");}
  };
  const server=createAppServer({store,password:"a-secure-local-admin-password",
    provider:{available:()=>false},connectedBrowsers:browsers});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
  const base="http://127.0.0.1:"+server.address().port;
  assert.equal((await fetch(base+"/api/browser-accounts")).status,401);
  const login=await fetch(base+"/auth/login",{
    method:"POST",headers:{"Content-Type":"application/json","X-Blossom-Request":"ui"},
    body:JSON.stringify({username:"admin",password:"a-secure-local-admin-password"})
  });
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const req=(provider,action,headers={})=>fetch(base+"/api/browser-accounts/"+provider+"/"+action,
    {method:"POST",headers:{"content-type":"application/json","X-Blossom-Request":"ui",cookie,...headers},
    body:"{}"});
  assert.equal((await req("spotify","open",{"Origin":"https://attacker.example"})).status,403);
  assert.equal((await req("unknown","open")).status,404);
  const res=await req("spotify","open");
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{provider:"spotify",browserOpen:true,authenticationVerified:false,apiConnected:false});
  assert.deepEqual(opened,["spotify"]);
  const status=await fetch(base+"/api/browser-accounts",{headers:{cookie}});
  assert.equal(status.status,200);
  const result=await status.json();
  assert.equal(result.spotify.apiConnected,false);
  assert.equal(result.suno.authenticationVerified,false);
  assert.equal(JSON.stringify(result).includes("cookies"),false);
  assert.equal((await req("spotify","close")).status,200);
  assert.deepEqual(closed,["spotify"]);
});

test("Connections moves browser sign-in above hidden API developer forms and supplies a modal",async()=>{
  const ui=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  const css=await readFile(new URL("../public/viewport.css",import.meta.url),"utf8");
  const section=ui.slice(ui.indexOf("function browserAccountCard("),ui.indexOf("function render(){"));
  assert.match(section,/browser-accounts-grid/);
  assert.match(section,/details class="panel browser-advanced"/);
  assert.match(section,/browser-connect/);
  assert.match(ui,/browser-reopen/);
  assert.ok(section.includes("/auth/spotify/start?choose=1"));
  assert.match(section,/does not grant Blossom API access/);
  assert.match(section,/Continue with Facebook/);
  assert.match(html,/id="account-login-dialog"/);
  assert.match(html,/id="account-login-status"/);
  assert.match(css,/body\[data-view="connections"\] \.content\{overflow:hidden/);
});
