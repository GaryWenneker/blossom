#!/usr/bin/env node
/**
 * Diagnostics for stale or misrouted live Blossom MCP servers.
 * Never prints, sends to the public host or stores tokens.
 */
import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, parseEnv, probeMcpHealth, verifyLiveMcpTools } from "./setup-blossom.mjs";
import { musicDnaMcpToolFingerprint, musicDnaMcpToolNames } from "../src/music-dna-mcp.mjs";

export async function diagnoseMcpTools({envFile=join(ROOT,".env"),publicCheck=false,
  fetcher=fetch,log=console.log}={}) {
  const stat=await lstat(envFile);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error("Blossom .env must be a regular file");
  const cfg=parseEnv(await readFile(envFile,"utf8"));
  const local=await verifyLiveMcpTools({writeToken:cfg.BLOSSOM_MCP_WRITE_TOKEN,fetcher});
  log("LOCAL: OK | "+local.toolCount+" MCP tools | Spotify Liked Songs "+
    (local.spotifyLiked?"available":"MISSING")+
    " | fingerprint "+local.toolFingerprint);
  if(!publicCheck)return {local,public:null,matching:null};
  const origin=cfg.BLOSSOM_MCP_PUBLIC_URL;
  if(!origin || !/^https:\/\/[^/?#]+\/?$/.test(origin))
    throw Error("BLOSSOM_MCP_PUBLIC_URL is missing or invalid in local .env");
  const publicHealth=await probeMcpHealth({baseUrl:origin.replace(/\/$/,""),fetcher});
  log("PUBLIC: "+(publicHealth.compatible?"OK":"MISMATCH")+
    " | fingerprint "+(publicHealth.toolFingerprint||"missing")+
    " | count "+String(publicHealth.toolCount??"unknown")+
    " | reachable "+publicHealth.reachable);
  if(!publicHealth.compatible)
    throw Error("Cloudflare/public URL does not expose the same current MCP tool contract as local Blossom. "+
      "Check Cloudflare tunnel ingress host, destination port and any old server/tunnel. "+
      "Expected "+musicDnaMcpToolNames().length+
      " tools with fingerprint "+musicDnaMcpToolFingerprint);
  return {local,public:publicHealth,matching:true};
}

if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const flags=process.argv.slice(2);
  if(flags.some(x=>x!=="--public")){console.error("Usage: node scripts/check-mcp-tools.mjs [--public]");process.exitCode=2;}
  else diagnoseMcpTools({publicCheck:flags.includes("--public")})
    .catch(error=>{console.error("MCP DIAGNOSIS FAILED: "+error.message);process.exitCode=1;});
}
