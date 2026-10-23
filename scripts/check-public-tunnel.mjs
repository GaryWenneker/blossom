#!/usr/bin/env node
// Safe read-only public gateway diagnostic for the Mac running Blossom.
// Does not inspect tunnel credentials, expose the admin UI, or modify DNS.
import { request as httpRequest } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";
import { execFile } from "node:child_process";

const HOSTNAME="blossom.wenneker.dev";
const PUBLIC="https://"+HOSTNAME;
const timeout=7000;

export function diagnose({local,virtualHost,remote,dns,connector}){
  const hints=[];
  if(!local?.ok)
    hints.push("Local Blossom server is not healthy. Run: launchctl kickstart -k gui/$(id -u)/io.wenneker.blossom.server. Then check .data/logs/server.log.");
  else if(!virtualHost?.ok)
    hints.push("Local server is up but the public Host route did not return 200. Run git pull && bash setup.sh --headless, then restart Blossom.");
  if(!dns?.ok)hints.push("The hostname did not resolve here. Verify Cloudflare DNS for blossom.wenneker.dev and the tunnel's public hostname route.");
  if(!remote?.ok){
    if(remote?.status===404 && local?.ok)
      hints.push("Cloudflare reached a service returning 404. Confirm the tunnel targets http://127.0.0.1:8787 and preserves HTTP Host Header blossom.wenneker.dev.");
    else if(remote?.status===502||remote?.status===530||remote?.status===1033)
      hints.push("Cloudflare cannot reach its origin/tunnel. Ensure the existing cloudflared connector is connected and routing to port 8787 on this Mac.");
    else if(remote?.status===403)
      hints.push("Cloudflare Access/WAF may be blocking this request. Exclude MCP/OAuth discovery paths from Access challenges; keep Studio admin private.");
    else hints.push("Public HTTPS could not be confirmed. Check your Cloudflare tunnel connector and its hostname mapping.");
  }
  if(!connector?.ok && !remote?.ok)
    hints.push("No running cloudflared process detected on this Mac. In Cloudflare Zero Trust check the existing tunnel connector/service; do not create a duplicate tunnel.");
  if(!hints.length)hints.push("Public gateway is reachable from this Mac. Check the ChatGPT MCP connection separately at "+PUBLIC+"/mcp.");
  return hints;
}
function checkLocal(path,host){
  return new Promise(resolve=>{
    const req=httpRequest({hostname:"127.0.0.1",port:8787,path,method:"GET",
      headers:{"Host":host},timeout},res=>{
      let body="";
      res.on("data",chunk=>{if(body.length<2000)body+=chunk.toString("utf8").slice(0,2000-body.length);});
      res.on("end",()=>resolve({ok:res.statusCode===200,status:res.statusCode,body:body.slice(0,170)}));
    });
    req.on("timeout",()=>req.destroy(Error("timeout")));
    req.on("error",err=>resolve({ok:false,error:err.code||err.message}));
    req.end();
  });
}
async function checkPublic(path){
  try{
    const res=await fetch(PUBLIC+path,{redirect:"manual",signal:AbortSignal.timeout(timeout)});
    return {ok:res.status===200,status:res.status,via:res.headers.get("server")||""};
  }catch(error){return {ok:false,error:error.cause?.code||error.name||"network error"};}
}
async function dns(){
  try{const addresses=await dnsLookup(HOSTNAME,{all:true});return {ok:addresses.length>0,count:addresses.length};}
  catch(error){return {ok:false,error:error.code||"no DNS"};}
}
function connector(){
  return new Promise(resolve=>{
    if(process.platform!=="darwin")return resolve({ok:false,message:"Process check is macOS-only"});
    execFile("pgrep",["-x","cloudflared"],{timeout:3000},(err,_stdout)=>{
      resolve({ok:!err});
    });
  });
}
export async function runChecks({checkLocalFn=checkLocal,checkPublicFn=checkPublic,dnsFn=dns,connectorFn=connector}={}){
  const [local,virtualHost,remote,name,processCheck,oauth]=await Promise.all([
    checkLocalFn("/healthz","127.0.0.1:8787"),
    checkLocalFn("/","blossom.wenneker.dev"),
    checkPublicFn("/healthz"),dnsFn(),connectorFn(),
    checkPublicFn("/.well-known/oauth-authorization-server")
  ]);
  return {local,virtualHost,remote,dns:name,connector:processCheck,oauth,
    hints:diagnose({local,virtualHost,remote,dns:name,connector:processCheck})};
}
function status(name,value) {
  const state=value?.ok?"OK":"FAIL";
  const detail=value?.status?("HTTP "+value.status):value?.error||value?.message||"";
  console.log(state+"  "+name+(detail?" — "+detail:""));
}
if(process.argv[1] && new URL("file://"+process.argv[1]).href===import.meta.url) {
  console.log("Blossom public gateway check (no credentials exposed)");
  const result=await runChecks();
  status("Local Blossom /healthz",result.local);
  status("Local public Host routing",result.virtualHost);
  status("Cloudflare DNS",result.dns);
  status("Cloudflared process",result.connector);
  status("Public gateway /healthz",result.remote);
  status("Public OAuth discovery",result.oauth);
  for(const hint of result.hints)console.log("\n• "+hint);
  if(!result.remote.ok||!result.oauth.ok)process.exitCode=1;
}
