import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";

test("Browser handoff status is isolated per provider, survives restart and never asserts API authorization",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"blossom-confirmed-logins-"));
 const db=join(dir,"blossom.sqlite");
 try{
  const store=new Store(db);
  assert.equal(store.browserAccountStatus("suno").state,"not_started");
  assert.equal(store.browserAccountStatus("spotify").state,"not_started");
  store.setBrowserAccountStatus("suno","opened");
  let result=store.browserAccountStatus("suno");
  assert.equal(result.state,"awaiting_confirmation");
  assert.ok(result.lastOpenedAt);
  assert.equal(result.confirmedAt,"");
  result=store.setBrowserAccountStatus("suno","confirmed");
  assert.equal(result.state,"user_confirmed");
  assert.ok(result.confirmedAt);
  assert.equal(store.browserAccountStatus("spotify").state,"not_started");
  result=store.setBrowserAccountStatus("suno","opened");
  assert.equal(result.state,"user_confirmed");
  assert.ok(result.confirmedAt);
  assert.ok(result.lastOpenedAt);
  await assert.rejects(async()=>store.setBrowserAccountStatus("suno","fake"),/Invalid browser handoff/);
  assert.throws(()=>store.browserAccountStatus("unknown"),/Unsupported browser provider/);
  store.close();

  const again=new Store(db);
  assert.equal(again.browserAccountStatus("suno").state,"user_confirmed");
  assert.equal(again.browserAccountStatus("chatgpt").state,"not_started");
  const reset=again.setBrowserAccountStatus("suno","not_confirmed");
  assert.equal(reset.state,"not_confirmed");
  assert.equal(reset.confirmedAt,"");
  again.setBrowserAccountStatus("suno","opened");
  assert.equal(again.browserAccountStatus("suno").state,"awaiting_confirmation");
  again.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});

test("Authenticated Safari launch returns pending handoff, and user-confirmed status is reflected immediately",async t=>{
 const store=new Store(":memory:");let launches=0;
 const server=createAppServer({store,provider:{available:()=>false},
   password:"some-long-secure-password",
   nativeBrowserOptions:{platform:"darwin",launcher:(_bin,_args,_opts,done)=>{launches++;done(null);}}});
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
 const base="http://127.0.0.1:"+server.address().port;
 const post=(path,cookie,headers={})=>fetch(base+path,{method:"POST",
  headers:{"Content-Type":"application/json","X-Blossom-Request":"ui",...(cookie?{cookie}:{}),...headers},body:"{}"});
 assert.equal((await post("/api/browser-accounts/suno/confirm")).status,401);
 const ok=await fetch(base+"/auth/login",{method:"POST",
   headers:{"Content-Type":"application/json","X-Blossom-Request":"ui"},
   body:JSON.stringify({username:"admin",password:"some-long-secure-password"})});
 assert.equal(ok.status,200);
 const cookie=ok.headers.get("set-cookie").split(";")[0];
 const before=await fetch(base+"/api/browser-accounts",{headers:{cookie}});
 let status=await before.json();
 assert.equal(status.suno.handoff.state,"not_started");
 assert.equal(status.suno.authenticationVerified,false);
 const opened=await post("/api/browser-accounts/suno/open-safari",cookie);
 assert.equal(opened.status,200);assert.equal(launches,1);
 assert.equal((await opened.json()).handoff.state,"awaiting_confirmation");
 const confirmed=await post("/api/browser-accounts/suno/confirm",cookie);
 assert.equal(confirmed.status,200);
 let result=await confirmed.json();
 assert.equal(result.handoff.state,"user_confirmed");
 assert.equal(result.authenticationVerified,false);
 assert.equal(result.apiConnected,false);
 assert.equal(result.browserOpen,false);
 status=await (await fetch(base+"/api/browser-accounts",{headers:{cookie}})).json();
 assert.equal(status.suno.handoff.state,"user_confirmed");
 assert.equal(status.spotify.handoff.state,"not_started");
 assert.equal((await post("/api/browser-accounts/suno/confirm",cookie,
   {Origin:"https://malicious.example"})).status,403);
 assert.equal((await post("/api/browser-accounts/bad/confirm",cookie)).status,404);
 const reopened=await post("/api/browser-accounts/suno/open-safari",cookie);
 assert.equal((await reopened.json()).handoff.state,"user_confirmed");
 assert.equal(launches,2);
 const undone=await post("/api/browser-accounts/suno/not-confirmed",cookie);
 assert.equal((await undone.json()).handoff.state,"not_confirmed");
 assert.equal((await post("/api/browser-accounts/suno/open",cookie)).status,200);
 status=await (await fetch(base+"/api/browser-accounts",{headers:{cookie}})).json();
 assert.equal(status.suno.handoff.state,"awaiting_confirmation");
});

test("UI distinguishes human confirmation from verified session and refreshes on browser return",async()=>{
 const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
 const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
 const css=await readFile(new URL("../public/viewport.css",import.meta.url),"utf8");
 assert.match(app,/Door jou bevestigd/);
 assert.match(app,/Wacht op bevestiging/);
 assert.match(app,/data-action="browser-confirm"/);
 assert.match(app,/data-action="browser-not-confirmed"/);
 assert.match(app,/updateBrowserStatusOnReturn/);
 assert.match(app,/visibilitychange/);
 assert.match(app,/window.addEventListener\("focus"/);
 assert.match(app,/niet automatisch geverifieerd/);
 assert.match(html,/data-action="browser-confirm"/);
 assert.match(html,/data-action="browser-not-confirmed"/);
 assert.match(css,/\.browser-account-confirm/);
});
