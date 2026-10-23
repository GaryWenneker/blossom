import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
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
const requestWithHost=(base,path,host)=>new Promise((resolve,reject)=>{
  const endpoint=new URL(base);
  const req=httpRequest({hostname:"127.0.0.1",port:Number(endpoint.port),
    path,headers:{Host:host}},res=>{
      res.resume();res.on("end",()=>resolve(res.statusCode));
    });
  req.on("error",reject);req.end();
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
  assert.equal(await requestWithHost(base,"/api/studio/projects","blossom.wenneker.dev"),404);
  assert.equal(await requestWithHost(base,"/.well-known/oauth-authorization-server","blossom.wenneker.dev"),200);
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
  const duplicate=await postForm(base,"/oauth/authorize",{request:pending2,username:"admin",
    password:"very-long-local-blossom-password",decision:"approve"});
  assert.equal(duplicate.status,200);
  assert.match(await duplicate.text(),/Toestemming al verwerkt/);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM mcp_oauth_codes").get().count,1);
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
test("Expired OAuth consent requires a new request and cannot mint an authorization code",async t=>{
  const {base,store}=await withApp(t);
  const reg=await postJson(base,"/oauth/register",{redirect_uris:[callback]});
  const client=(await reg.json()).client_id;
  const verifier="c".repeat(50);
  const challenge=createHash("sha256").update(verifier).digest("base64url");
  const args={response_type:"code",client_id:client,redirect_uri:callback,
    code_challenge:challenge,code_challenge_method:"S256",state:"expired-state-1234",
    resource,scope:"blossom:read"};
  const consent=await fetch(base+"/oauth/authorize?"+new URLSearchParams(args));
  const nonce=(await consent.text()).match(/name="request" value="([^"]+)"/)?.[1];
  assert.ok(nonce);
  store.db.prepare("UPDATE mcp_oauth_pending SET expires_at=?").run(Date.now()-1);
  const expired=await postForm(base,"/oauth/authorize",{request:nonce,decision:"deny"});
  assert.equal(expired.status,410);
  assert.match(await expired.text(),/Toestemming verlopen/);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM mcp_oauth_codes").get().count,0);
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
  assert.equal(await requestWithHost(base,"/login","blossom.wenneker.dev"),404);
  const noEntry=await postForm(base,"/oauth/token",{grant_type:"client_credentials"});
  assert.equal(noEntry.status,400);
});


test("Consent redirect, ChatGPT code redemption, tool scan and permissions are diagnosable privately",async t=>{
  const {base}=await withApp(t);
  assert.equal((await fetch(base+"/api/oauth/diagnostics")).status,401);
  assert.equal(await requestWithHost(base,"/api/oauth/diagnostics","blossom.wenneker.dev"),404);
  const login=await fetch(base+"/auth/login",{
    method:"POST",headers:{"Content-Type":"application/json","X-Blossom-Request":"ui"},
    body:JSON.stringify({username:"admin",password:"very-long-local-blossom-password"})
  });
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const status=()=>fetch(base+"/api/oauth/diagnostics",{headers:{Cookie:cookie}}).then(r=>r.json());
  const initial=await status();
  assert.equal(initial.latestStage,"none");
  const unauth=await postJson(base,"/mcp",{jsonrpc:"2.0",id:7,method:"initialize"});
  assert.match(unauth.headers.get("www-authenticate"),/blossom:write/);
  const registered=await postJson(base,"/oauth/register",{redirect_uris:[callback]});
  const {client_id}=await registered.json();
  const verifier="x".repeat(50);
  const params=new URLSearchParams({
    response_type:"code",client_id,redirect_uri:callback,
    code_challenge:createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method:"S256",state:"valid-client-state-78910",
    resource,scope:"blossom:read blossom:write offline_access"
  });
  const consent=await fetch(base+"/oauth/authorize?"+params);
  const nonce=(await consent.text()).match(/name="request" value="([^"]+)"/)?.[1];
  assert.ok(nonce);
  assert.equal((await status()).latestStage,"consent_shown");
  const grant=await postForm(base,"/oauth/authorize",
    {request:nonce,decision:"approve",username:"admin",
      password:"very-long-local-blossom-password"});
  assert.equal(grant.status,303);
  let diagnostic=await status();
  assert.equal(diagnostic.latestStage,"consent_redirected");
  assert.equal(diagnostic.activeTokenCount,0);
  const authUrl=new URL(grant.headers.get("location"));
  assert.equal(authUrl.searchParams.get("iss"),origin);
  const repeated=await postForm(base,"/oauth/authorize",
    {request:nonce,decision:"approve",username:"admin",
      password:"very-long-local-blossom-password"});
  assert.equal(repeated.status,200);
  assert.match(await repeated.text(),/Create as a plugin/);
  const redeemed=await postForm(base,"/oauth/token",{
    grant_type:"authorization_code",client_id,
    redirect_uri:callback,code:authUrl.searchParams.get("code"),
    code_verifier:verifier,resource
  });
  assert.equal(redeemed.status,200);
  const tokens=await redeemed.json();
  diagnostic=await status();
  assert.equal(diagnostic.latestStage,"token_issued");
  assert.equal(diagnostic.activeTokenCount,1);
  assert.equal(diagnostic.events.find(e=>e.stage==="token_issued").scope,
    "blossom:read blossom:write offline_access");
  assert.ok(!JSON.stringify(diagnostic).includes(tokens.access_token));
  assert.ok(!JSON.stringify(diagnostic).includes(tokens.refresh_token));
  assert.ok(!JSON.stringify(diagnostic).includes(authUrl.searchParams.get("code")));
  const scan=await postJson(base,"/mcp",{jsonrpc:"2.0",id:2,method:"tools/list"},
    {Authorization:"Bearer "+tokens.access_token});
  assert.equal(scan.status,200);
  assert.equal((await status()).latestStage,"tools_listed");
});


test("Explicit denial stays denied on repeat; primary approval remains available",async t=>{
  const {base,store}=await withApp(t);
  const registered=await postJson(base,"/oauth/register",{redirect_uris:[callback]});
  const client=(await registered.json()).client_id;
  const verifier="d".repeat(50);
  const qs=new URLSearchParams({
    response_type:"code",client_id:client,redirect_uri:callback,
    code_challenge:createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method:"S256",state:"consent-outcome-test-123456",
    scope:"blossom:read blossom:write offline_access",resource
  });
  const response=await fetch(base+"/oauth/authorize?"+qs);
  assert.equal(response.status,200);
  const form=await response.text();
  assert.match(form,/name="decision" value="approve"/);
  assert.match(form,/name="decision" value="deny"/);
  assert.match(form,/Weigering bevestigen/);
  const nonce=form.match(/name="request" value="([^"]+)"/)?.[1];
  assert.ok(nonce);
  const denied=await postForm(base,"/oauth/authorize",
    {request:nonce,decision:"deny"});
  assert.equal(denied.status,303);
  const target=new URL(denied.headers.get("location"));
  assert.equal(target.searchParams.get("error"),"access_denied");
  assert.equal(target.searchParams.get("code"),null);
  const repeated=await postForm(base,"/oauth/authorize",
    {request:nonce,decision:"approve",username:"admin",
      password:"very-long-local-blossom-password"});
  assert.equal(repeated.status,200);
  const info=await repeated.text();
  assert.match(info,/Toestemming geweigerd/);
  assert.doesNotMatch(info,/Toestemming al verwerkt/);
  assert.equal(store.db.prepare("SELECT decision FROM mcp_oauth_completed").get().decision,"deny");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM mcp_oauth_codes").get().count,0);
  const second=await fetch(base+"/oauth/authorize?"+qs);
  const fresh=(await second.text()).match(/name="request" value="([^"]+)"/)?.[1];
  const approved=await postForm(base,"/oauth/authorize",{request:fresh,decision:"approve",
    username:"admin",password:"very-long-local-blossom-password"});
  assert.equal(approved.status,303);
  assert.ok(new URL(approved.headers.get("location")).searchParams.get("code"));
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM mcp_oauth_codes").get().count,1);
  assert.deepEqual(store.db.prepare("SELECT decision FROM mcp_oauth_completed ORDER BY rowid").all()
    .map(x=>x.decision),["deny","approve"]);
});
