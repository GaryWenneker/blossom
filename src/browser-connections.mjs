import { DomainError } from "./domain.mjs";

// Google explicitly rejects sign-in from some automated browsers.
// Open provider login ONLY in the user's normal default browser. No WebDriver,
// CDP, embedded WebView, profile cloning, or cookie extraction is involved.
export const PROVIDER_URLS = Object.freeze({
  suno:"https://suno.com/create",
  spotify:"https://open.spotify.com/",
  chatgpt:"https://chatgpt.com/"
});
export const SPOTIFY_LOGIN_URL = "https://accounts.spotify.com/nl/login";

// An existing browser session should open the player. When sign-in is needed,
// use Spotify's official login screen where an existing Facebook method can
// be selected. Never use Facebook cookies or OAuth tokens inside Blossom.
export function providerBrowserUrl(provider,{confirmed=false,forceLogin=false}={}) {
  if(!Object.hasOwn(PROVIDER_URLS,provider))
    throw new DomainError("Unsupported browser provider",404);
  return provider==="spotify" && (forceLogin || !confirmed)
    ? SPOTIFY_LOGIN_URL : PROVIDER_URLS[provider];
}
export class VisibleBrowserSession {
  constructor(provider) {
    if(!Object.hasOwn(PROVIDER_URLS,provider))
      throw new DomainError("Unsupported browser service",400);
    this.provider=provider;
    this.site=PROVIDER_URLS[provider];
  }
  status() {
    return {
      provider:this.provider,website:this.site,mode:"system-browser",
      browserOpen:false,localProfilePresent:false,
      authenticationVerified:false,apiConnected:false,
      requiresManualLogin:true,requiresManualGeneration:true,
      note:"Your regular browser manages its own cookies and login. Blossom neither reads nor exports those sessions."
    };
  }
  async open() {
    // Client opens this allowlisted URL directly from a user click.
    return {...this.status(),url:this.site,openInUserBrowser:true};
  }
  async close() {
    // Never close personal browser tabs or erase their stored sessions.
    return {...this.status(),note:"Close the browser tab yourself if needed. Your existing login is kept by your browser."};
  }
  async prefill(recipe) {
    if(this.provider!=="suno"||!recipe||recipe.provider!=="suno")
      throw new DomainError("A valid Suno production blueprint is required",400);
    return {
      filled:[],
      skipped:["lyrics","styles","exclude","title"].filter(k=>String(
        (k==="styles"?recipe.style:k==="exclude"?recipe.exclude:recipe[k])??"").trim()),
      submitted:false,
      note:"Sign in normally with Google on Suno. Copy the production blueprint from Blossom; third-party browser forms are not controlled."
    };
  }
}
export class ConnectedBrowsers {
  constructor({suno,spotify,chatgpt}={}) {
    this.suno=suno||new VisibleBrowserSession("suno");
    this.spotify=spotify||new VisibleBrowserSession("spotify");
    this.chatgpt=chatgpt||new VisibleBrowserSession("chatgpt");
  }
  instance(provider) {
    if(!Object.hasOwn(PROVIDER_URLS,provider))
      throw new DomainError("Unsupported browser provider",404);
    return this[provider];
  }
  async status() {
    return {suno:this.suno.status(),spotify:this.spotify.status(),chatgpt:this.chatgpt.status()};
  }
  async open(provider) {return this.instance(provider).open();}
  async close(provider) {return this.instance(provider).close();}
  async closeAll() {
    // No controlled browser processes or cookies to manage.
  }
}
