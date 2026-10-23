import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/storage.mjs";
import { Sessions, Vault } from "../src/security.mjs";
import { SpotifyOAuth } from "../src/spotify.mjs";
import { ALL_GENRES, GENRES } from "../src/genres.mjs";
const key=Buffer.alloc(32,3).toString("base64");
test("Vault encrypts credential at rest and does not return it in status",()=>{
 const db=new Store(":memory:");const vault=new Vault(db.db,key);
 vault.setSetting("suno_email","operator@example.com");
 vault.save("suno_api_key","operator@example.com","suno-secret-123");
 const stored=db.db.prepare("SELECT ciphertext FROM credentials WHERE name='suno_api_key'").get().ciphertext;
 assert.ok(!stored.includes("suno-secret-123"));
 assert.equal(vault.read("suno_api_key"),"suno-secret-123");
 assert.equal(vault.list().suno_api_key.configured,true);
 assert.equal(JSON.stringify(vault.list()).includes("suno-secret-123"),false);
 vault.delete("suno_api_key");assert.equal(vault.read("suno_api_key"),null);db.close();
});
test("Vault rejects bad key and tampered ciphertext",()=>{
 const db=new Store(":memory:");
 assert.throws(()=>new Vault(db.db,"not-a-key"),/base64-encoded/);
 const vault=new Vault(db.db,key);vault.save("suno_api_key","a","protected");
 db.db.prepare("UPDATE credentials SET ciphertext=? WHERE name='suno_api_key'").run("v1.a.b.c");
 assert.throws(()=>vault.read("suno_api_key"),/cannot be decrypted/);
 db.close();
});
test("Vault refuses to store secrets without server key",()=>{
 const db=new Store(":memory:");const vault=new Vault(db.db);
 assert.equal(vault.list().vaultReady,false);
 assert.throws(()=>vault.save("suno_api_key","a","secret"),/locked/);db.close();
});
test("Sessions enforce password, expiration, and revocation",()=>{
 const db=new Store(":memory:");const sessions=new Sessions(db.db,{username:"admin",password:"very-long-password"});
 assert.throws(()=>sessions.login("admin","wrong","ip"),/Invalid/);
 const token=sessions.login("admin","very-long-password","ip");
 const req={headers:{cookie:"blossom_session="+token}};
 assert.ok(sessions.session(req));
 sessions.logout(req);assert.equal(sessions.session(req),null);
 db.close();
});
test("Login throttles repeated incorrect passwords",()=>{
 const db=new Store(":memory:");const sessions=new Sessions(db.db,{password:"very-long-password"});
 for(let i=0;i<7;i++)assert.throws(()=>sessions.login("admin","wrong","ip"),/Invalid/);
 assert.throws(()=>sessions.login("admin","very-long-password","ip"),/Too many/);db.close();
});
test("Spotify OAuth uses state, PKCE, profile verification and encrypted refresh token",async()=>{
 const db=new Store(":memory:"),vault=new Vault(db.db,key),sessions=new Sessions(db.db,{password:"very-long-password"});
 vault.setSetting("spotify_client_id","a".repeat(32));
 const fetchCalls=[];
 const spotify=new SpotifyOAuth({vault,sessions,fetcher:async(url,options)=>{
   fetchCalls.push({url,options});
   if(url.includes("api/token"))return {ok:true,json:async()=>({access_token:"access-secret",refresh_token:"refresh-secret"})};
   if(url.includes("v1/me"))return {ok:true,json:async()=>({id:"spotify-account",display_name:"Listener"})};
   throw Error("Unexpected URL");
 }});
 const sessionHash=sessions.session({headers:{cookie:"blossom_session="+sessions.login("admin","very-long-password")}});
 const url=new URL(spotify.start(sessionHash));
 assert.equal(url.origin,"https://accounts.spotify.com");
 assert.equal(url.searchParams.get("code_challenge_method"),"S256");
 assert.equal(url.searchParams.get("redirect_uri"),"http://127.0.0.1:8787/auth/spotify/callback");
 const state=url.searchParams.get("state");
 assert.equal((await spotify.complete(sessionHash,state,"auth-code")).label,"Listener");
 assert.equal(vault.read("spotify_refresh_token"),"refresh-secret");
 assert.equal(JSON.stringify(vault.list()).includes("refresh-secret"),false);
 await assert.rejects(()=>spotify.complete(sessionHash,state,"auth-code"),/already used/);
 assert.equal(fetchCalls.length,2);db.close();
});
test("Genre taxonomy covers full country family and diverse vocal/instrumental music",()=>{
 for(const name of ["Country Pop","Outlaw Country","Americana","Bluegrass","Honky Tonk","Country Rock","Reggaeton","Jazz","Sleep Ambient","Melodic House"])
 assert.ok(ALL_GENRES.includes(name),name);
 assert.ok(Object.keys(GENRES).length>=10);assert.ok(ALL_GENRES.length>=100);
});

test("Spotify refresh validates account and clears expired grants",async()=>{
 const db=new Store(":memory:"),vault=new Vault(db.db,key),sessions=new Sessions(db.db,{password:"very-long-password"});
 vault.setSetting("spotify_client_id","b".repeat(32));
 vault.save("spotify_refresh_token","Listener","old-refresh");
 let expire=false;
 const spotify=new SpotifyOAuth({vault,sessions,fetcher:async(url,options)=>{
   if(url.includes("api/token")){
     if(expire)return {ok:false,status:400,json:async()=>({error:"invalid_grant"})};
     assert.equal(options.body.get("grant_type"),"refresh_token");
     return {ok:true,json:async()=>({access_token:"short-lived",refresh_token:"new-refresh"})};
   }
   return {ok:true,json:async()=>({account_id:"stable",display_name:"Listener"})};
 }});
 assert.deepEqual(await spotify.profile(),{accountId:"stable",displayName:"Listener"});
 assert.equal(vault.read("spotify_refresh_token"),"new-refresh");
 expire=true;
 await assert.rejects(()=>spotify.profile(),/authorization expired/);
 assert.equal(vault.read("spotify_refresh_token"),null);
 db.close();
});
