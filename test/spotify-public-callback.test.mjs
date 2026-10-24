import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { Store } from "../src/storage.mjs";
import { Vault } from "../src/security.mjs";
import { createAppServer } from "../src/server.mjs";

const vaultKey=Buffer.alloc(32,23).toString("base64");
const clientId="b".repeat(32);
const callback="https://blossom.wenneker.dev/callback";
const publicHost="blossom.wenneker.dev";

async function fixture(t,{access=false,failSpotifyToken=false}={}) {
  const store=new Store(":memory:");
  const issued=[];
  const fetcher=async(url,options={})=>{
    const u=String(url);
    if(u==="https://accounts.spotify.com/api/token"){
      issued.push({redirectUri:options.body.get("redirect_uri"),
        clientId:options.body.get("client_id"),
        verifier:options.body.get("code_verifier"),
        code:options.body.get("code")});
      assert.equal(options.body.get("grant_type"),"authorization_code");
      assert.equal(options.body.get("redirect_uri"),callback);
      assert.equal(options.body.get("client_id"),clientId);
      assert.ok(options.body.get("code_verifier").length>40);
      if(failSpotifyToken)return {ok:false,status:400,json:async()=>({error:"invalid_grant"})};
      return {ok:true,json:async()=>({access_token:"access-private-token",
        refresh_token:"refresh-private-token"})};
    }
    if(u==="https://api.spotify.com/v1/me"){
      assert.equal(options.headers.Authorization,"Bearer access-private-token");
      return {ok:true,json:async()=>({account_id:"spotify-user-123",
        id:"legacy-id",display_name:"Connected Spotify User"})};
    }
    throw Error("Unexpected Spotify fetch: "+u);
  };
  const cloudflareAccess=access ? {
    configured:()=>true,
    verifyRequest:async()=>false
  }:null;
  const app=createAppServer({store,vaultKey,
    provider:{available:()=>false},password:"strong-test-password-for-blossom",
    mcpOrigin:"https://blossom.wenneker.dev",spotifyFetcher:fetcher,
    publicUiEnabled:access,cloudflareAccess});
  app.listen(0,"127.0.0.1");await once(app,"listening");
  t.after(async()=>{await new Promise(resolve=>app.close(resolve));store.close();});
  const port=app.address().port;
  const invoke=(path,{host="127.0.0.1:8787",method="GET",headers={},payload}={})=>new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:"127.0.0.1",port,path,method,
      headers:{Host:host,...headers}},res=>{
      const chunks=[];
      res.on("data",chunk=>chunks.push(chunk));
      res.on("end",()=>resolve({
        status:res.statusCode,
        headers:res.headers,
        body:Buffer.concat(chunks).toString("utf8"),
        json(){return JSON.parse(this.body);}
      }));
    });
    req.on("error",reject);
    req.end(payload);
  });
  const post=async(path,data,cookie="")=>invoke(path,{method:"POST",
    headers:{"content-type":"application/json","x-blossom-request":"ui",
      ...(cookie?{Cookie:cookie}:{})},payload:JSON.stringify(data)});
  const login=await post("/auth/login",{username:"admin",password:"strong-test-password-for-blossom"});
  assert.equal(login.status,200);
  const cookie=login.headers["set-cookie"][0].split(";")[0];
  const saved=await post("/api/connections/spotify",{clientId},cookie);
  assert.equal(saved.status,200);
  const start=()=>invoke("/auth/spotify/start?choose=1",{headers:{Cookie:cookie}});
  return {store,cookie,invoke,start,issued,callback,post};
}

test("Public /callback is reachable without admin cookies while unrelated admin URLs stay private",async t=>{
  const {invoke,start}=await fixture(t);
  const health=await invoke("/callback",{host:publicHost});
  assert.equal(health.status,200);
  assert.match(health.body,/Spotify-callback is actief/);
  assert.doesNotMatch(health.body,/access_token|refresh_token|client_secret/);
  assert.equal(health.headers["cache-control"],"no-store, private");
  assert.equal(health.headers["referrer-policy"],"no-referrer");
  assert.equal((await invoke("/login",{host:publicHost})).status,404);
  assert.equal((await invoke("/api/connections",{host:publicHost})).status,404);
  assert.equal((await invoke("/auth/spotify/start",{host:publicHost})).status,404);
  assert.equal((await invoke("/callback")).status,404);
  assert.equal((await invoke("/callback",{host:publicHost,method:"POST"})).status,405);
  const redirect=await start();
  assert.equal(redirect.status,303);
  const url=new URL(redirect.headers.location);
  assert.equal(url.searchParams.get("redirect_uri"),callback);
  assert.equal(url.searchParams.get("scope"),"user-read-private user-library-read");
  assert.equal(url.searchParams.get("code_challenge_method"),"S256");
});

test("Public Spotify code callback completes a local PKCE login with no public cookie and no token leaks",async t=>{
  const {store,invoke,start,issued}=await fixture(t);
  const response=await start();
  const spotify=new URL(response.headers.location);
  const state=spotify.searchParams.get("state");
  assert.ok(/^[A-Za-z0-9_-]{32}$/.test(state));
  const token=await invoke("/callback?code=spotify-auth-code&state="+state,{host:publicHost});
  assert.equal(token.status,200);
  assert.match(token.body,/Spotify verbonden/);
  assert.doesNotMatch(token.body,/spotify-auth-code|access-private-token|refresh-private-token|state=/);
  assert.equal(issued.length,1);
  assert.equal(issued[0].redirectUri,callback);
  const vault=new Vault(store.db,vaultKey);
  assert.equal(vault.read("spotify_refresh_token"),"refresh-private-token");
  const replay=await invoke("/callback?code=spotify-auth-code&state="+state,{host:publicHost});
  assert.equal(replay.status,409);
  assert.match(replay.body,/niet voltooid/);
  assert.equal(issued.length,1);
  assert.equal(vault.read("spotify_refresh_token"),"refresh-private-token");
});

test("Public callback rejects an unknown state, expired local session and replay without exchanging tokens",async t=>{
  const {store,start,invoke,issued}=await fixture(t);
  const unknown=await invoke("/callback?code=valid-code&state="+"a".repeat(32),{host:publicHost});
  assert.equal(unknown.status,409);
  assert.equal(issued.length,0);
  const redirect=await start();
  const state=new URL(redirect.headers.location).searchParams.get("state");
  store.db.prepare("UPDATE web_sessions SET expires_at=?").run(Date.now()-1);
  const expired=await invoke("/callback?code=valid-code&state="+state,{host:publicHost});
  assert.equal(expired.status,409);
  assert.equal(issued.length,0);
});

test("Denied consent and incomplete callbacks do not store tokens, return secrets or permit public admin",async t=>{
  const {store,invoke,start,issued}=await fixture(t);
  const redirect=await start();
  const state=new URL(redirect.headers.location).searchParams.get("state");
  const denied=await invoke("/callback?error=access_denied&state="+state,{host:publicHost});
  assert.equal(denied.status,400);
  assert.match(denied.body,/niet verleend/);
  const missing=await invoke("/callback?code=valid-code",{host:publicHost});
  assert.equal(missing.status,400);
  assert.equal(issued.length,0);
  assert.equal(new Vault(store.db,vaultKey).read("spotify_refresh_token"),null);
});

test("Callback still works when the rest of the public Studio requires Cloudflare Access",async t=>{
  const {invoke,start}=await fixture(t,{access:true});
  assert.equal((await invoke("/login",{host:publicHost})).status,403);
  assert.equal((await invoke("/api/summary",{host:publicHost})).status,403);
  const health=await invoke("/callback",{host:publicHost});
  assert.equal(health.status,200);
  const state=new URL((await start()).headers.location).searchParams.get("state");
  const result=await invoke("/callback?code=correct-code&state="+state,{host:publicHost});
  assert.equal(result.status,200);
});

test("Spotify token exchange errors are generic on the public callback; cannot save incomplete tokens",async t=>{
  const {store,start,invoke}=await fixture(t,{failSpotifyToken:true});
  const state=new URL((await start()).headers.location).searchParams.get("state");
  const fail=await invoke("/callback?code=bad-code&state="+state,{host:publicHost});
  assert.equal(fail.status,400);
  assert.doesNotMatch(fail.body,/bad-code|state=|invalid_grant/);
  assert.equal(new Vault(store.db,vaultKey).read("spotify_refresh_token"),null);
});
