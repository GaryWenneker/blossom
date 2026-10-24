import { randomBytes, createHash } from "node:crypto";
import { DomainError } from "./domain.mjs";
const hash = s=>createHash("sha256").update(s).digest("base64url");
export class SpotifyOAuth {
  constructor({vault,sessions,baseUrl="http://127.0.0.1:8787",publicCallbackOrigin="",fetcher=fetch}={}) {
    this.vault=vault;this.sessions=sessions;this.fetcher=fetcher;
    const url=new URL(baseUrl);
    if(url.username||url.password||url.search||url.hash||url.pathname!=="/"||
      !(url.protocol==="https:" || (url.protocol==="http:"&&url.hostname==="127.0.0.1")))
      throw Error("BLOSSOM_PUBLIC_URL must be HTTPS or http://127.0.0.1 for development");
    this.baseUrl=url.origin;
    if(publicCallbackOrigin) {
      const publicUrl=new URL(publicCallbackOrigin);
      if(publicUrl.protocol!=="https:"||publicUrl.username||publicUrl.password||
        publicUrl.pathname!=="/"||publicUrl.search||publicUrl.hash||publicUrl.port)
        throw Error("Spotify public callback origin must be a public HTTPS origin");
      this.redirectUri=publicUrl.origin+"/callback";
    } else {
      // Local-only development mode retains the historical loopback callback.
      this.redirectUri=url.origin+"/auth/spotify/callback";
    }
  }
  start(sessionHash, { chooseAccount = false } = {}) {
    this.vault.requireKey();
    const clientId=this.vault.getSetting("spotify_client_id");
    if(!clientId)throw new DomainError("Save Spotify Client ID before connecting",409);
    const state=randomBytes(24).toString("base64url");
    const verifier=randomBytes(48).toString("base64url");
    const challenge=hash(verifier);
    this.sessions.saveOAuth(state,sessionHash,this.vault.encrypt("oauth_verifier",verifier));
    const url=new URL("https://accounts.spotify.com/authorize");
    url.search=new URLSearchParams({client_id:clientId,response_type:"code",redirect_uri:this.redirectUri,
      code_challenge_method:"S256",code_challenge:challenge,state,scope:"user-read-private user-library-read",
      ...(chooseAccount?{show_dialog:"true"}:{})}).toString();
    return url.toString();
  }
  async complete(sessionHash,state,code) {
    this.validateCallback(state,code);
    const encrypted=this.sessions.consumeOAuth(state,sessionHash);
    if(!encrypted)throw new DomainError("Spotify login session expired or already used",409);
    return this.exchangeSpotifyCode(encrypted,code);
  }
  async completePublic(state,code) {
    if(!this.redirectUri.startsWith("https://"))
      throw new DomainError("Public Spotify callback is not enabled",404);
    this.validateCallback(state,code);
    const encrypted=this.sessions.consumeSpotifyPublicOAuth(state);
    if(!encrypted)throw new DomainError("Spotify consent expired, already processed or local login is no longer valid",409);
    return this.exchangeSpotifyCode(encrypted,code);
  }
  validateCallback(state,code) {
    if(typeof state!=="string"||!/^[-_a-zA-Z0-9]{20,100}$/.test(state)||
      typeof code!=="string"||code.length<2||code.length>3000)
      throw new DomainError("Invalid Spotify callback",400);
  }
  async exchangeSpotifyCode(encrypted,code) {
    const verifier=this.vault.decrypt("oauth_verifier",encrypted);
    const clientId=this.vault.getSetting("spotify_client_id");
    const response=await this.fetcher("https://accounts.spotify.com/api/token",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"authorization_code",code,redirect_uri:this.redirectUri,client_id:clientId,code_verifier:verifier}),
      signal:AbortSignal.timeout(15000)
    });
    if(!response.ok)throw new DomainError("Spotify authorization failed ("+response.status+")",502);
    const token=await response.json();
    if(typeof token?.access_token!=="string"||typeof token?.refresh_token!=="string")
      throw new DomainError("Spotify did not return refreshable authorization",502);
    const profileResponse=await this.fetcher("https://api.spotify.com/v1/me",{
      headers:{Authorization:"Bearer "+token.access_token},signal:AbortSignal.timeout(15000)
    });
    if(!profileResponse.ok)throw new DomainError("Spotify profile verification failed",502);
    const profile=await profileResponse.json();
    if(typeof profile?.account_id!=="string" && typeof profile?.id!=="string")
      throw new DomainError("Spotify profile has no account ID",502);
    const label=String(profile.display_name||profile.id||"Spotify").slice(0,180);
    this.vault.save("spotify_refresh_token",label,token.refresh_token);
    return {accountId:profile.account_id||profile.id,label};
  }
  // A regular signed-in Spotify browser session is NOT an API grant.
  // Obtain an API access token only from a prior PKCE consent, with refresh
  // token kept inside the encrypted Blossom vault.
  async accessToken() {
    const refreshToken=this.vault.read("spotify_refresh_token");
    if(!refreshToken)throw new DomainError(
      "Spotify API is not connected. In Blossom Connections, authorize Spotify with access to Liked Songs.",409);
    const clientId=this.vault.getSetting("spotify_client_id");
    if(!clientId)throw new DomainError("Spotify Client ID is missing. Configure Spotify Web API in Connections.",409);
    const response=await this.fetcher("https://accounts.spotify.com/api/token",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"refresh_token",refresh_token:refreshToken,client_id:clientId}),
      signal:AbortSignal.timeout(15000)
    });
    if(!response.ok){
      const failure=await response.json().catch(()=>({}));
      if(response.status===400&&failure?.error==="invalid_grant"){
        this.vault.delete("spotify_refresh_token");
        throw new DomainError("Spotify authorization expired. Reconnect in Blossom Connections.",409);
      }
      throw new DomainError("Spotify token refresh failed ("+response.status+")",502);
    }
    const token=await response.json();
    if(typeof token?.access_token!=="string"||!token.access_token)
      throw new DomainError("Spotify did not provide an access token",502);
    if(typeof token?.refresh_token==="string"&&token.refresh_token)
      this.vault.save("spotify_refresh_token",
        this.vault.list().spotify_refresh_token?.label||"Spotify",token.refresh_token);
    return token.access_token;
  }
  async profile() {
    const accessToken=await this.accessToken();
    const result=await this.fetcher("https://api.spotify.com/v1/me",{
      headers:{Authorization:"Bearer "+accessToken},signal:AbortSignal.timeout(15000)
    });
    if(!result.ok)throw new DomainError("Spotify profile verification failed ("+result.status+")",502);
    const p=await result.json();
    if(!p || (typeof p.account_id!=="string" && typeof p.id!=="string"))
      throw new DomainError("Spotify did not provide an account ID",502);
    return {accountId:p.account_id||p.id,displayName:String(p.display_name||"Spotify").slice(0,160)};
  }
  async likedTracksPage({ offset=0, limit=50 }={}) {
    if(!Number.isInteger(offset)||offset<0||offset>1_000_000 ||
      !Number.isInteger(limit)||limit<1||limit>50)
      throw new DomainError("Spotify Liked Songs requires offset 0–1000000 and limit 1–50",400);
    const token=await this.accessToken();
    const url=new URL("https://api.spotify.com/v1/me/tracks");
    url.searchParams.set("limit",String(limit));
    url.searchParams.set("offset",String(offset));
    const res=await this.fetcher(url.toString(),{
      headers:{Authorization:"Bearer "+token,Accept:"application/json"},
      signal:AbortSignal.timeout(20000)
    });
    if(!res.ok) {
      if(res.status===401||res.status===403)throw new DomainError(
        "Spotify cannot read Liked Songs. Reconnect through the official Spotify OAuth page with user-library-read; Spotify developer apps may also require Premium.",res.status);
      if(res.status===429){
        const retryRaw=Number(res.headers?.get?.("retry-after"));
        const wait=Number.isFinite(retryRaw)?Math.min(Math.max(Math.ceil(retryRaw),1),3600):30;
        throw new DomainError("Spotify rate limit reached; retry in "+wait+" seconds",429);
      }
      throw new DomainError("Spotify Liked Songs request failed ("+res.status+")",502);
    }
    const body=await res.json().catch(()=>null);
    if(!body||!Array.isArray(body.items)||!Number.isInteger(body.total)||body.total<0||
      body.items.length>limit)
      throw new DomainError("Spotify returned an invalid saved-tracks response",502);
    // Always compute the next page locally: never fetch third-party next URLs.
    const nextOffset=body.next && body.items.length>0 && offset+body.items.length<body.total
      ?offset+body.items.length:null;
    return {offset,limit,total:body.total,items:body.items,nextOffset};
  }
}
