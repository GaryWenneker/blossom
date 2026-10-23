import { DomainError } from "../domain.mjs";
const DEFAULT = "https://api.labelgrid.com/api/public";
function baseUrl(raw = DEFAULT) {
  const url = new URL(raw);
  // Both production and the documented sandbox host are permitted.
  if (url.protocol !== "https:" || !["api.labelgrid.com","api-sandbox.stg.labelgrid.com"].includes(url.hostname))
    throw new DomainError("LabelGrid base URL must use a documented LabelGrid HTTPS host",500);
  if (url.username || url.password || url.search || url.hash) throw new DomainError("Invalid LabelGrid base URL",500);
  return url.toString().replace(/\/$/,"");
}
export class LabelGrid {
  constructor({token=process.env.LABELGRID_API_TOKEN,base=process.env.LABELGRID_BASE_URL||DEFAULT,fetcher=fetch}={}) {
    this.token=token;this.base=baseUrl(base);this.fetcher=fetcher;
  }
  available() {return Boolean(this.token);}
  async request(method,path) {
    if (!this.token) throw new DomainError("LabelGrid API token is not configured",503);
    const response = await this.fetcher(this.base+path,{
      method,headers:{Authorization:"Bearer "+this.token,Accept:"application/json"},
      signal:AbortSignal.timeout(12000)
    });
    const raw=await response.text(),data=raw?(()=>{try{return JSON.parse(raw)}catch{return {message:raw.slice(0,200)}}})():{};
    if (!response.ok) throw new DomainError("LabelGrid "+response.status+": "+String(data?.message||"Request failed").slice(0,220),502);
    return data;
  }
  whoAmI() {return this.request("GET","/me");}
  validate(externalReleaseId) {return this.request("POST","/releases/"+encodeURIComponent(externalReleaseId)+"/validate");}
  distribute(externalReleaseId) {return this.request("POST","/releases/"+encodeURIComponent(externalReleaseId)+"/distribute");}
  deliveryStatus(externalReleaseId) {return this.request("GET","/releases/"+encodeURIComponent(externalReleaseId)+"/delivery-status");}
}
