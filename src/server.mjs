import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Store } from "./storage.mjs";
import { LabelGrid } from "./providers/labelgrid.mjs";
import { sunoBlueprint, ensureReleaseReady, DomainError, RELEASE_CHECKS } from "./domain.mjs";
import { checkTerms, enableMonitor, WATCH_URLS } from "./monitor.mjs";

const sha = s => createHash("sha256").update(s).digest();
const secureEquals = (a,b) => timingSafeEqual(sha(a),sha(b));
const PUBLIC = {"/":"index.html","/app.js":"app.js","/styles.css":"styles.css"};
const MIME = {html:"text/html; charset=utf-8",js:"text/javascript; charset=utf-8",css:"text/css; charset=utf-8"};
function authorized(req,password) {
  const auth=req.headers.authorization||"";
  if(!auth.startsWith("Basic "))return false;
  try {
    const pair=Buffer.from(auth.slice(6),"base64").toString("utf8");
    const split=pair.indexOf(":");
    return split>0&&secureEquals(pair.slice(0,split),"admin")&&secureEquals(pair.slice(split+1),password);
  } catch {return false;}
}
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
export function createAppServer({store,provider,password,allowLive=false,monitor=false}={}) {
  if(!password || password.length<12) throw new Error("BLOSSOM_ADMIN_PASSWORD must contain at least 12 characters");
  if(!store || !provider)throw new Error("Store and provider required");
  const timer=enableMonitor(store,{enabled:monitor});
  const server=createServer(async(req,res)=>{
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("X-Frame-Options","DENY");
    res.setHeader("Referrer-Policy","no-referrer");
    res.setHeader("Content-Security-Policy","default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    const path=new URL(req.url||"/","http://localhost").pathname;
    if(path==="/healthz" && req.method==="GET")return reply(res,200,{status:"ok"});
    if(!authorized(req,password))return reply(res,401,{error:"Authentication required"},{"WWW-Authenticate":'Basic realm="Blossom", charset="UTF-8"'});
    try {
      if(path in PUBLIC && req.method==="GET") {
        const name=PUBLIC[path],extension=name.split(".").pop();
        const content=await readFile(new URL("../public/"+name,import.meta.url));
        res.writeHead(200,{"Content-Type":MIME[extension],"Cache-Control":"no-store"});
        res.end(content);return;
      }
      if(!path.startsWith("/api/"))throw new DomainError("Not found",404);
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
    allowLive:process.env.BLOSSOM_ALLOW_LIVE_DISTRIBUTION==="true",
    monitor:process.env.BLOSSOM_MONITOR_ENABLED==="true"});
  app.listen(port,host,()=>console.log("Blossom listening on http://"+host+":"+port+" (user: admin)"));
  const shutdown=()=>app.close(()=>{store.close();process.exit(0)});
  process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
}
