import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Store } from "../src/storage.mjs";
import { SpotifyOAuth } from "../src/spotify.mjs";
import { SpotifyLikedImporter, spotifyLikedReference } from "../src/spotify-liked.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { Sessions, Vault } from "../src/security.mjs";
import { createAppServer } from "../src/server.mjs";

const vaultKey=Buffer.alloc(32,19).toString("base64");
const spotifyId=id=>String(id).padStart(22,"0");
const sampleTrack=(id,name,artist="Artist",year="1985")=>({
  added_at:"2026-10-20T12:34:56Z",
  track:{id:spotifyId(id),name,artists:[{name:artist}],
    album:{name:"Test Album",release_date:year+"-01-01"},
    external_ids:{isrc:"NLAAA2600001"}}
});
function spotifyBackend(pages, {httpStatus=null}={}) {
  const calls=[];
  const fetcher=async (url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url)==="https://accounts.spotify.com/api/token")return {
      ok:true,json:async()=>({access_token:"token-secret",refresh_token:"rotated-token"})};
    if(String(url).startsWith("https://api.spotify.com/v1/me/tracks?")) {
      const u=new URL(url);
      const offset=Number(u.searchParams.get("offset")),limit=Number(u.searchParams.get("limit"));
      assert.ok(limit<=50);
      assert.equal(options.headers.Authorization,"Bearer token-secret");
      if(httpStatus)return {ok:false,status:httpStatus,headers:{get:()=>String(7)}};
      const items=pages.slice(offset,offset+limit);
      return {ok:true,json:async()=>({
        items,total:pages.length,offset,limit,next:offset+items.length<pages.length
          ?"https://api.spotify.com/v1/me/tracks?offset="+(offset+items.length):null
      })};
    }
    if(String(url)==="https://api.spotify.com/v1/me")return {
      ok:true,json:async()=>({id:"spotify-tester",display_name:"Private Spotify user"})};
    throw Error("Unexpected Spotify endpoint "+url);
  };
  return {fetcher,calls};
}

test("Spotify read consent uses user-library-read scope and never library-modify",()=>{
  const store=new Store(":memory:");
  try {
    const vault=new Vault(store.db,vaultKey);
    vault.setSetting("spotify_client_id","a".repeat(32));
    const sessions=new Sessions(store.db,{password:"test-secret-password"});
    const token=sessions.login("admin","test-secret-password");
    const sessionHash=sessions.session({headers:{cookie:"blossom_session="+token}});
    const oauth=new SpotifyOAuth({vault,sessions});
    const url=new URL(oauth.start(sessionHash,{chooseAccount:true}));
    assert.equal(url.searchParams.get("scope"),"user-read-private user-library-read");
    assert.equal(url.searchParams.get("show_dialog"),"true");
    assert.equal(url.searchParams.get("code_challenge_method"),"S256");
    assert.ok(!url.searchParams.get("scope").includes("user-library-modify"));
  }finally{store.close();}
});

test("Spotify Liked Songs maps safe stable track URLs; refuses local/non-track items",()=>{
  const valid=spotifyLikedReference(sampleTrack(123,"Song","Some Artist","1978"));
  assert.equal(valid.artist,"Some Artist");
  assert.equal(valid.title,"Song");
  assert.equal(valid.releaseYear,1978);
  assert.equal(valid.sourceKind,"metadata");
  assert.equal(valid.sourceUrl,"https://open.spotify.com/track/"+spotifyId(123));
  assert.match(valid.sourceNote,/Imported from Spotify Liked Songs; metadata only/);
  assert.equal(spotifyLikedReference({track:{id:"invalid",name:"Invalid",artists:[{name:"A"}]}}),null);
  assert.equal(spotifyLikedReference({track:{...sampleTrack(45,"Local").track,is_local:true}}),null);
  assert.equal(spotifyLikedReference({track:null}),null);
  assert.equal(spotifyLikedReference(sampleTrack(12,"Song","Artist","0000")).releaseYear,undefined);
});

test("Pagination imports every saved track, skips local entries, deduplicates and does not claim audio analysis",async()=>{
  const store=new Store(":memory:");
  try {
    const vault=new Vault(store.db,vaultKey),sessions=new Sessions(store.db,{password:"test-secret-password"});
    vault.setSetting("spotify_client_id","a".repeat(32));
    vault.save("spotify_refresh_token","My account","refresh-secret");
    const local=sampleTrack(90,"Local");local.track.is_local=true;
    const pages=[
      sampleTrack(1,"First","Singer One"),
      sampleTrack(2,"Second","Singer Two"),
      local,
      sampleTrack(3,"Third","Singer Three"),
      sampleTrack(4,"Fourth","Singer Four")
    ];
    const backend=spotifyBackend(pages);
    const spotify=new SpotifyOAuth({vault,sessions,fetcher:backend.fetcher});
    const dna=new MusicDNA(store),liked=new SpotifyLikedImporter(spotify,dna);
    const first=await liked.importPage({offset:0,limit:2});
    assert.equal(first.total,5);
    assert.equal(first.received,2);
    assert.equal(first.imported,2);
    assert.equal(first.queued,2);
    assert.equal(first.nextOffset,2);
    const second=await liked.importPage({offset:first.nextOffset,limit:2});
    assert.equal(second.skipped,1);
    assert.equal(second.imported,1);
    assert.equal(second.nextOffset,4);
    const third=await liked.importPage({offset:second.nextOffset,limit:2});
    assert.equal(third.imported,1);
    assert.equal(third.nextOffset,null);
    assert.equal(dna.jobs("queued").length,4);
    const old=await liked.importPage({offset:0,limit:2});
    assert.equal(old.imported,0);
    assert.equal(old.duplicates,2);
    const found=dna.search({q:"Singer One"});
    assert.equal(found.length,1);
    assert.equal(found[0].analysisVersion,0);
    assert.equal(found[0].analysis,null);
    assert.ok(backend.calls.every(c=>c.url.startsWith("https://accounts.spotify.com/")||
      c.url.startsWith("https://api.spotify.com/v1/me/tracks?")));
  }finally{store.close();}
});

test("Unconnected/insufficient-scope Spotify APIs fail without creating imaginary Music DNA",async()=>{
  const store=new Store(":memory:");
  try {
    const vault=new Vault(store.db,vaultKey),sessions=new Sessions(store.db,{password:"test-secret-password"});
    vault.setSetting("spotify_client_id","a".repeat(32));
    const dna=new MusicDNA(store);
    const liked=new SpotifyLikedImporter(new SpotifyOAuth({vault,sessions}),dna);
    await assert.rejects(liked.importPage({offset:0}),/Spotify API is not connected/);
    vault.save("spotify_refresh_token","My account","refresh");
    const backend=spotifyBackend([sampleTrack(1,"Example")],{httpStatus:403});
    const denied=new SpotifyLikedImporter(new SpotifyOAuth({vault,sessions,fetcher:backend.fetcher}),dna);
    await assert.rejects(denied.importPage({offset:0}),/user-library-read/);
    assert.equal(dna.jobs().length,0);
    await assert.rejects(denied.importPage({offset:-1}),/offset/);
  }finally{store.close();}
});

test("Authenticated REST and scoped MCP import Spotify likes as metadata only",async t=>{
  const store=new Store(":memory:"),vault=new Vault(store.db,vaultKey);
  vault.setSetting("spotify_client_id","a".repeat(32));
  vault.save("spotify_refresh_token","Test","refresh");
  const backend=spotifyBackend([sampleTrack(71,"Liked Song","Singer")]);
  const previousRead=process.env.BLOSSOM_MCP_READ_TOKEN;
  const previousWrite=process.env.BLOSSOM_MCP_WRITE_TOKEN;
  process.env.BLOSSOM_MCP_READ_TOKEN="spotify-liked-read-token-longer-than-32-characters";
  process.env.BLOSSOM_MCP_WRITE_TOKEN="spotify-liked-write-token-longer-than-32-characters";
  const server=createAppServer({store,vaultKey,spotifyFetcher:backend.fetcher,
    provider:{available:()=>false},password:"very-secure-blossom-password"});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));store.close();
    if(previousRead===undefined)delete process.env.BLOSSOM_MCP_READ_TOKEN;
    else process.env.BLOSSOM_MCP_READ_TOKEN=previousRead;
    if(previousWrite===undefined)delete process.env.BLOSSOM_MCP_WRITE_TOKEN;
    else process.env.BLOSSOM_MCP_WRITE_TOKEN=previousWrite;
  });
  const base="http://127.0.0.1:"+server.address().port;
  const request=async(method,path,{cookie,body}={})=>fetch(base+path,{
    method,headers:{
      ...(cookie?{cookie}:{}),
      ...(body!==undefined?{"content-type":"application/json","x-blossom-request":"ui"}:{})
    },...(body!==undefined?{body:JSON.stringify(body)}:{})
  });
  assert.equal((await request("GET","/api/music-dna/spotify-liked/page")).status,401);
  const login=await request("POST","/auth/login",{body:{username:"admin",password:"very-secure-blossom-password"}});
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const preview=await request("GET","/api/music-dna/spotify-liked/page?offset=0&limit=50",{cookie});
  assert.equal(preview.status,200);
  assert.equal((await preview.json()).tracks[0].title,"Liked Song");
  const readToken=process.env.BLOSSOM_MCP_READ_TOKEN,writeToken=process.env.BLOSSOM_MCP_WRITE_TOKEN;
  const rpc=async(token,name,args={})=>fetch(base+"/mcp",{
    method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},
    body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}})
  });
  const readonly=(await rpc(readToken,"spotify_liked_import_page")).status;
  assert.equal(readonly,200);
  const readResult=await (await rpc(readToken,"spotify_liked_tracks",{offset:0,limit:50})).json();
  assert.equal(JSON.parse(readResult.result.content[0].text).received,1);
  const imported=await (await rpc(writeToken,"spotify_liked_import_page",{offset:0,limit:50})).json();
  assert.equal(JSON.parse(imported.result.content[0].text).imported,1);
  const fromRest=await request("POST","/api/music-dna/spotify-liked/import",{cookie,body:{offset:0,limit:50}});
  assert.equal(fromRest.status,200);
  const duplicate=await fromRest.json();
  assert.equal(duplicate.duplicates,1);
  assert.equal(duplicate.imported,0);
  const search=await request("GET","/api/music-dna/search?q=Liked%20Song",{cookie});
  const result=await search.json();
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].analysisVersion,0);
  assert.equal(result.results[0].analysis,null);
});
