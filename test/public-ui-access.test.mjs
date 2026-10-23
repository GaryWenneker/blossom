import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { CloudflareAccess } from "../src/cloudflare-access.mjs";
import { createAppServer } from "../src/server.mjs";

const publicOrigin = "https://blossom.wenneker.dev";
const team = "test-team.cloudflareaccess.com";
const aud = "accessaudience_012345678901";
const {publicKey, privateKey} = generateKeyPairSync("rsa", {modulusLength: 2048});
const jwk = {...publicKey.export({format: "jwk"}), kid: "test-key-1", use: "sig", alg: "RS256"};
const access = new CloudflareAccess({
  teamDomain: team, audience: aud,
  fetcher: async () => ({ok: true, json: async () => ({keys: [jwk]})})
});
function jwt(overrides = {}) {
  const now = Math.floor(Date.now()/1000);
  const h = Buffer.from(JSON.stringify({typ: "JWT",alg: "RS256",kid: jwk.kid})).toString("base64url");
  const p = Buffer.from(JSON.stringify({iss: "https://" + team,aud:[aud],
    iat:now,exp:now+3600,sub:"user-test",...overrides})).toString("base64url");
  return h+"."+p+"."+sign("RSA-SHA256",Buffer.from(h+"."+p),privateKey).toString("base64url");
}
async function fixture(t,enabled) {
  const store = new Store(":memory:");
  const app = createAppServer({store,provider:{available:()=>false},
    password:"a-long-test-admin-password",mcpOrigin:publicOrigin,
    publicUiEnabled:enabled,cloudflareAccess:access});
  app.listen(0,"127.0.0.1");
  await once(app,"listening");
  t.after(async()=>{await new Promise(ok=>app.close(ok));store.close();});
  const port=app.address().port;
  const invoke=(path,method="GET",headers={},payload)=>new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:"127.0.0.1",port,path,method,headers},res=>{
      const data=[];
      res.on("data",chunk=>data.push(chunk));
      res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(data).toString("utf8")}));
    });
    req.on("error",reject);req.end(payload);
  });
  return {invoke};
}
const host = {host:"blossom.wenneker.dev"};
const signed = ()=>({...host,"cf-access-jwt-assertion":jwt()});

test("Public host remains an informative MCP gateway by default, never an admin login",async t=>{
  const {invoke}=await fixture(t,false);
  assert.equal((await invoke("/", "GET",host)).status,200);
  assert.equal((await invoke("/login","GET",host)).status,404);
  assert.equal((await invoke("/login")).status,200);
  assert.equal((await invoke("/.well-known/oauth-authorization-server","GET",host)).status,200);
  assert.equal((await invoke("/mcp","POST",{...host,"content-type":"application/json"},
    JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"}))).status,401);
});

test("Public Studio is unavailable unless Cloudflare Access verification is configured",()=>{
  const store=new Store(":memory:");
  try {
    assert.throws(()=>createAppServer({store,provider:{available:()=>false},
      password:"a-long-test-admin-password",mcpOrigin:publicOrigin,
      publicUiEnabled:true,cloudflareAccess:new CloudflareAccess()}),
    /requires BLOSSOM_MCP_PUBLIC_URL/);
  } finally {store.close();}
});

test("Public Studio serves a valid Access user and rejects all missing, expired or invalid JWTs",async t=>{
  const {invoke}=await fixture(t,true);
  const noToken=await invoke("/login","GET",host);
  assert.equal(noToken.status,403);
  assert.equal((await invoke("/login","GET",{...host,"cf-access-jwt-assertion":jwt({exp:1})})).status,403);
  assert.equal((await invoke("/login","GET",{...host,"cf-access-jwt-assertion":jwt({aud:["other-app-aud"]})})).status,403);
  assert.equal((await invoke("/login","GET",{...host,"cf-access-jwt-assertion":jwt({iss:"https://imposter.cloudflareaccess.com"})})).status,403);
  const valid=await invoke("/login","GET",signed());
  assert.equal(valid.status,200);
  assert.match(valid.body,/Sign in to manage/);
  assert.equal((await invoke("/","GET",signed())).status,303);
  assert.equal((await invoke("/healthz","GET",host)).status,200);
  assert.equal((await invoke("/.well-known/oauth-authorization-server","GET",host)).status,200);
});

test("Public Studio login requires Access JWT and its own CSRF protection; sets Secure cookie",async t=>{
  const {invoke}=await fixture(t,true);
  const request = JSON.stringify({username:"admin",password:"a-long-test-admin-password"});
  const headers={...signed(),"origin":publicOrigin,
    "content-type":"application/json","x-blossom-request":"ui"};
  assert.equal((await invoke("/auth/login","POST",{...headers,"origin":"https://evil.test"},request)).status,403);
  assert.equal((await invoke("/auth/login","POST",{...host,origin:publicOrigin,
    "content-type":"application/json","x-blossom-request":"ui"},request)).status,403);
  assert.equal((await invoke("/auth/login","POST",{...headers,"x-blossom-request":"wrong"},request)).status,403);
  const login=await invoke("/auth/login","POST",headers,request);
  assert.equal(login.status,200);
  assert.match(login.headers["set-cookie"]?.[0]||"",/Secure/);
  const cookie=login.headers["set-cookie"]?.[0]?.split(";")[0];
  assert.ok(cookie);
  const home=await invoke("/","GET",{...signed(),cookie});
  assert.equal(home.status,200);
  assert.match(home.body,/studio.js/);
  const api=await invoke("/api/studio/projects","GET",{...signed(),cookie});
  assert.equal(api.status,200);
  assert.equal((await invoke("/api/studio/projects","GET",{...host,cookie})).status,403);
  const localLogin=await invoke("/login");
  assert.equal(localLogin.status,200);
});
