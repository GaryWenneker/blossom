import { createHash } from "node:crypto";
import { DomainError, now } from "./domain.mjs";
// These are explicit reviewed sources, not arbitrary user-supplied URLs.
export const WATCH_URLS = [
  "https://suno.com/terms",
  "https://www.spotify.com/legal/end-user-agreement/",
  "https://help.labelgrid.com/en/developers/api-overview/"
];
export function fingerprint(text) {
  return createHash("sha256").update(text.replace(/\s+/g," ").trim()).digest("hex");
}
export async function checkTerms(store,fetcher=fetch,urls=WATCH_URLS) {
  const results=[];
  for (const url of urls) {
    if (!WATCH_URLS.includes(url)) throw new DomainError("Unapproved monitoring URL");
    try {
      const response=await fetcher(url,{headers:{"Accept":"text/html,text/plain"},signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const body=(await response.text()).slice(0,1_000_000);
      if(body.length<200)throw new Error("Unexpectedly short terms document");
      const hash=fingerprint(body);
      const previous=store.watch(url);
      const changed=!!previous?.hash && previous.hash!==hash;
      const state=changed||previous?.state==="changed"?"changed":previous?.state==="acknowledged"?"acknowledged":"baseline";
      store.upsertWatch(url,hash,state,changed?now():previous?.changed_at||"");
      if(changed)store.audit("terms_changed","watch",url,{previousHash:previous.hash,currentHash:hash});
      results.push({url,state,changed});
    } catch(error) {
      store.audit("watch_failed","watch",url,{error:String(error).slice(0,180)});
      results.push({url,state:"fetch_failed",error:String(error).slice(0,180)});
    }
  }
  return results;
}
export function enableMonitor(store,{enabled=process.env.BLOSSOM_MONITOR_ENABLED==="true"}={}) {
  if(!enabled)return null;
  // A monitoring process is not a guaranteed 24/7 service. Run a durable external scheduler in production.
  const run=()=>checkTerms(store).catch(err=>store.audit("watch_crashed","watch","scheduler",{error:String(err)}));
  const timer=setInterval(run,24*60*60*1000);
  timer.unref();run();
  return timer;
}
