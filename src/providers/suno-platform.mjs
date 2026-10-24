
import { DomainError } from "../domain.mjs";
const API_ORIGIN="https://api.suno.com";
const AUDIO_MAX=40*1024*1024;
export function sunoReady(project) {
  const missing=[];
  if(!project?.artistId)missing.push("Select an artist");
  const title=project?.title&&project.title!=="Untitled project"?project.title:project?.result?.titles?.[0];
  if(!title||title==="Untitled")missing.push("Choose a song title");
  if(!project?.result?.concept?.trim())missing.push("Generate the AI brief");
  if(!project?.parameters?.genre?.trim())missing.push("Choose a genre");
  if(!project?.parameters?.instrumental&&!project?.result?.lyrics?.trim())missing.push("Add lyrics or choose Instrumental");
  return {ready:missing.length===0,missing,title:title||""};
}
export function officialSunoRequest(recipe) {
  if(!recipe || recipe.provider!=="suno")throw new DomainError("Valid Suno blueprint required",400);
  const payload={title:recipe.title,style:String(recipe.style||"").slice(0,1000),instrumental:!!recipe.instrumental};
  if(!payload.instrumental)payload.lyrics=String(recipe.lyrics||"");
  if(!payload.style || !payload.title || !payload.instrumental&&!payload.lyrics)
    throw new DomainError("Suno requires title, style and lyrics unless instrumental",400);
  // Only documented API parameters. Non-documented Suno sliders remain in
  // the human-facing blueprint, not silently passed to the official API.
  return payload;
}
export function trustedSunoAudioUrl(value) {
  let url;
  try{url=new URL(value);}catch{throw new DomainError("Invalid Suno audio URL",400);}
  if(url.protocol!=="https:" || url.username || url.password || url.port ||
     !["cdn1.suno.ai","cdn2.suno.ai","cdn.suno.ai","audio.suno.com","cdn.suno.com"].includes(url.hostname.toLowerCase()))
    throw new DomainError("Suno audio must come from an approved Suno media host",400);
  url.hash="";
  return url.href;
}
export async function fetchSunoAudio(url,{fetcher=fetch}={}) {
  const source=trustedSunoAudioUrl(url);
  let response;
  try{response=await fetcher(source,{redirect:"error",signal:AbortSignal.timeout(60000),
    headers:{Accept:"audio/mpeg,audio/wav"}});}
  catch{throw new DomainError("Could not download the completed Suno audio. Use manual MP3 import.",502);}
  if(!response.ok)throw new DomainError("Suno audio download returned HTTP "+response.status,502);
  if(Number(response.headers.get("content-length")||0)>AUDIO_MAX)throw new DomainError("Suno audio too large",413);
  const chunks=[];let length=0;
  try{
    for await(const chunk of response.body){
      length+=chunk.length;
      if(length>AUDIO_MAX)throw new DomainError("Suno audio too large",413);
      chunks.push(chunk);
    }
  }catch(error){if(error instanceof DomainError)throw error;throw new DomainError("Interrupted Suno audio download",502);}
  const bytes=Buffer.concat(chunks);
  const mp3=bytes.length>128&&(bytes.subarray(0,3).toString()==="ID3" ||
    (bytes[0]===255&&(bytes[1]&224)===224));
  const wav=bytes.length>128&&bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WAVE";
  if(!mp3&&!wav)throw new DomainError("Downloaded Suno media is not valid MP3/WAV audio",422);
  return {bytes,mime:mp3?"audio/mpeg":"audio/wav",extension:mp3?"mp3":"wav"};
}
export class SunoPlatform {
  constructor({fetcher=fetch,origin=API_ORIGIN}={}) {
    if(origin!==API_ORIGIN && process.env.NODE_ENV!=="test")
      throw new DomainError("Suno API origin must be official api.suno.com",400);
    this.origin=origin;this.fetcher=fetcher;
  }
  async request(path,key,{method="GET",payload}={}){
    if(typeof key!=="string"||!key.trim())throw new DomainError("Configure your Suno Platform API key in Connections first",409);
    let res;
    try{res=await this.fetcher(this.origin+path,{method,headers:{
      Authorization:"Bearer "+key,"Content-Type":"application/json","Accept":"application/json"},
      ...(payload?{body:JSON.stringify(payload)}:{}),redirect:"error",
      signal:AbortSignal.timeout(30000)});}
    catch{throw new DomainError("Suno Platform is unreachable. No generation was confirmed.",502);}
    let value;
    try{value=await res.json();}catch{throw new DomainError("Suno Platform returned invalid JSON",502);}
    if(!res.ok)throw new DomainError("Suno Platform rejected request (HTTP "+res.status+"): "+
      String(value?.error?.message||value?.error||"Check API credentials and account access").slice(0,160),res.status===401?401:502);
    return value;
  }
  async submit(recipe,key){
    const response=await this.request("/v0/audio",key,{method:"POST",payload:officialSunoRequest(recipe)});
    if(typeof response?.id!=="string"||!response.id.trim())
      throw new DomainError("Suno submission did not return an audio job ID",502);
    return {id:response.id,status:response.status||"submitted"};
  }
  async status(id,key){
    if(!/^[a-zA-Z0-9-]{8,120}$/.test(id))throw new DomainError("Invalid Suno job identifier",400);
    const v=await this.request("/v0/audio/"+encodeURIComponent(id),key);
    return {id,status:String(v.status||"unknown"),
      audioUrl:typeof v.audio_url==="string"?v.audio_url:null,
      error:String(v.error?.message||v.error||"").slice(0,240)};
  }
}
