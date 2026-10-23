import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";
import { PROVIDER_URLS, SPOTIFY_LOGIN_URL, providerBrowserUrl } from "../src/browser-connections.mjs";
import { openProviderInSafari } from "../src/native-browser.mjs";

const safariOptions=launches=>({
  platform:"darwin",
  launcher:(_bin,args,_opts,done)=>{launches.push(args);done(null);}
});

test("Spotify opens official Facebook-compatible login initially and the Web Player after confirmation", async()=>{
  assert.equal(SPOTIFY_LOGIN_URL,"https://accounts.spotify.com/nl/login");
  assert.equal(providerBrowserUrl("spotify"),SPOTIFY_LOGIN_URL);
  assert.equal(providerBrowserUrl("spotify",{confirmed:false}),SPOTIFY_LOGIN_URL);
  assert.equal(providerBrowserUrl("spotify",{confirmed:true}),"https://open.spotify.com/");
  assert.equal(providerBrowserUrl("spotify",{confirmed:true,forceLogin:true}),SPOTIFY_LOGIN_URL);
  assert.equal(providerBrowserUrl("suno"),PROVIDER_URLS.suno);
  assert.equal(providerBrowserUrl("chatgpt"),PROVIDER_URLS.chatgpt);
  assert.throws(()=>providerBrowserUrl("https://bad.example/"),/Unsupported browser provider/);
  const launches=[];
  let result=await openProviderInSafari("spotify",safariOptions(launches));
  assert.deepEqual(launches[0],["-a","Safari",SPOTIFY_LOGIN_URL]);
  assert.equal(result.url,SPOTIFY_LOGIN_URL);
  assert.equal(result.authenticationVerified,false);
  assert.equal(result.apiConnected,false);
  result=await openProviderInSafari("spotify",{...safariOptions(launches),confirmed:true});
  assert.deepEqual(launches[1],["-a","Safari","https://open.spotify.com/"]);
  result=await openProviderInSafari("spotify",{...safariOptions(launches),confirmed:true,forceLogin:true});
  assert.deepEqual(launches[2],["-a","Safari",SPOTIFY_LOGIN_URL]);
  assert.equal(launches.length,3);
});

test("Spotify Safari handoff is confirmed and can be retried, without changing Suno/ChatGPT",async t=>{
  const store=new Store(":memory:");
  const launches=[];
  const server=createAppServer({store,password:"local-test-password-very-long",
    provider:{available:()=>false},nativeBrowserOptions:safariOptions(launches)});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
  const base="http://127.0.0.1:"+server.address().port;
  const post=(route,cookie,headers={})=>fetch(base+route,{
    method:"POST",headers:{"Content-Type":"application/json","X-Blossom-Request":"ui",
      ...(cookie?{cookie}:{}),...headers},body:"{}"});
  assert.equal((await post("/api/browser-accounts/spotify/open-safari")).status,401);
  const login=await fetch(base+"/auth/login",{method:"POST",
    headers:{"Content-Type":"application/json","X-Blossom-Request":"ui"},
    body:JSON.stringify({username:"admin",password:"local-test-password-very-long"})});
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const pre=await (await fetch(base+"/api/browser-accounts",{headers:{cookie}})).json();
  assert.equal(pre.spotify.handoff.state,"not_started");
  assert.equal(pre.spotify.nextBrowserUrl,SPOTIFY_LOGIN_URL);
  assert.equal(pre.suno.handoff.state,"not_started");
  assert.equal((await post("/api/browser-accounts/spotify/login-safari",cookie,
    {Origin:"https://attacker.example"})).status,403);
  assert.equal(launches.length,0);
  const opened=await post("/api/browser-accounts/spotify/open-safari",cookie);
  assert.equal(opened.status,200);
  assert.equal((await opened.json()).handoff.state,"awaiting_confirmation");
  assert.equal(launches[0][2],SPOTIFY_LOGIN_URL);
  const confirmed=await post("/api/browser-accounts/spotify/confirm",cookie);
  assert.equal((await confirmed.json()).handoff.state,"user_confirmed");
  const updated=await (await fetch(base+"/api/browser-accounts",{headers:{cookie}})).json();
  assert.equal(updated.spotify.nextBrowserUrl,"https://open.spotify.com/");
  assert.equal(updated.spotify.authenticationVerified,false);
  assert.equal(updated.spotify.apiConnected,false);
  const player=await post("/api/browser-accounts/spotify/open-safari",cookie);
  assert.equal((await player.json()).handoff.state,"user_confirmed");
  assert.equal(launches[1][2],"https://open.spotify.com/");
  const again=await post("/api/browser-accounts/spotify/login-safari",cookie);
  assert.equal((await again.json()).handoff.state,"awaiting_confirmation");
  assert.equal(launches[2][2],SPOTIFY_LOGIN_URL);
  const end=await (await fetch(base+"/api/browser-accounts",{headers:{cookie}})).json();
  assert.equal(end.spotify.nextBrowserUrl,SPOTIFY_LOGIN_URL);
  assert.equal(end.suno.handoff.state,"not_started");
  assert.equal(end.chatgpt.handoff.state,"not_started");
  assert.equal((await post("/api/browser-accounts/suno/login-safari",cookie)).status,404);
  assert.equal(launches.length,3);
});

test("Spotify Connections UI distinguishes login from player, and has no mandatory Client ID",async()=>{
  const ui=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const section=ui.slice(ui.indexOf("function browserAccountCard("),ui.indexOf("function render(){"));
  assert.ok(section.includes("Inloggen via Spotify / Facebook"));
  assert.ok(section.includes("Opnieuw aanmelden via Facebook"));
  assert.ok(section.includes("browser-spotify-login"));
  assert.ok(ui.includes("accounts.spotify.com/nl/login"));
  assert.ok(section.includes("Verdergaan met Facebook"));
  assert.ok(section.includes('details class="panel browser-advanced"'));
  assert.ok(section.includes("Geen Client ID nodig voor websitegebruik"));
  assert.ok(ui.includes("login-safari"));
  assert.ok(section.includes('handoff.state==="user_confirmed"'));
});
