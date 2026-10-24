import { createServer } from "node:http";
import { Sessions, Vault, encodeCookie, expireCookie } from "./security.mjs";
import { SpotifyOAuth } from "./spotify.mjs";
import { SpotifyLikedImporter } from "./spotify-liked.mjs";
import { ConnectedBrowsers, providerBrowserUrl } from "./browser-connections.mjs";
import { openProviderInSafari, localMacBrowserRequest } from "./native-browser.mjs";
import { GENRES } from "./genres.mjs";
import { StudioAPI } from "./studio-api.mjs";
import { MusicDNA } from "./music-dna.mjs";
import { MusicDnaAPI } from "./music-dna-api.mjs";
import { MusicDnaMCP, musicDnaMcpToolFingerprint, musicDnaMcpToolNames } from "./music-dna-mcp.mjs";
import { CloudflareAccess } from "./cloudflare-access.mjs";
import { BlossomMcpOAuth } from "./mcp-oauth.mjs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Store } from "./storage.mjs";
import { LabelGrid } from "./providers/labelgrid.mjs";
import { sunoBlueprint, ensureReleaseReady, DomainError, RELEASE_CHECKS } from "./domain.mjs";
import { checkTerms, enableMonitor, WATCH_URLS } from "./monitor.mjs";

const PUBLIC = {"/":"index.html","/app.js":"app.js","/styles.css":"styles.css",
 "/studio.js":"studio.js","/studio.css":"studio.css","/music-dna.js":"music-dna.js","/music-dna.css":"music-dna.css","/viewport.css":"viewport.css","/blossom-mark.svg":"blossom-mark.svg",
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
function spotifyCallbackPage(res,status,title,description) {
  // Only fixed, server-authored text is ever rendered; never echo an OAuth
  // code, state, Spotify token, or user-provided URL into an HTML response.
  res.writeHead(status,{
    "Content-Type":"text/html; charset=utf-8",
    "Cache-Control":"no-store, private",
    "Referrer-Policy":"no-referrer",
    "X-Content-Type-Options":"nosniff",
    "X-Frame-Options":"DENY",
    "Content-Security-Policy":"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "X-Robots-Tag":"noindex, nofollow"
  });
  res.end('<!doctype html><html lang="nl"><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width, initial-scale=1">'+
    '<meta name="robots" content="noindex,nofollow"><title>'+title+'</title>'+
    '<h1>'+title+'</h1><p>'+description+'</p>'+
    '<p>Ga terug naar je lokale Blossom-app om verder te gaan.</p></html>');
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
  publicUrl="http://127.0.0.1:8787",spotifyFetcher=fetch,allowLive=false,monitor=false,composer=null,localComposer=null,articleImporter=undefined,draw=null,chatgptImages=null,sunoBrowser=null,chatgptLyrics=null,connectedBrowsers=null,nativeBrowserOptions={},mcpOrigin=process.env.BLOSSOM_MCP_PUBLIC_URL||"",publicUiEnabled=process.env.BLOSSOM_PUBLIC_UI_ENABLED==="true",cloudflareAccess=null,assetDir=process.env.BLOSSOM_ASSET_DIR||".data/assets"}={}) {
  if(!password || password.length<12) throw new Error("BLOSSOM_ADMIN_PASSWORD must contain at least 12 characters");
  if(!store || !provider)throw new Error("Store and provider required");
  const sessions=new Sessions(store.db,{username,password});
  const access=cloudflareAccess||new CloudflareAccess();
  if(publicUiEnabled && (!mcpOrigin || !access.configured()))
    throw Error("Public Studio requires BLOSSOM_MCP_PUBLIC_URL, BLOSSOM_CF_ACCESS_TEAM_DOMAIN and BLOSSOM_CF_ACCESS_AUD");
  const mcpOAuth=new BlossomMcpOAuth(store.db,{publicUrl:mcpOrigin,
    authenticate:(user,pass,ip)=>sessions.authenticate(user,pass,ip)});
  const vault=new Vault(store.db,vaultKey);
  const spotify=new SpotifyOAuth({vault,sessions,baseUrl:publicUrl,
    publicCallbackOrigin:mcpOAuth.origin,fetcher:spotifyFetcher});
  const browserAccounts=connectedBrowsers||new ConnectedBrowsers({suno:sunoBrowser||undefined});
  const studioApi=new StudioAPI({store,vault,composer,localComposer,...(articleImporter?{articleImporter}:{}),draw,chatgptImages,
    sunoBrowser:sunoBrowser||browserAccounts.suno,chatgptLyrics,nativeChatgptOptions:nativeBrowserOptions,assetDir});
  const musicDna=new MusicDNA(store);
  const spotifyLiked=new SpotifyLikedImporter(spotify,musicDna);
  const musicDnaApi=new MusicDnaAPI(musicDna,{spotifyLiked});
  const musicDnaMcp=new MusicDnaMCP(musicDna,{oauth:mcpOAuth,spotifyLiked});
  // Nonsecret live-process tool contract. /healthz must reveal which code is
  // ACTUALLY handling requests, not merely whether an old process is alive.
  const mcpHealth = { status:"ok", service:"blossom-mcp",
    mcp:{toolCount:musicDnaMcpToolNames().length,
      toolFingerprint:musicDnaMcpToolFingerprint,
      spotifyLikedSupported:musicDnaMcpToolNames().includes("spotify_liked_tracks") &&
        musicDnaMcpToolNames().includes("spotify_liked_import_page")} };
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
    const oauthPath=path.startsWith("/oauth/")||path.startsWith("/.well-known/oauth-");
    const publicHost=mcpOAuth.enabled()?new URL(mcpOAuth.origin).hostname:"";
    // Public Cloudflare host: a minimal landing/health page and authenticated
    // MCP/OAuth ONLY. Studio and administrator APIs must remain on loopback.
    const gatewayHost=!!publicHost&&
      String(req.headers.host||"").split(":")[0].toLowerCase()===publicHost;
    const spotifyPublicCallback = gatewayHost && path==="/callback";
    // Spotify's registered redirect URI must stay reachable without a
    // Cloudflare Access browser session. ONLY this path is exempted.
    if(gatewayHost && publicUiEnabled && path!=="/mcp" && !oauthPath &&
        path!=="/healthz" && !spotifyPublicCallback) {
      if(!await access.verifyRequest(req))
        return reply(res,403,{error:"Valid Cloudflare Access login required"});
    }
    if(gatewayHost && !publicUiEnabled){
      if(req.method==="GET"&&(path==="/"||path==="/gateway.css")){
        const file=path==="/gateway.css"?"gateway.css":"gateway.html";
        const content=await readFile(new URL("../public/"+file,import.meta.url));
        res.writeHead(200,{"Content-Type":path==="/gateway.css"?"text/css; charset=utf-8":
          "text/html; charset=utf-8","Cache-Control":"no-store"});
        res.end(content);return;
      }
      if(req.method==="GET"&&path==="/healthz")
        return reply(res,200,mcpHealth);
      if(path!=="/mcp"&&!oauthPath&&!spotifyPublicCallback)
        return reply(res,404,{error:"Not found"});
    }
    if(spotifyPublicCallback) {
      if(req.method!=="GET")return reply(res,405,{error:"Spotify callback requires GET"});
      if(!parsedUrl.searchParams.has("code")&&!parsedUrl.searchParams.has("error")) {
        return spotifyCallbackPage(res,200,"Spotify-callback is actief",
          "Start de Spotify-verbinding vanuit Blossom → Music DNA of Connections. Een bezoek aan deze URL op zichzelf koppelt geen account.");
      }
      if(parsedUrl.searchParams.has("error")) {
        return spotifyCallbackPage(res,400,"Spotify-toestemming niet verleend",
          "Spotify heeft de autorisatie geannuleerd of geweigerd. Start opnieuw vanuit Blossom.");
      }
      try {
        await spotify.completePublic(parsedUrl.searchParams.get("state"),
          parsedUrl.searchParams.get("code"));
        return spotifyCallbackPage(res,200,"Spotify verbonden",
          "Spotify heeft de toegang bevestigd. De koppeling is beveiligd opgeslagen in Blossom. Je kunt nu je gelikete nummers importeren.");
      } catch(error) {
        const expired=error instanceof DomainError && error.status===409;
        return spotifyCallbackPage(res,expired?409:400,"Spotify-koppeling niet voltooid",
          expired?"De aanvraag is verlopen, opnieuw gebruikt of je lokale Blossom-sessie is verlopen. Start opnieuw vanuit Blossom.":
          "Spotify kon de autorisatie niet afronden. Controleer de Client ID, de exacte Redirect URI en begin opnieuw vanuit Blossom.");
      }
    }
    if(oauthPath) {
      try {return await mcpOAuth.handle(req,res,path,parsedUrl);}
      catch(error){console.error("Blossom OAuth error:",error.message);
        return reply(res,500,{error:"OAuth request failed"});}
    }
    if(path==="/healthz" && req.method==="GET")return reply(res,200,mcpHealth);
    const sessionHash=sessions.session(req);
    const secureCookie=secure||(gatewayHost&&publicUiEnabled);
    const allowedOrigin=req.headers.origin===permittedOrigin ||
      (gatewayHost&&publicUiEnabled&&req.headers.origin===mcpOAuth.origin);
    if(req.method==="POST"&&req.headers.origin&&!allowedOrigin &&
        !(path==="/mcp"&&(req.headers.origin==="https://chatgpt.com"||
          req.headers.origin===mcpOAuth.origin)))
      return reply(res,403,{error:"Origin verification failed"});
    if(req.method==="POST"&&path!=="/mcp"&&req.headers["x-blossom-request"]!=="ui")
      return reply(res,403,{error:"Missing request protection header"});
    if(path==="/mcp")return musicDnaMcp.handle(req,res);
    try {
      if(path==="/auth/login"&&req.method==="POST"){
        const incoming=await body(req);
        const token=sessions.login(incoming?.username,incoming?.password,req.socket.remoteAddress||"unknown");
        return reply(res,200,{authenticated:true,username},{ "Set-Cookie":encodeCookie(token,secureCookie)});
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
        sessions.logout(req);return reply(res,200,{authenticated:false},{"Set-Cookie":expireCookie(secureCookie)});
      }
      if(path==="/auth/session"&&req.method==="GET")return reply(res,200,{authenticated:true,username});
      // Authenticated local admin only. Public MCP Host never exposes this URL.
      if(path==="/api/oauth/diagnostics"&&req.method==="GET")
        return reply(res,200,mcpOAuth.diagnostics(),{"Cache-Control":"no-store"});
      if(path==="/auth/spotify/start"&&req.method==="GET"){
        // Account selection remains on Spotify's own login page, where an existing
        // Facebook login method can be chosen. Never request Facebook credentials.
        const chooseAccount=parsedUrl.searchParams.get("choose")==="1";
        res.writeHead(303,{Location:spotify.start(sessionHash,{chooseAccount}),"Cache-Control":"no-store"});res.end();return;
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
      // Safari cookies are intentionally inaccessible. Persist only the
      // operator's handoff progress and explicit confirmation, never a login claim.
      const browserStatus=async()=>{
        const sessionsByProvider=await browserAccounts.status();
        return {...Object.fromEntries(["suno","spotify","chatgpt"].map(provider=>
          [provider,{...sessionsByProvider[provider],
            handoff:store.browserAccountStatus(provider),
            nextBrowserUrl:providerBrowserUrl(provider,{
              confirmed:store.browserAccountStatus(provider).state==="user_confirmed"})}])),
          nativeSafariAvailable:(nativeBrowserOptions.platform||process.platform)==="darwin"};
      };
      if(path==="/api/browser-accounts"&&req.method==="GET")
        return reply(res,200,await browserStatus());
      const browserConfirm=path.match(/^\/api\/browser-accounts\/(suno|spotify|chatgpt)\/(confirm|not-confirmed)$/);
      if(browserConfirm&&req.method==="POST"){
        store.setBrowserAccountStatus(browserConfirm[1],
          browserConfirm[2]==="confirm"?"confirmed":"not_confirmed");
        return reply(res,200,(await browserStatus())[browserConfirm[1]]);
      }
      const nativeSafariAction=path.match(/^\/api\/browser-accounts\/(suno|spotify|chatgpt)\/(open-safari|login-safari)$/);
      if(nativeSafariAction&&req.method==="POST"){
        if(!localMacBrowserRequest(req))
          throw new DomainError("Open Safari is available only from Blossom running locally on the same Mac",403);
        if(nativeSafariAction[2]==="login-safari"&&nativeSafariAction[1]!=="spotify")
          throw new DomainError("Dedicated login route only available for Spotify",404);
        const confirmed=store.browserAccountStatus(nativeSafariAction[1]).state==="user_confirmed";
        const forceLogin=nativeSafariAction[2]==="login-safari";
        const result=await openProviderInSafari(nativeSafariAction[1],{
          ...nativeBrowserOptions,confirmed,forceLogin});
        if(forceLogin)store.setBrowserAccountStatus(nativeSafariAction[1],"not_confirmed");
        store.setBrowserAccountStatus(nativeSafariAction[1],"opened");
        return reply(res,200,{...result,handoff:store.browserAccountStatus(nativeSafariAction[1])});
      }
      const browserAction=path.match(/^\/api\/browser-accounts\/(suno|spotify|chatgpt)\/(open|close)$/);
      if(browserAction&&req.method==="POST"){
        // All POSTs have already passed same-origin and request-header checks.
        const providerName=browserAction[1], action=browserAction[2];
        const result=action==="open"?await browserAccounts.open(providerName):
          await browserAccounts.close(providerName);
        if(action==="open")store.setBrowserAccountStatus(providerName,"opened");
        return reply(res,200,{...result,handoff:store.browserAccountStatus(providerName)});
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
        if(path==="/api/connections")return reply(res,200,{...vault.list(),spotifyRedirectUri:spotify.redirectUri});
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
      const payload={error:safe.message};
      if(typeof safe.code==="string"&&safe.code)payload.code=safe.code;
      return reply(res,safe.status||500,payload);
    }
  });
  server.on("close",()=>{if(timer)clearInterval(timer);Promise.resolve(browserAccounts.closeAll()).catch(()=>{});});
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
