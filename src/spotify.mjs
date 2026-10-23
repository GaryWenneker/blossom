import { randomBytes, createHash } from "node:crypto";
import { DomainError } from "./domain.mjs";
const hash = s=>createHash("sha256").update(s).digest("base64url");
export class SpotifyOAuth {
  constructor({vault,sessions,baseUrl="http://127.0.0.1:8787",fetcher=fetch}={}) {
    this.vault=vault;this.sessions=sessions;this.fetcher=fetcher;
    const url=new URL(baseUrl);
    if(url.username||url.password||url.search||url.hash||url.pathname!=="/"||
      !(url.protocol==="https:" || (url.protocol==="http:"&&url.hostname==="127.0.0.1")))
      throw Error("BLOSSOM_PUBLIC_URL must be HTTPS or http://127.0.0.1 for development");
    this.baseUrl=url.origin;
    this.redirectUri=url.origin+"/auth/spotify/callback";
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
      code_challenge_method:"S256",code_challenge:challenge,state,scope:"user-read-private",
      ...(chooseAccount?{show_dialog:"true"}:{})}).toString();
    return url.toString();
  }
  async complete(sessionHash,state,code) {
    if(typeof state!=="string"||!/^[-_a-zA-Z0-9]{20,100}$/.test(state)||
      typeof code!=="string"||code.length<2||code.length>3000)throw new DomainError("Invalid Spotify callback",400);
    const encrypted=this.sessions.consumeOAuth(state,sessionHash);
    if(!encrypted)throw new DomainError("Spotify login session expired or already used",409);
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
  async profile() {
    const refreshToken=this.vault.read("spotify_refresh_token");
    if(!refreshToken)throw new DomainError("Spotify is not connected. Authorize again.",409);
    const response=await this.fetcher("https://accounts.spotify.com/api/token",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"refresh_token",refresh_token:refreshToken,client_id:this.vault.getSetting("spotify_client_id")}),
      signal:AbortSignal.timeout(15000)
    });
    if(!response.ok) {
      const failure=await response.json().catch(()=>({}));
      if(response.status===400&&failure?.error==="invalid_grant"){
        this.vault.delete("spotify_refresh_token");
        throw new DomainError("Spotify authorization expired. Please reconnect.",409);
      }
      throw new DomainError("Spotify token refresh failed ("+response.status+")",502);
    }
    const token=await response.json();
    if(typeof token?.access_token!=="string")throw new DomainError("Spotify did not provide an access token",502);
    if(typeof token?.refresh_token==="string")
      this.vault.save("spotify_refresh_token",this.vault.list().spotify_refresh_token.label,token.refresh_token);
    const result=await this.fetcher("https://api.spotify.com/v1/me",{
      headers:{Authorization:"Bearer "+token.access_token},signal:AbortSignal.timeout(15000)
    });
    if(!result.ok)throw new DomainError("Spotify profile verification failed ("+result.status+")",502);
    const p=await result.json();
    if(!p || (typeof p.account_id!=="string" && typeof p.id!=="string"))
      throw new DomainError("Spotify did not provide an account ID",502);
    return {accountId:p.account_id||p.id,displayName:String(p.display_name||"Spotify").slice(0,160)};
  }

}
