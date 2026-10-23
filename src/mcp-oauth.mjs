import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { DomainError } from "./domain.mjs";

const random = () => randomBytes(32).toString("base64url");
const hash = s => createHash("sha256").update(s).digest("hex");
const safe = (a,b) => typeof a==="string" && typeof b==="string" &&
  timingSafeEqual(Buffer.from(hash(a),"hex"),Buffer.from(hash(b),"hex"));
const SCOPES = ["blossom:read","blossom:write","offline_access"];
const ACCESS_MS = 60*60*1000, REFRESH_MS = 30*24*60*60*1000, CODE_MS = 5*60*1000;
const formHeaders = { "Cache-Control":"no-store","Pragma":"no-cache","X-Content-Type-Options":"nosniff" };
const esc = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&#39;"}[c]));
function json(res,code,data,headers={}) {
  res.writeHead(code,{...formHeaders,"Content-Type":"application/json; charset=utf-8",...headers});
  res.end(JSON.stringify(data));
}
function html(res,code,body) {
  res.writeHead(code,{...formHeaders,"Content-Type":"text/html; charset=utf-8",
    "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy":"no-referrer","X-Frame-Options":"DENY"});
  res.end(body);
}
function oauthError(res,code,error,description) {
  return json(res,code,{error,error_description:description});
}
function validRedirect(value) {
  if(typeof value!=="string" || value.length>500)return false;
  try {
    const u=new URL(value);
    return u.origin==="https://chatgpt.com" && !u.search && !u.hash &&
      (u.pathname==="/connector_platform_oauth_redirect" ||
       /^\/connector\/oauth\/[A-Za-z0-9_-]{8,120}$/.test(u.pathname));
  } catch {return false;}
}
async function readBody(req,type,max=12000) {
  if(!String(req.headers["content-type"]||"").startsWith(type))
    throw new DomainError("Unexpected content type",415);
  const chunks=[];let len=0;
  for await(const chunk of req) {
    len+=chunk.length;
    if(len>max)throw new DomainError("OAuth payload too large",413);
    chunks.push(chunk);
  }
  const text=Buffer.concat(chunks).toString("utf8");
  if(type==="application/json") {
    try {return JSON.parse(text);} catch {throw new DomainError("Invalid JSON",400);}
  }
  return Object.fromEntries(new URLSearchParams(text));
}
export function mcpPublicUrl(input) {
  if(!input)return null;
  let u;
  try {u=new URL(input);}catch{throw new Error("Invalid BLOSSOM_MCP_PUBLIC_URL");}
  if(u.protocol!=="https:" || u.username || u.password || u.search || u.hash ||
      u.pathname!=="/" || u.port || !/^[a-z0-9.-]+$/i.test(u.hostname))
    throw new Error("BLOSSOM_MCP_PUBLIC_URL must be a public HTTPS origin");
  return u.origin;
}
export class BlossomMcpOAuth {
  constructor(db,{publicUrl,authenticate}={}) {
    this.db=db;
    this.origin=mcpPublicUrl(publicUrl);
    this.resource=this.origin ? this.origin+"/mcp":null;
    this.authenticate=authenticate;
    this.registrationAttempts=new Map();
    db.exec("CREATE TABLE IF NOT EXISTS mcp_oauth_clients ("+
      "id TEXT PRIMARY KEY, redirects TEXT NOT NULL, created_at INTEGER NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS mcp_oauth_pending ("+
      "hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,"+
      "challenge TEXT NOT NULL, state TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL,"+
      "expires_at INTEGER NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS mcp_oauth_codes ("+
      "hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,"+
      "challenge TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS mcp_oauth_tokens ("+
      "hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, scope TEXT NOT NULL,"+
      "resource TEXT NOT NULL, expires_at INTEGER NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS mcp_oauth_refresh ("+
      "hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, scope TEXT NOT NULL,"+
      "resource TEXT NOT NULL, expires_at INTEGER NOT NULL);");
  }
  enabled() {return !!this.origin;}
  protectedResourceMetadata() {
    return { resource:this.resource, authorization_servers:[this.origin],
      scopes_supported:SCOPES,bearer_methods_supported:["header"] };
  }
  serverMetadata() {
    return { issuer:this.origin,
      authorization_endpoint:this.origin+"/oauth/authorize",
      token_endpoint:this.origin+"/oauth/token",
      registration_endpoint:this.origin+"/oauth/register",
      authorization_response_iss_parameter_supported:true,
      response_types_supported:["code"],
      grant_types_supported:["authorization_code","refresh_token"],
      code_challenge_methods_supported:["S256"],
      token_endpoint_auth_methods_supported:["none"],
      scopes_supported:SCOPES };
  }
  challengeHeaders() {
    return {"WWW-Authenticate":'Bearer resource_metadata="'+this.origin+
      '/.well-known/oauth-protected-resource", scope="blossom:read"'};
  }
  resolveResource(value) {
    // Accept both the public origin and the canonical endpoint as requested by MCP hosts.
    return value===this.resource || value===this.origin ? this.resource:null;
  }
  scope(value) {
    const names=typeof value==="string"&&value.trim()?value.trim().split(/\s+/):SCOPES;
    if(names.some(s=>!SCOPES.includes(s)) || (!names.includes("blossom:read")&&!names.includes("blossom:write")))
      return null;
    return [...new Set(names)].join(" ");
  }
  client(id,redirect) {
    if(typeof id!=="string" || id.length>160)return false;
    const row=this.db.prepare("SELECT redirects FROM mcp_oauth_clients WHERE id=?").get(id);
    return !!row && JSON.parse(row.redirects).includes(redirect);
  }
  cleanup() {
    const now=Date.now();
    for(const table of ["mcp_oauth_pending","mcp_oauth_codes","mcp_oauth_tokens","mcp_oauth_refresh"])
      this.db.prepare("DELETE FROM "+table+" WHERE expires_at < ?").run(now);
  }
  verify(req) {
    if(!this.enabled())return null;
    const auth=String(req.headers.authorization||"");
    if(!auth.startsWith("Bearer ")||auth.length>1024)return null;
    const token=auth.slice(7);
    if(!/^[A-Za-z0-9_-]{32,128}$/.test(token))return null;
    const row=this.db.prepare("SELECT * FROM mcp_oauth_tokens WHERE hash=?").get(hash(token));
    if(!row||row.expires_at<=Date.now()||row.resource!==this.resource)return null;
    const names=row.scope.split(" ");
    return {read:names.includes("blossom:read")||names.includes("blossom:write"),
      write:names.includes("blossom:write")};
  }
  async handle(req,res,path,url) {
    if(!this.enabled())return json(res,404,{error:"OAuth is disabled. Set BLOSSOM_MCP_PUBLIC_URL."});
    if(req.method==="GET" && (path==="/.well-known/oauth-protected-resource" ||
        path==="/.well-known/oauth-protected-resource/mcp"))
      return json(res,200,this.protectedResourceMetadata());
    if(req.method==="GET" && path==="/.well-known/oauth-authorization-server")
      return json(res,200,this.serverMetadata());
    if(path==="/oauth/register"&&req.method==="POST")return this.register(req,res);
    if(path==="/oauth/authorize"&&req.method==="GET")return this.authorizePage(req,res,url);
    if(path==="/oauth/authorize"&&req.method==="POST")return this.authorizeDecision(req,res);
    if(path==="/oauth/token"&&req.method==="POST")return this.token(req,res);
    return json(res,404,{error:"Unknown OAuth endpoint"});
  }
  async register(req,res) {
    let input;
    try {input=await readBody(req,"application/json",8000);}
    catch(e){return oauthError(res,e.status||400,"invalid_client_metadata",e.message);}
    const redirects=input?.redirect_uris;
    if(!Array.isArray(redirects)||!redirects.length||redirects.length>4 ||
      !redirects.every(validRedirect) || input?.token_endpoint_auth_method && input.token_endpoint_auth_method!=="none" ||
      input?.grant_types && (!Array.isArray(input.grant_types)||!input.grant_types.includes("authorization_code")) ||
      input?.response_types && (!Array.isArray(input.response_types)||!input.response_types.includes("code")))
      return oauthError(res,400,"invalid_client_metadata","Only ChatGPT OAuth callbacks and public PKCE clients are supported");
    const ip=req.socket.remoteAddress||"unknown",now=Date.now();
    const attempts=this.registrationAttempts.get(ip)||{count:0,expires:now+60*60*1000};
    if(now>attempts.expires){attempts.count=0;attempts.expires=now+60*60*1000;}
    if(++attempts.count>30)return oauthError(res,429,"invalid_client_metadata","Registration limit reached");
    this.registrationAttempts.set(ip,attempts);
    const clientId="blossom_"+random();
    this.db.prepare("INSERT INTO mcp_oauth_clients VALUES (?,?,?)")
      .run(clientId,JSON.stringify([...new Set(redirects)]),now);
    return json(res,201,{client_id:clientId,client_id_issued_at:Math.floor(now/1000),
      redirect_uris:redirects,client_name:"ChatGPT · Blossom",
      grant_types:["authorization_code","refresh_token"],response_types:["code"],
      token_endpoint_auth_method:"none"});
  }
  validateAuthorize(q) {
    const clientId=q.get("client_id"),redirect=q.get("redirect_uri");
    const challenge=q.get("code_challenge"),state=q.get("state")||"";
    const resource=this.resolveResource(q.get("resource"));
    const scope=this.scope(q.get("scope")||"");
    if(q.get("response_type")!=="code" || !this.client(clientId,redirect) ||
      q.get("code_challenge_method")!=="S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge||"") ||
      state.length<8||state.length>1024 || !resource || !scope)
      return null;
    return {clientId,redirect,challenge,state,resource,scope};
  }
  authorizePage(_req,res,url) {
    const q=this.validateAuthorize(url.searchParams);
    if(!q)return html(res,400,"<h1>Ongeldige autorisatieaanvraag</h1><p>Controleer de ChatGPT MCP-verbinding.</p>");
    this.cleanup();
    const nonce=random();
    this.db.prepare("INSERT INTO mcp_oauth_pending VALUES (?,?,?,?,?,?,?,?)")
      .run(hash(nonce),q.clientId,q.redirect,q.challenge,q.state,q.scope,q.resource,Date.now()+10*60*1000);
    return html(res,200,'<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+
      '<title>Blossom koppelen aan ChatGPT</title><body style="max-width:520px;margin:6vh auto;padding:24px;font:16px system-ui;background:#101315;color:#fff">'+
      '<h1 style="color:#9aff63">Blossom × ChatGPT</h1><p>Je geeft ChatGPT toegang tot de Blossom Music DNA-database en Studio-projecten.</p>'+
      '<p><b>Toestemming:</b> '+esc(q.scope.includes("blossom:write")?"Lezen en wijzigen":"Alleen lezen")+
      '. Deze koppeling verleent geen toegang tot je ChatGPT-wachtwoord.</p>'+
      '<form method="POST" action="/oauth/authorize"><input type="hidden" name="request" value="'+esc(nonce)+'">'+
      '<label>Blossom-gebruikersnaam<br><input name="username" required autocomplete="username" style="width:100%;padding:10px"></label><p>'+
      '<label>Blossom-wachtwoord<br><input name="password" type="password" required autocomplete="current-password" style="width:100%;padding:10px"></label></p>'+
      '<button type="submit" name="decision" value="approve" style="padding:14px;background:#9aff63">Verbinden met ChatGPT</button> '+
      '<button type="submit" name="decision" value="deny" style="padding:14px">Weigeren</button></form>'+
      '<p style="font-size:12px;color:#aaa">De toestemming is eenmalig. Tokens kunnen later worden ingetrokken.</p></body></html>');
  }
  async authorizeDecision(req,res) {
    let f;
    try {f=await readBody(req,"application/x-www-form-urlencoded");}
    catch(e){return oauthError(res,e.status||400,"invalid_request",e.message);}
    if(!/^[A-Za-z0-9_-]{32,128}$/.test(f.request||""))
      return oauthError(res,400,"invalid_request","Invalid approval request");
    const pending=this.db.prepare("SELECT * FROM mcp_oauth_pending WHERE hash=?").get(hash(f.request));
    if(!pending||pending.expires_at<=Date.now())return oauthError(res,400,"invalid_request","Approval expired");
    if(!this.client(pending.client_id,pending.redirect_uri))
      return oauthError(res,400,"invalid_client","Unknown client");
    if(f.decision!=="approve" && f.decision!=="deny")
      return oauthError(res,400,"invalid_request","Invalid decision");
    if(f.decision==="approve"){
      try {this.authenticate(f.username,f.password,req.socket.remoteAddress||"unknown");}
      catch {return html(res,401,"<h1>Blossom-aanmelding mislukt</h1><p>Controleer je gegevens en start de verbinding opnieuw vanuit ChatGPT.</p>");}
    }
    this.db.prepare("DELETE FROM mcp_oauth_pending WHERE hash=?").run(hash(f.request));
    const dest=new URL(pending.redirect_uri);
    dest.searchParams.set("state",pending.state);
    dest.searchParams.set("iss",this.origin);
    if(f.decision==="deny")dest.searchParams.set("error","access_denied");
    else {
      const code=random();
      this.db.prepare("INSERT INTO mcp_oauth_codes VALUES (?,?,?,?,?,?,?)")
        .run(hash(code),pending.client_id,pending.redirect_uri,pending.challenge,
          pending.scope,pending.resource,Date.now()+CODE_MS);
      dest.searchParams.set("code",code);
    }
    res.writeHead(303,{...formHeaders,Location:dest.toString()});res.end();
  }
  issueTokens(clientId,scope,resource) {
    const token=random(),refresh=random(),now=Date.now();
    this.db.prepare("INSERT INTO mcp_oauth_tokens VALUES (?,?,?,?,?)")
      .run(hash(token),clientId,scope,resource,now+ACCESS_MS);
    this.db.prepare("INSERT INTO mcp_oauth_refresh VALUES (?,?,?,?,?)")
      .run(hash(refresh),clientId,scope,resource,now+REFRESH_MS);
    return {access_token:token,token_type:"Bearer",expires_in:ACCESS_MS/1000,
      refresh_token:refresh,scope};
  }
  async token(req,res) {
    let f;
    try {f=await readBody(req,"application/x-www-form-urlencoded");}
    catch(e){return oauthError(res,e.status||400,"invalid_request",e.message);}
    if(f.grant_type==="authorization_code"){
      if(!/^[A-Za-z0-9_-]{32,128}$/.test(f.code||"") ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(f.code_verifier||""))
        return oauthError(res,400,"invalid_grant","Invalid authorization code or verifier");
      // One-time redemption prevents code replay even after failed PKCE.
      const row=this.db.prepare("DELETE FROM mcp_oauth_codes WHERE hash=? RETURNING *").get(hash(f.code));
      if(!row||row.expires_at<=Date.now()||row.client_id!==f.client_id||
         row.redirect_uri!==f.redirect_uri||row.resource!==this.resolveResource(f.resource)||
         !safe(createHash("sha256").update(f.code_verifier).digest("base64url"),row.challenge))
        return oauthError(res,400,"invalid_grant","Invalid authorization grant");
      return json(res,200,this.issueTokens(row.client_id,row.scope,row.resource));
    }
    if(f.grant_type==="refresh_token"){
      if(!/^[A-Za-z0-9_-]{32,128}$/.test(f.refresh_token||""))
        return oauthError(res,400,"invalid_grant","Invalid refresh token");
      const row=this.db.prepare("DELETE FROM mcp_oauth_refresh WHERE hash=? RETURNING *").get(hash(f.refresh_token));
      if(!row||row.expires_at<=Date.now()||row.client_id!==f.client_id||
         row.resource!==this.resolveResource(f.resource))
        return oauthError(res,400,"invalid_grant","Invalid refresh grant");
      return json(res,200,this.issueTokens(row.client_id,row.scope,row.resource));
    }
    return oauthError(res,400,"unsupported_grant_type","Use authorization_code or refresh_token");
  }
}
