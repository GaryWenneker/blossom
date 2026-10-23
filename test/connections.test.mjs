import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";
const vaultKey=Buffer.alloc(32,7).toString("base64");
async function start(t,key=vaultKey) {
 const store=new Store(":memory:");
 const provider={available:()=>false};
 const server=createAppServer({store,provider,password:"test-password-long-enough",vaultKey:key});
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{await new Promise(done=>server.close(done));store.close()});
 const url="http://127.0.0.1:"+server.address().port;
 const post=async(path,json,extra={})=>fetch(url+path,{method:"POST",
  headers:{"content-type":"application/json","x-blossom-request":"ui",...extra},
  body:JSON.stringify(json)});
 const login=await post("/auth/login",{username:"admin",password:"test-password-long-enough"});
 assert.equal(login.status,200);
 const cookie=login.headers.get("set-cookie").split(";")[0];
 return {url,store,cookie,post:(path,body,headers={})=>post(path,body,{cookie,...headers}),
   get:(path,options={})=>fetch(url+path,{headers:{cookie},...options})};
}
test("Web login page renders password-manager-friendly fields with no basic auth",async t=>{
 const {url,get,cookie}=await start(t);
 const login=await fetch(url+"/login");
 assert.equal(login.status,200);
 const html=await login.text();
 assert.match(html,/autocomplete="username"/);
 assert.match(html,/autocomplete="current-password"/);
 assert.match(html,/<form/);
 const unauth=await fetch(url+"/api/summary");
 assert.equal(unauth.status,401);assert.equal(unauth.headers.get("www-authenticate"),null);
 assert.equal((await get("/api/genres")).status,200);
 assert.equal((await fetch(url+"/")).status,200); // Redirects to public login
 assert.ok(cookie.startsWith("blossom_session="));
});
test("Provider keys can be saved and removed, never read through HTTP",async t=>{
 const {post,get,store}=await start(t);
 let res=await post("/api/connections/suno",{email:"user@example.com",apiKey:"secret-from-user"});
 assert.equal(res.status,200);
 const json=await res.json();
 assert.equal(json.suno_api_key.configured,true);
 assert.equal(JSON.stringify(json).includes("secret-from-user"),false);
 assert.equal(store.db.prepare("SELECT ciphertext FROM credentials WHERE name='suno_api_key'").get().ciphertext.includes("secret-from-user"),false);
 res=await get("/api/connections");
 assert.equal(JSON.stringify(await res.json()).includes("secret-from-user"),false);
 res=await post("/api/connections/suno/remove",{});
 assert.equal((await res.json()).suno_api_key.configured,false);
});
test("Spotify password is never accepted; requires developer client ID",async t=>{
 const {post,get,store}=await start(t);
 assert.equal((await post("/api/connections/spotify",{clientId:"bad",password:"should-not-save"})).status,400);
 assert.equal((await post("/api/connections/spotify",{clientId:"f".repeat(32),password:"not-allowed"})).status,400);
 assert.equal((await post("/api/connections/spotify",{clientId:"f".repeat(32)})).status,200);
 assert.equal(store.db.prepare("SELECT * FROM credentials WHERE name='spotify_refresh_token'").get(),undefined);
 const res=await get("/auth/spotify/start",{redirect:"manual"});
 assert.equal(res.status,303);
 assert.ok(res.headers.get("location").startsWith("https://accounts.spotify.com/authorize?"));
});
test("CSRF origin and custom header protect authenticated mutations",async t=>{
 const {post,get}=await start(t);
 const badOrigin=await post("/api/connections/suno",{email:"bad@example.com"},{origin:"https://attacker.example"});
 assert.equal(badOrigin.status,403);
 const authOk=await get("/auth/session");assert.equal(authOk.status,200);
});
test("No encryption key means secret storage is blocked",async t=>{
 const {post,get}=await start(t,null);
 assert.equal((await get("/api/connections")).status,200);
 assert.equal((await post("/api/connections/suno",{apiKey:"secret"})).status,503);
});
