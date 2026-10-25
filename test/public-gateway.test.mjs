import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { Store } from "../src/storage.mjs";
import { createAppServer } from "../src/server.mjs";
import { musicDnaMcpToolFingerprint, musicDnaMcpToolNames } from "../src/music-dna-mcp.mjs";
import { diagnose,runChecks } from "../scripts/check-public-tunnel.mjs";

test("Public hostname serves only MCP gateway landing and status, not admin pages",async t=>{
  const store=new Store(":memory:");
  const server=createAppServer({store,provider:{available:()=>false},
    password:"long-test-secret-password",mcpOrigin:"https://blossom.wenneker.dev"});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
  const base="http://127.0.0.1:"+server.address().port;
  // Node fetch does not reliably allow overriding the Host header.
  // Use node:http to exercise the real virtual-host security boundary.
  const req=(path,host="blossom.wenneker.dev")=>new Promise((resolve,reject)=>{
    const endpoint=new URL(base);
    const request=httpRequest({hostname:"127.0.0.1",port:Number(endpoint.port),
      path,method:"GET",headers:{Host:host}},response=>{
      const chunks=[];
      response.on("data",chunk=>chunks.push(chunk));
      response.on("end",()=>{
        const body=Buffer.concat(chunks).toString("utf8");
        resolve({status:response.statusCode,text:async()=>body,json:async()=>JSON.parse(body),
          headers:{get:name=>response.headers[name.toLowerCase()]}});
      });
    });
    request.on("error",reject);request.end();
  });
  const home=await req("/");
  assert.equal(home.status,200);
  const html=await home.text();
  assert.match(html,/Blossom is bereikbaar/);
  assert.match(html,/MCP- en OAuth-gateway/);
  assert.match(html,/rel="icon" href="\/blossom-mark\.svg" type="image\/svg\+xml"/);
  assert.doesNotMatch(html,/<input[^>]*password/i);
  const mark=await req("/blossom-mark.svg");
  assert.equal(mark.status,200);
  assert.match(mark.headers.get("content-type"),/image\/svg\+xml/);
  assert.match(await mark.text(),/<svg/);
  const css=await req("/gateway.css");
  assert.equal(css.status,200);
  assert.match(css.headers.get("content-type"),/text\/css/);
  const health=await req("/healthz");
  assert.deepEqual(await health.json(),{
    status:"ok",service:"blossom-mcp",
    mcp:{toolCount:musicDnaMcpToolNames().length,
      toolFingerprint:musicDnaMcpToolFingerprint,spotifyLikedSupported:true}
  });
  const spotifyCallback=await req("/callback");
  assert.equal(spotifyCallback.status,200);
  assert.match(await spotifyCallback.text(),/Spotify-callback is actief/);
  assert.equal(spotifyCallback.headers.get("cache-control"),"no-store, private");
  assert.equal((await req("/callback?code=invalid&state=invalid")).status,400);
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
  const localLogin=await req("/login","127.0.0.1:8787");
  assert.equal(localLogin.status,200);
  assert.match(await localLogin.text(),/rel="icon" href="\/blossom-mark\.svg" type="image\/svg\+xml"/);
  const localMark=await req("/blossom-mark.svg","127.0.0.1:8787");
  assert.equal(localMark.status,200);
  assert.match(localMark.headers.get("content-type"),/image\/svg\+xml/);
});
test("Browser tab uses the Blossom mark on every HTML page",async()=>{
  for(const name of ["index.html","login.html","gateway.html"]){
    const html=await readFile(new URL("../public/"+name,import.meta.url),"utf8");
    assert.match(html,/<link rel="icon" href="\/blossom-mark\.svg" type="image\/svg\+xml">/);
  }
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
