import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";
import { diagnose,runChecks } from "../scripts/check-public-tunnel.mjs";

test("Public hostname serves only MCP gateway landing and status, not admin pages",async t=>{
  const store=new Store(":memory:");
  const server=createAppServer({store,provider:{available:()=>false},
    password:"long-test-secret-password",mcpOrigin:"https://blossom.wenneker.dev"});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
  const base="http://127.0.0.1:"+server.address().port;
  const req=(path,host="blossom.wenneker.dev")=>fetch(base+path,{
    headers:{"Host":host},redirect:"manual"
  });
  const home=await req("/");
  assert.equal(home.status,200);
  const html=await home.text();
  assert.match(html,/Blossom is bereikbaar/);
  assert.match(html,/MCP- en OAuth-gateway/);
  assert.doesNotMatch(html,/<input[^>]*password/i);
  const css=await req("/gateway.css");
  assert.equal(css.status,200);
  assert.match(css.headers.get("content-type"),/text\/css/);
  const health=await req("/healthz");
  assert.deepEqual(await health.json(),{status:"ok",service:"blossom-mcp"});
  assert.equal((await req("/login")).status,404);
  assert.equal((await req("/api/summary")).status,404);
  assert.equal((await req("/app.js")).status,404);
  assert.equal((await req("/api/studio/projects")).status,404);
  assert.equal((await req("/.well-known/oauth-authorization-server")).status,200);
  assert.equal((await req("/.well-known/oauth-protected-resource")).status,200);
  assert.equal((await req("/mcp")).status,405);
  const local=await req("/","127.0.0.1:8787");
  assert.equal(local.status,303);
  assert.equal(local.headers.get("location"),"/login");
  assert.equal((await req("/login","127.0.0.1:8787")).status,200);
});
test("Tunnel diagnostics distinguish local server, routing, DNS, Cloudflare, and connector",async()=>{
  let hints=diagnose({local:{ok:false},virtualHost:{ok:false},remote:{ok:false},
    dns:{ok:false},connector:{ok:false}});
  assert.ok(hints.some(x=>/server is not healthy/.test(x)));
  assert.ok(hints.some(x=>/DNS/.test(x)));
  assert.ok(hints.some(x=>/cloudflared/.test(x)));
  hints=diagnose({local:{ok:true},virtualHost:{ok:true},remote:{ok:false,status:502},
    dns:{ok:true},connector:{ok:true}});
  assert.ok(hints.some(x=>/Cloudflare cannot reach/.test(x)));
  hints=diagnose({local:{ok:true},virtualHost:{ok:true},remote:{ok:true,status:200},
    dns:{ok:true},connector:{ok:true}});
  assert.equal(hints.length,1);
  const calls=[];
  const result=await runChecks({
    checkLocalFn:async(path,host)=>{calls.push([path,host]);return {ok:true,status:200};},
    checkPublicFn:async()=>({ok:true,status:200}),
    dnsFn:async()=>({ok:true}),
    connectorFn:async()=>({ok:true})
  });
  assert.equal(result.remote.ok,true);
  assert.equal(result.oauth.ok,true);
  assert.equal(calls.length,2);
});
test("Public page never includes secret values or local admin JS",async()=>{
  const html=await readFile(new URL("../public/gateway.html",import.meta.url),"utf8");
  assert.match(html,/noindex,nofollow/);
  assert.match(html,/https:\/\/blossom.wenneker.dev\/mcp/);
  assert.doesNotMatch(html,/api\/studio|BLOSSOM_ADMIN_PASSWORD|BLOSSOM_MCP_WRITE_TOKEN/);
});
