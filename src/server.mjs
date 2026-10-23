import { createServer } from "node:http";
import { Sessions, Vault, encodeCookie, expireCookie } from "./security.mjs";
import { SpotifyOAuth } from "./spotify.mjs";
import { GENRES } from "./genres.mjs";
import { StudioAPI } from "./studio-api.mjs";
import { MusicDNA } from "./music-dna.mjs";
import { MusicDnaAPI } from "./music-dna-api.mjs";
import { MusicDnaMCP } from "./music-dna-mcp.mjs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Store } from "./storage.mjs";
import { LabelGrid } from "./providers/labelgrid.mjs";
import { sunoBlueprint, ensureReleaseReady, DomainError, RELEASE_CHECKS } from "./domain.mjs";
import { checkTerms, enableMonitor, WATCH_URLS } from "./monitor.mjs";

const PUBLIC = {"/":"index.html","/app.js":"app.js","/styles.css":"styles.css",
 "/studio.js":"studio.js","/studio.css":"studio.css","/music-dna.js":"music-dna.js","/music-dna.css":"music-dna.css","/blossom-mark.svg":"blossom-mark.svg",
  "/login":"login.html","/login.js":"login.js","/login.css":"login.css"};
const MIME = {html:"text/html; charset=utf-8",js:"text/javascript; charset=utf-8",css:"text/css; charset=utf-8",svg:"image/svg+xml"};
function reply(res,code,data,headers={}) {
  res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers});
  res.end(JSON.stringify(data));
}
async function body(req) {
  if(!String(req.headers["content-type"]||"").startsWith("application/json"))
    throw new DomainError("Expected application/json",415);
  let total=0;const chunks=[];
  for await(const chunk of req) {
    total+=chunk.length;if(total>256_000)throw new DomainError("Payload too large",413);
    chunks.push(chunk);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch {throw new DomainError("Invalid JSON body");}
}
function required(store,id,type) {
  const value=type==="release"?store.release(id):type==="track"?store.track(id):store.artist(id);
  if(!value)throw new DomainError(type+" not found",404);return value;
}
function validateRemoteResponse(data) {
  if (data?.valid===false || data?.success===false || (Array.isArray(data?.errors) && data.errors.length>0))
    throw new DomainError("Distributor validation returned errors. Resolve them before approval.",409);
}
export function createAppServer({store,provider,password,username="admin",vaultKey=process.env.BLOSSOM_VAULT_KEY,
  publicUrl="http://127.0.0.1:8787",spotifyFetcher=fetch,allowLive=false,monitor=false,composer=null,draw=null,assetDir=process.env.BLOSSOM_ASSET_DIR||".data/assets"}={}) {
  if(!password || password.length<12) throw new Error("BLOSSOM_ADMIN_PASSWORD must contain at least 12 characters");
  if(!store || !provider)throw new Error("Store and provider required");
  const sessions=new Sessions(store.db,{username,password});
  const vault=new Vault(store.db,vaultKey);
  const spotify=new SpotifyOAuth({vault,sessions,baseUrl:publicUrl,fetcher:spotifyFetcher});
  const studioApi=new StudioAPI({store,vault,composer,draw,assetDir});
  const musicDna=new MusicDNA(store);
  const musicDnaApi=new MusicDnaAPI(musicDna);
  const musicDnaMcp=new MusicDnaMCP(musicDna);
  const secure=publicUrl.startsWith("https:");
  const permittedOrigin=new URL(publicUrl).origin;
  const timer=enableMonitor(store,{enabled:monitor});
  const server=createServer(async(req,res)=>{
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("X-Frame-Options","DENY");
    res.setHeader("Referrer-Policy","no-referrer");
    res.setHeader("Content-Security-Policy","default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    const parsedUrl=new URL(req.url||"/","http://localhost");
    const path=parsedUrl.pathname;
    if(path==="/healthz" && req.method==="GET")return reply(res,200,{status:"ok"});
    const sessionHash=sessions.session(req);
    if(req.method==="POST"&&req.headers.origin&&req.headers.origin!==permittedOrigin)
      return reply(res,403,{error:"Origin verification failed"});
    if(req.method==="POST"&&path!=="/mcp"&&req.headers["x-blossom-request"]!=="ui")
      return reply(res,403,{error:"Missing request protection header"});
    if(path==="/mcp")return musicDnaMcp.handle(req,res);
    try {
      if(path==="/auth/login"&&req.method==="POST"){
        const incoming=await body(req);
        const token=sessions.login(incoming?.username,incoming?.password,req.socket.remoteAddress||"unknown");
        return reply(res,200,{authenticated:true,username},{ "Set-Cookie":encodeCookie(token,secure)});
      }
      if(path==="/login"&&req.method==="GET"&&sessionHash){
        res.writeHead(303,{Location:"/","Cache-Control":"no-store"});res.end();return;
      }
      if(["/login","/login.js","/login.css","/styles.css","/blossom-mark.svg"].includes(path)&&req.method==="GET"){
        const name=PUBLIC[path],extension=name.split(".").pop(),content=await readFile(new URL("../public/"+name,import.meta.url));
        res.writeHead(200,{"Content-Type":MIME[extension],"Cache-Control":"no-store"});
        res.end(content);return;
      }
      if(!sessionHash) {
        if(path==="/"&&req.method==="GET"){res.writeHead(303,{Location:"/login","Cache-Control":"no-store"});res.end();return;}
        return reply(res,401,{error:"Authentication required"});
      }
      if(path==="/auth/logout"&&req.method==="POST"){
        sessions.logout(req);return reply(res,200,{authenticated:false},{"Set-Cookie":expireCookie(secure)});
      }
      if(path==="/auth/session"&&req.method==="GET")return reply(res,200,{authenticated:true,username});
      if(path==="/auth/spotify/start"&&req.method==="GET"){
        res.writeHead(303,{Location:spotify.start(sessionHash),"Cache-Control":"no-store"});res.end();return;
      }
      if(path==="/auth/spotify/callback"&&req.method==="GET"){
        if(parsedUrl.searchParams.has("error"))throw new DomainError("Spotify authorization was cancelled",400);
        await spotify.complete(sessionHash,parsedUrl.searchParams.get("state"),parsedUrl.searchParams.get("code"));
        res.writeHead(303,{Location:"/?spotify=connected","Cache-Control":"no-store"});res.end();return;
      }
      if(path in PUBLIC && req.method==="GET") {
        const name=PUBLIC[path],extension=name.split(".").pop();
        const content=await readFile(new URL("../public/"+name,import.meta.url));
        res.writeHead(200,{"Content-Type":MIME[extension],"Cache-Control":"no-store"});
        res.end(content);return;
      }
      if(!path.startsWith("/api/"))throw new DomainError("Not found",404);
      if(path.startsWith("/api/studio/")) {await studioApi.handle(req,res,path);return;}
      if(path.startsWith("/api/music-dna/")) {await musicDnaApi.handle(req,res,path,parsedUrl.searchParams);return;}
      const method=req.method;
      if(!["GET","POST"].includes(method))throw new DomainError("Method not allowed",405);
      if(method==="POST" && req.headers["x-blossom-request"]!=="ui")throw new DomainError("Missing request protection header",403);
      if(method==="GET") {
        if(path==="/api/summary")return reply(res,200,store.summary());
        if(path==="/api/artists")return reply(res,200,store.artists());
        if(path==="/api/tracks")return reply(res,200,store.tracks());
        if(path==="/api/releases")return reply(res,200,store.releases());
        if(path==="/api/events")return reply(res,200,store.events());
        if(path==="/api/watches")return reply(res,200,{sources:WATCH_URLS,records:store.watches()});
        if(path==="/api/integrations")return reply(res,200,{suno:"manual blueprint only",labelgrid:provider.available()?"token configured":"not configured",liveDistributionEnabled:allowLive,monitorEnabled:!!timer});
        if(path==="/api/genres")return reply(res,200,GENRES);
        if(path==="/api/connections")return reply(res,200,vault.list());
        if(path==="/api/connections/spotify/profile")return reply(res,200,await spotify.profile());
        let match=path.match(/^\/api\/tracks\/([a-z0-9-]+)\/blueprint$/i);
        if(match) {
          const t=required(store,match[1],"track");
          return reply(res,200,sunoBlueprint(required(store,t.artistId,"artist"),t));
        }
        match=path.match(/^\/api\/releases\/([a-z0-9-]+)\/delivery-status$/i);
        if(match) {
          const r=required(store,match[1],"release");
          if(r.status!=="submitted"&&r.status!=="needs_reconciliation")
            throw new DomainError("Release has not been submitted",409);
          return reply(res,200,await provider.deliveryStatus(r.externalReleaseId));
        }
        throw new DomainError("Not found",404);
      }
      const incoming=await body(req);
      if(path==="/api/artists")return reply(res,201,store.addArtist(incoming));
      if(path==="/api/tracks")return reply(res,201,store.addTrack(incoming));
      if(path==="/api/releases")return reply(res,201,store.addRelease(incoming));
      if(path==="/api/connections/suno"){
        if(incoming && Object.hasOwn(incoming,"password"))throw new DomainError("Use an official Suno API key, not a website password");
        if(incoming?.email!==undefined)vault.setSetting("suno_email",incoming.email);
        if(incoming?.apiKey)vault.save("suno_api_key",vault.getSetting("suno_email"),incoming.apiKey);
        store.audit("connection_updated","integration","suno",{hasKey:!!incoming?.apiKey});
        return reply(res,200,vault.list());
      }
      if(path==="/api/connections/spotify"){
        if(incoming && Object.hasOwn(incoming,"password"))throw new DomainError("Use Spotify OAuth, not a website password");
        vault.setSetting("spotify_client_id",incoming?.clientId);
        store.audit("connection_updated","integration","spotify",{oauthApp:true});
        return reply(res,200,vault.list());
      }
      if(path==="/api/connections/suno/remove"){
        vault.delete("suno_api_key");store.audit("connection_removed","integration","suno");
        return reply(res,200,vault.list());
      }
      if(path==="/api/connections/spotify/remove"){
        vault.delete("spotify_refresh_token");store.audit("connection_removed","integration","spotify");
        return reply(res,200,vault.list());
      }
      if(path==="/api/watches/check")return reply(res,200,await checkTerms(store));
      let match=path.match(/^\/api\/watches\/([a-z0-9-]+)\/ack$/i);
      if(match)return reply(res,200,store.acknowledgeWatch(match[1]));
      match=path.match(/^\/api\/tracks\/([a-z0-9-]+)\/advance$/i);
      if(match)return reply(res,200,store.progressTrack(match[1],incoming?.target,incoming?.rights,incoming?.audioRef));
      match=path.match(/^\/api\/releases\/([a-z0-9-]+)\/checks$/i);
      if(match)return reply(res,200,store.setChecks(match[1],incoming));
      match=path.match(/^\/api\/releases\/([a-z0-9-]+)\/(validate|approve|distribute)$/i);
      if(match) {
        const key=match[1],action=match[2],r=required(store,key,"release");
        ensureReleaseReady(r,required(store,r.trackId,"track"),store.holds());
        if(action==="validate") {
          if(r.status!=="draft")throw new DomainError("Release is not a draft",409);
          const response=await provider.validate(r.externalReleaseId);
          validateRemoteResponse(response);
          store.setReleaseStatus(key,"draft","validated");
          return reply(res,200,{release:store.release(key),providerResponse:response});
        }
        if(action==="approve") {
          if(r.status!=="validated")throw new DomainError("Validate with distributor first",409);
          return reply(res,200,store.setReleaseStatus(key,"validated","approved"));
        }
        if(r.status!=="approved")throw new DomainError("Release must be approved",409);
        if(!allowLive)throw new DomainError("Live distribution is disabled in server settings",403);
        if(incoming?.confirmation!=="PUBLISH")throw new DomainError("Explicit PUBLISH confirmation required",409);
        // Claim before network I/O so retries cannot accidentally double-submit.
        store.setReleaseStatus(key,"approved","submitting");
        try {
          const response=await provider.distribute(r.externalReleaseId);
          const next=store.setReleaseStatus(key,"submitting","submitted");
          return reply(res,200,{release:next,providerResponse:response});
        } catch(err) {
          store.setReleaseStatus(key,"submitting","needs_reconciliation",String(err).slice(0,250));
          throw new DomainError("Submission outcome unknown. Reconcile with LabelGrid before retrying. "+String(err.message||err),502);
        }
      }
      throw new DomainError("Not found",404);
    } catch(error) {
      const safe=error instanceof DomainError?error:new DomainError("Internal error",500);
      if(safe.status>=500)console.error("Blossom request failed:",error);
      return reply(res,safe.status||500,{error:safe.message});
    }
  });
  server.on("close",()=>{if(timer)clearInterval(timer);});
  return server;
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const password=process.env.BLOSSOM_ADMIN_PASSWORD;
  if(!password || password.length<12) {
    console.error("Set BLOSSOM_ADMIN_PASSWORD (12+ characters); see README.md");
    process.exit(1);
  }
  const host=process.env.BLOSSOM_HOST||"127.0.0.1";
  const port=Number(process.env.BLOSSOM_PORT||8787);
  const store=new Store(process.env.BLOSSOM_DB||".data/blossom.db");
  const provider=new LabelGrid();
  const app=createAppServer({store,provider,password,
    username:process.env.BLOSSOM_ADMIN_USERNAME||"admin",
    publicUrl:process.env.BLOSSOM_PUBLIC_URL||"http://127.0.0.1:"+port,
    allowLive:process.env.BLOSSOM_ALLOW_LIVE_DISTRIBUTION==="true",
    monitor:process.env.BLOSSOM_MONITOR_ENABLED==="true"});
  app.listen(port,host,()=>console.log("Blossom listening on http://"+host+":"+port+" (web login)"));
  const shutdown=()=>app.close(()=>{store.close();process.exit(0)});
  process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
}
