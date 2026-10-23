import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { DomainError } from "./domain.mjs";

export function isPublicAddress(address) {
  if(isIP(address)===4){
    const [a,b,c] = address.split(".").map(Number);
    if(a===0||a===10||a===127||a>=224||a===169&&b===254||
       a===172&&b>=16&&b<=31||a===192&&b===168||
       a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||
       a===192&&b===0||a===192&&b===0&&c===2||
       a===198&&b===51&&c===100||a===203&&b===0&&c===113||
       a===255) return false;
    return true;
  }
  if(isIP(address)===6) {
    const lower=address.toLowerCase();
    // Reject all non-global, mapped IPv4, documentation, and special IPv6
    // addresses. Only allow ordinary global unicast ranges.
    return /^[23][0-9a-f]{0,3}:/.test(lower) && !lower.startsWith("2001:db8:");
  }
  return false;
}
export function publicArticleUrl(value) {
  if(typeof value!=="string" || value.length>2000)
    throw new DomainError("Enter a valid public article URL",400);
  let url;
  try { url=new URL(value.trim()); }
  catch { throw new DomainError("Enter a valid public article URL",400); }
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password||
     url.port && !["80","443"].includes(url.port) ||
     !url.hostname.includes(".")||isIP(url.hostname)||
     url.hostname==="localhost"||url.hostname.endsWith(".local")||
     url.hostname.endsWith(".internal"))
    throw new DomainError("Only public HTTP(S) article URLs are supported",400);
  url.hash="";
  return url;
}
function unescapeHTML(input) {
  const named={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",hellip:"…",
    ndash:"–",mdash:"—",rsquo:"’",lsquo:"‘",ldquo:"“",rdquo:"”",eacute:"é",
    euml:"ë",auml:"ä",ouml:"ö",uuml:"ü",euro:"€"};
  return String(input).replace(/&(#x[0-9a-f]+|#\d+|[a-z]{2,12});/gi,(whole,key)=>{
    const numeric=key[0]==="#"?parseInt(key.slice(key[1]?.toLowerCase()==="x"?2:1),
      key[1]?.toLowerCase()==="x"?16:10):NaN;
    if(Number.isInteger(numeric)&&numeric>0&&numeric<=0x10ffff&&
       !(numeric>=0xd800&&numeric<=0xdfff))return String.fromCodePoint(numeric);
    return named[key.toLowerCase()]||whole;
  });
}
const cleanText=input=>unescapeHTML(String(input)
 .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
 .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
 .replace(/<!--[\s\S]*?-->/g," ")
 .replace(/<\/(?:p|li|h[1-6]|div|section)>/gi,"\n")
 .replace(/<[^>]*>/g," ")
 .replace(/[ \t\u00a0]+/g," ")
 .replace(/\n\s*\n+/g,"\n")
 .trim()).slice(0,12000);
function ldArticleBody(html) {
  for(const [,jsonText] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try {
      const parsed=JSON.parse(jsonText.replace(/&quot;/g,'"'));
      const items=Array.isArray(parsed)?parsed:[parsed];
      const nodes=items.flatMap(o=>o?.["@graph"]||[o]);
      for(const x of nodes)if(x&&typeof x.articleBody==="string"&&x.articleBody.length>150)
        return {body:cleanText(x.articleBody),headline:typeof x.headline==="string"?x.headline:""};
    }catch{}
  }
  return null;
}
export function extractArticleHTML(html,sourceUrl) {
  const content=String(html).slice(0,2*1024*1024);
  const ld=ldArticleBody(content);
  const h1=content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const titleTag=content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title=cleanText(ld?.headline||h1?.[1]||titleTag?.[1]||"").slice(0,140);
  const article=content.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const main=content.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const candidate=article?.[1]||main?.[1]||content;
  const paragraphs=[...candidate.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m=>cleanText(m[1])).filter(x=>x.length>40&&!/^(advertentie|advertisement|lees ook|share this|cookiebeleid)/i.test(x));
  const text=ld?.body || paragraphs.join("\n\n").slice(0,10000);
  if(text.length<180)
    throw new DomainError("Het artikel kon niet worden gelezen (mogelijk paywall of toestemming vereist). Open de link en plak de tekst handmatig.",422);
  return {title,text:text.slice(0,10000),sourceUrl};
}
function fetchPage(url,{resolver=dnsLookup,timeoutMs=12000,maxBytes=2*1024*1024}={}){
  return new Promise((resolve,reject)=>{
    const secure=url.protocol==="https:";
    const request=(secure?httpsRequest:httpRequest)(url,{
      method:"GET",timeout:timeoutMs,
      headers:{"User-Agent":"Blossom/1.0 (user-requested article import)",
        "Accept":"text/html,application/xhtml+xml;q=0.9"},
      lookup:(hostname,opts,callback)=>{
        resolver(hostname,{...opts,all:true},(err,addresses)=>{
          if(err)return callback(err);
          const list=Array.isArray(addresses)?addresses:[addresses];
          if(!list.length||list.some(x=>!isPublicAddress(x.address)))
            return callback(new Error("Article host resolves to a non-public address"));
          if(opts.all) callback(null,list.map(x=>({address:x.address,family:x.family})));
          else {const first=list[0];callback(null,first.address,first.family);}
        });
      }
    },res=>{
      const status=res.statusCode||0;
      if(status>=300&&status<400){
        res.resume();
        return resolve({status,location:res.headers.location||""});
      }
      if(status!==200){res.resume();return reject(new DomainError(
        "Artikel ophalen mislukt (HTTP "+status+"). Plak eventueel de tekst.",502));}
      if(!/^(?:text\/html|application\/xhtml\+xml)/i.test(String(res.headers["content-type"]||""))){
        res.resume();return reject(new DomainError("De link bevat geen leesbare HTML-pagina",415));}
      if(Number(res.headers["content-length"]||0)>maxBytes){
        res.destroy();return reject(new DomainError("Artikelpagina is te groot",413));}
      let bytes=0,parts=[];
      res.on("data",chunk=>{
        bytes+=chunk.length;
        if(bytes>maxBytes){res.destroy();reject(new DomainError("Artikelpagina is te groot",413));return;}
        parts.push(chunk);
      });
      res.on("end",()=>resolve({status,html:Buffer.concat(parts).toString("utf8")}));
      res.on("error",reject);
    });
    request.on("timeout",()=>request.destroy(new Error("timeout")));
    request.on("error",err=>reject(new DomainError(
      /non-public address/.test(err.message)?"Interne of privé-adressen zijn niet toegestaan":
      "Artikel kon niet worden opgehaald. Open de link zelf en plak de tekst.",502)));
    request.end();
  });
}
export async function importArticle(url,{fetcher=fetchPage}={}){
  let target=publicArticleUrl(url);
  for(let i=0;i<4;i++){
    const result=await fetcher(target);
    if(result.status>=300&&result.status<400){
      if(i===3)throw new DomainError("Te veel doorverwijzingen bij artikel",422);
      if(!result.location)throw new DomainError("Doorverwijzing zonder bestemming",422);
      const next=publicArticleUrl(new URL(result.location,target).href);
      if(target.protocol==="https:"&&next.protocol!=="https:")
        throw new DomainError("Onveilige doorverwijzing geweigerd",400);
      target=next;continue;
    }
    return extractArticleHTML(result.html,target.href);
  }
}
