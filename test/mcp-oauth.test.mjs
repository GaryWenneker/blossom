import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";

const origin="https://blossom.wenneker.dev",resource=origin+"/mcp";
const callback="https://chatgpt.com/connector_platform_oauth_redirect";
async function withApp(t) {
  const store=new Store(":memory:");
  const server=createAppServer({store,provider:{available:()=>false},
    password:"very-long-local-blossom-password",mcpOrigin:origin});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.close();});
  return {store,base:"http://127.0.0.1:"+server.address().port};
}
const postJson=(base,path,body,headers={})=>fetch(base+path,{
  method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)
});
const postForm=(base,path,body)=>fetch(base+path,{
  method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams(body),redirect:"manual"
});
test("OAuth discovery, ChatGPT-only dynamic registration and protected MCP challenge",async t=>{
  const {base}=await withApp(t);
  const rm=await (await fetch(base+"/.well-known/oauth-protected-resource")).json();
  assert.equal(rm.resource,resource);
  assert.deepEqual(rm.authorization_servers,[origin]);
  assert.ok(rm.scopes_supported.includes("blossom:write"));
  const md=await (await fetch(base+"/.well-known/oauth-authorization-server")).json();
  assert.equal(md.issuer,origin);
  assert.equal(md.registration_endpoint,origin+"/oauth/register");
  assert.equal(md.authorization_response_iss_parameter_supported,true);
  assert.ok(md.code_challenge_methods_supported.includes("S256"));
  assert.ok(md.token_endpoint_auth_methods_supported.includes("none"));
  const denied=await postJson(base,"/oauth/register",{redirect_uris:["https://attacker.example/steal"]});
  assert.equal(denied.status,400);
  const registered=await postJson(base,"/oauth/register",{redirect_uris:[callback],
    token_endpoint_auth_method:"none",grant_types:["authorization_code","refresh_token"]});
  assert.equal(registered.status,201);
  assert.ok((await registered.json()).client_id.startsWith("blossom_"));
  const unauthorized=await postJson(base,"/mcp",{jsonrpc:"2.0",id:1,method:"tools/list"});
  assert.equal(unauthorized.status,401);
  assert.match(unauthorized.headers.get("www-authenticate"),/oauth-protected-resource/);
  const forbiddenPublic=await fetch(base+"/api/studio/projects",{headers:{Host:"blossom.wenneker.dev"}});
  assert.equal(forbiddenPublic.status,404);
  const publicMetadata=await fetch(base+"/.well-known/oauth-authorization-server",
    {headers:{Host:"blossom.wenneker.dev"}});
  assert.equal(publicMetadata.status,200);
});
test("ChatGPT OAuth consent, authorization code PKCE, read/write scope, rotated refresh",async t=>{
  const {base,store}=await withApp(t);
  const registration=await postJson(base,"/oauth/register",{redirect_uris:[callback],
    token_endpoint_auth_method:"none"});
  const client=(await registration.json()).client_id;
  const verifier="a".repeat(50);
  const challenge=createHash("sha256").update(verifier).digest("base64url");
  const args={response_type:"code",client_id:client,redirect_uri:callback,
    code_challenge:challenge,code_challenge_method:"S256",state:"statefromchatgpt123456",
    resource,scope:"blossom:read blossom:write offline_access"};
  const req=await fetch(base+"/oauth/authorize?"+new URLSearchParams(args));
  assert.equal(req.status,200);
  const html=await req.text();
  assert.match(html,/Blossom × ChatGPT/);
  const pending=html.match(/name="request" value="([^"]+)"/)?.[1];
  assert.ok(pending);
  const badPassword=await postForm(base,"/oauth/authorize",
    {request:pending,username:"admin",password:"incorrect",decision:"approve"});
  assert.equal(badPassword.status,401);
  const grant=await postForm(base,"/oauth/authorize",{request:pending,username:"admin",
    password:"very-long-local-blossom-password",decision:"approve"});
  assert.equal(grant.status,303);
  const redirect=new URL(grant.headers.get("location"));
  assert.equal(redirect.origin,"https://chatgpt.com");
  assert.equal(redirect.searchParams.get("iss"),origin);
  assert.equal(redirect.searchParams.get("state"),args.state);
  const code=redirect.searchParams.get("code");
  assert.ok(code);
  const wrong=await postForm(base,"/oauth/token",{grant_type:"authorization_code",
    client_id:client,redirect_uri:callback,code,code_verifier:"b".repeat(50),resource});
  assert.equal(wrong.status,400);
  const replay=await postForm(base,"/oauth/token",{grant_type:"authorization_code",
    client_id:client,redirect_uri:callback,code,code_verifier:verifier,resource});
  assert.equal(replay.status,400);
  // A fresh flow succeeds, proving the PKCE attempt invalidated only that code.
  const page2=await fetch(base+"/oauth/authorize?"+new URLSearchParams(args));
  const pending2=(await page2.text()).match(/name="request" value="([^"]+)"/)?.[1];
  const approved=await postForm(base,"/oauth/authorize",{request:pending2,username:"admin",
    password:"very-long-local-blossom-password",decision:"approve"});
  const code2=new URL(approved.headers.get("location")).searchParams.get("code");
  const exchanged=await postForm(base,"/oauth/token",{grant_type:"authorization_code",
    client_id:client,redirect_uri:callback,code:code2,code_verifier:verifier,resource});
  assert.equal(exchanged.status,200);
  const issued=await exchanged.json();
  assert.equal(issued.token_type,"Bearer");
  assert.ok(issued.refresh_token);
  assert.equal(issued.expires_in,3600);
  const rpc=async token=>postJson(base,"/mcp",{jsonrpc:"2.0",id:1,method:"tools/list"},
    {Authorization:"Bearer "+token});
  const tools=await (await rpc(issued.access_token)).json();
  assert.ok(tools.result.tools.some(t=>t.name==="studio_project_save_result"));
  assert.ok(tools.result.tools.some(t=>t.name==="music_dna_save_analysis"));
  assert.ok(!store.db.prepare("SELECT name FROM sqlite_master WHERE name='secret_keys'").get());
  const renewed=await postForm(base,"/oauth/token",{grant_type:"refresh_token",client_id:client,
    refresh_token:issued.refresh_token,resource});
  assert.equal(renewed.status,200);
  const fresh=await renewed.json();
  assert.notEqual(fresh.refresh_token,issued.refresh_token);
  const reused=await postForm(base,"/oauth/token",{grant_type:"refresh_token",client_id:client,
    refresh_token:issued.refresh_token,resource});
  assert.equal(reused.status,400);
});
test("OAuth denies invalid callbacks, absent PKCE and public admin paths",async t=>{
  const {base}=await withApp(t);
  const reg=await postJson(base,"/oauth/register",{redirect_uris:[callback]});
  const id=(await reg.json()).client_id;
  const opts=new URLSearchParams({response_type:"code",client_id:id,
    redirect_uri:callback,code_challenge:"a".repeat(43),
    code_challenge_method:"plain",state:"validlongstatehere",resource});
  const missing=await fetch(base+"/oauth/authorize?"+opts);
  assert.equal(missing.status,400);
  const external=await fetch(base+"/login",{headers:{Host:"blossom.wenneker.dev"}});
  assert.equal(external.status,404);
  const noEntry=await postForm(base,"/oauth/token",{grant_type:"client_credentials"});
  assert.equal(noEntry.status,400);
});
