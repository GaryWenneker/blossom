import { execFile } from "node:child_process";
import { DomainError } from "./domain.mjs";
import { PROVIDER_URLS, providerBrowserUrl } from "./browser-connections.mjs";

/**
 * Native Safari is intentionally not driven by Playwright or Chrome CDP.
 * LaunchServices opens the genuine user-controlled macOS app, whose own
 * browser profile holds cookies. We never read browser data or login fields.
 */
export async function openProviderInSafari(provider,{
  platform=process.platform, launcher=execFile, confirmed=false, forceLogin=false
}={}) {
  if(!Object.hasOwn(PROVIDER_URLS,provider))
    throw new DomainError("Unsupported browser provider",404);
  if(platform!=="darwin")
    throw new DomainError("Native Safari launch is available only on macOS",501);
  const url=providerBrowserUrl(provider,{confirmed,forceLogin});
  await new Promise((resolve,reject)=>{
    launcher("/usr/bin/open",["-a","Safari",url],
      {timeout:12000,windowsHide:true},error=>{
        if(error)reject(new DomainError(
          "Could not open the Safari application on this Mac. Open Safari normally and visit "+url,503));
        else resolve();
      });
  });
  return {provider,launched:true,application:"Safari",url,
    authenticationVerified:false,apiConnected:false};
}

export function localMacBrowserRequest(req) {
  // Reject tunneled/remote access to a locally installed GUI app.
  const host=String(req.headers.host||"").toLowerCase();
  const address=req.socket?.remoteAddress||"";
  return /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host) &&
    (address==="127.0.0.1"||address==="::1"||address==="::ffff:127.0.0.1");
}
