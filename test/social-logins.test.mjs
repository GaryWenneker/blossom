import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { SpotifyOAuth } from "../src/spotify.mjs";
import { Sessions, Vault } from "../src/security.mjs";
import { createAppServer } from "../src/server.mjs";

const vaultKey=Buffer.alloc(32, 17).toString("base64");
const cid="b".repeat(32);

test("Spotify OAuth account chooser enables existing Facebook SSO without collecting a Facebook token", async () => {
  const store=new Store(":memory:");
  try {
    const vault=new Vault(store.db, vaultKey);
    const sessions=new Sessions(store.db, { password:"test-password-is-long-enough" });
    vault.setSetting("spotify_client_id",cid);
    const spotify=new SpotifyOAuth({vault,sessions,fetcher:async (url, options) => {
      if(url.includes("api/token")) {
        assert.equal(options.body.get("code_verifier").length>40,true);
        assert.equal(options.body.get("client_id"),cid);
        assert.equal(options.body.has("facebook_access_token"),false);
        return {ok:true,json:async()=>({access_token:"access123",refresh_token:"refresh123"})};
      }
      if(url.includes("/v1/me")) return {
        ok:true,json:async()=>({id:"old-user-id",account_id:"stable-account-id",display_name:"Facebook Spotify User"})};
      throw Error("Unexpected endpoint");
    }});
    const token=sessions.login("admin","test-password-is-long-enough");
    const sessionHash=sessions.session({headers:{cookie:"blossom_session="+token}});
    const initial=new URL(spotify.start(sessionHash));
    assert.equal(initial.origin,"https://accounts.spotify.com");
    assert.equal(initial.searchParams.has("show_dialog"),false);
    const login=new URL(spotify.start(sessionHash,{chooseAccount:true}));
    assert.equal(login.searchParams.get("show_dialog"),"true");
    assert.equal(login.searchParams.get("code_challenge_method"),"S256");
    assert.equal(login.searchParams.get("redirect_uri"),"http://127.0.0.1:8787/auth/spotify/callback");
    assert.equal(login.searchParams.has("facebook_access_token"),false);
    const linked=await spotify.complete(sessionHash,login.searchParams.get("state"),"oauth-code");
    assert.deepEqual(linked,{accountId:"stable-account-id",label:"Facebook Spotify User"});
    assert.equal(vault.read("spotify_refresh_token"),"refresh123");
    await assert.rejects(()=>spotify.complete(sessionHash,login.searchParams.get("state"),"oauth-code"),/already used/);
  } finally {store.close();}
});

test("Spotify profile supports both newly provided stable account ID and legacy user ID", async () => {
  const store=new Store(":memory:");
  try {
    const vault=new Vault(store.db,vaultKey);
    const sessions=new Sessions(store.db,{password:"test-password-is-long-enough"});
    vault.setSetting("spotify_client_id",cid);
    vault.save("spotify_refresh_token","A connected user","valid-refresh");
    let newest=true;
    const spotify=new SpotifyOAuth({vault,sessions,fetcher:async url=>url.includes("/api/token")
      ? {ok:true,json:async()=>({access_token:"valid-access"})}
      : {ok:true,json:async()=>newest
        ? ({account_id:"immutable-profile-id",id:"legacy-user-id",display_name:"Connected user"})
        : ({id:"legacy-user-id",display_name:"Connected user"})}});
    assert.deepEqual(await spotify.profile(),
      {accountId:"immutable-profile-id",displayName:"Connected user"});
    newest=false;
    assert.deepEqual(await spotify.profile(),
      {accountId:"legacy-user-id",displayName:"Connected user"});
  } finally {store.close();}
});

test("Authenticated account-selection route performs real Spotify OAuth redirect and callback", async t => {
  const store=new Store(":memory:");
  const spotifyFetcher=async url=>url.includes("/api/token")
    ? {ok:true,json:async()=>({access_token:"valid-access",refresh_token:"valid-refresh"})}
    : {ok:true,json:async()=>({id:"spotify-id",account_id:"stable-spotify",display_name:"Selected account"})};
  const server=createAppServer({store,provider:{available:()=>false},
    password:"very-long-test-password",vaultKey,spotifyFetcher});
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  const base="http://127.0.0.1:"+server.address().port;
  const start=path=>fetch(base+path,{redirect:"manual",headers:{cookie}});
  const login=await fetch(base+"/auth/login",{method:"POST",
    headers:{"Content-Type":"application/json","X-Blossom-Request":"ui"},
    body:JSON.stringify({username:"admin",password:"very-long-test-password"})});
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const unauthenticated=await fetch(base+"/auth/spotify/start?choose=1",{redirect:"manual"});
  assert.equal(unauthenticated.status,401);
  assert.equal((await start("/auth/spotify/start?choose=1")).status,409);
  const saved=await fetch(base+"/api/connections/spotify",{method:"POST",
    headers:{cookie,"content-type":"application/json","x-blossom-request":"ui"},
    body:JSON.stringify({clientId:cid})});
  assert.equal(saved.status,200);
  const redirect=await start("/auth/spotify/start?choose=1");
  assert.equal(redirect.status,303);
  const auth=new URL(redirect.headers.get("location"));
  assert.equal(auth.searchParams.get("show_dialog"),"true");
  const callback=await start("/auth/spotify/callback?code=spotify-code&state="+auth.searchParams.get("state"));
  assert.equal(callback.status,303);
  assert.equal(callback.headers.get("location"),"/?spotify=connected");
  const profile=await fetch(base+"/api/connections/spotify/profile",{headers:{cookie}});
  assert.equal(profile.status,200);
  assert.deepEqual(await profile.json(),
    {accountId:"stable-spotify",displayName:"Selected account"});
});

test("Suno button uses provider-owned Google sign-in and never claims API OAuth", async () => {
  const ui=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const view=ui.slice(ui.indexOf("function connections(){"),ui.indexOf("function render(){"));
  assert.match(view,/https:\/\/suno\.com\//);
  assert.match(view,/Continue with Google/);
  assert.match(view,/does not grant Blossom API access/i);
  assert.match(view,/\/auth\/spotify\/start\?choose=1/);
  assert.match(view,/Continue with Facebook/);
  assert.doesNotMatch(view,/<input[^>]+name="password"/);
});
