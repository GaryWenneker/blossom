import { MusicDNA } from "./music-dna.mjs";
import { StudioReferences } from "./music-dna-studio.mjs";
import { StudioStore, LENGTH_PRESETS, sunoRecipe, studioBriefFingerprint } from "./studio.mjs";
import { OpenAIComposer } from "./providers/openai.mjs";
import { DrawThings } from "./drawthings.mjs";
import { ChatGptImages } from "./chatgpt-images.mjs";
import { DomainError } from "./domain.mjs";
import { VisibleBrowserSession } from "./browser-connections.mjs";
import { LocalComposer } from "./providers/local.mjs";
import { ChatGptLyricsBrowser } from "./chatgpt-playwright.mjs";
import { importArticle } from "./article-import.mjs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const send=(res,code,data)=>{res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data));};
async function readJSON(req){
  if(!String(req.headers["content-type"]||"").startsWith("application/json"))
    throw new DomainError("Expected application/json",415);
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>256000)throw new DomainError("JSON payload too large",413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"))}catch{throw new DomainError("Invalid JSON")}
}
async function audioBuffer(req){
  const type=String(req.headers["content-type"]||"").split(";")[0];
  if(!["audio/mpeg","audio/wav","audio/x-wav"].includes(type))throw new DomainError("Upload MP3 or WAV audio only",415);
  const chunks=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>40*1024*1024)throw new DomainError("Audio exceeds 40MB",413);chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  const wav=bytes.length>128&&bytes.subarray(0,4).toString()==="RIFF"&&bytes.subarray(8,12).toString()==="WAVE";
  const mp3=bytes.length>128&&(bytes.subarray(0,3).toString()==="ID3" || (bytes[0]===255&&(bytes[1]&224)===224));
  if(type==="audio/mpeg"&&!mp3 || type!=="audio/mpeg"&&!wav)throw new DomainError("Invalid audio signature",400);
  return {bytes,mime:type==="audio/mpeg"?"audio/mpeg":"audio/wav",extension:type==="audio/mpeg"?"mp3":"wav"};
}
export class StudioAPI{
  constructor({store,vault,composer,localComposer,articleImporter=importArticle,draw,chatgptImages,sunoBrowser,chatgptLyrics=null,nativeChatgptOptions={},assetDir=process.env.BLOSSOM_ASSET_DIR||".data/assets"}={}){
    this.store=store;this.vault=vault;this.studio=new StudioStore(store);
    this.nativeChatgptOptions=nativeChatgptOptions;
    this.references=new StudioReferences(store,this.studio,new MusicDNA(store));
    this.composer=composer||new OpenAIComposer();
    this.localComposer=localComposer||new LocalComposer();
    this.articleImporter=articleImporter;
    this.draw=draw||new DrawThings({directory:assetDir});
    this.assetDir=assetDir;
    this.chatgptImages=chatgptImages||new ChatGptImages({directory:assetDir});
    this.sunoBrowser=sunoBrowser||new VisibleBrowserSession("suno");
    this.chatgptLyrics=chatgptLyrics||new ChatGptLyricsBrowser({
      transport:process.platform==="darwin"?"system":"playwright"
    });
  }
  async projectWithArticle(id) {
    const project=this.studio.require(id);
    if(project.article?.trim().length>=40)return project;
    if(!project.sourceUrl)throw new DomainError("Importeer of plak eerst een artikel",400);
    const imported=await this.articleImporter(project.sourceUrl);
    // Preserve operator-selected settings, title and metadata.
    return this.studio.save({...project,article:imported.text});
  }
  async handle(req,res,path) {
    if(req.method==="GET"){
      if(path==="/api/studio/projects")return send(res,200,this.studio.projects());
      if(path==="/api/studio/suno-browser/status")
        return send(res,200,this.sunoBrowser.status());
      const referencesGet=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/references$/);
      if(referencesGet)return send(res,200,{references:this.references.list(referencesGet[1])});
      if(path==="/api/studio/presets")return send(res,200,LENGTH_PRESETS);
      if(path==="/api/studio/status")return send(res,200,{
        openaiConfigured:!!(this.vault.list().openai_api_key?.configured||process.env.OPENAI_API_KEY||this.composer.key),
        localAI:await this.localComposer.status(),
        studioVersion:"chatgpt-assets-v2",drawConfigured:false,imageProvider:"chatgpt",generationMode:"ChatGPT in signed-in Safari; results saved automatically",
        sunoGeneration:"manual authorized handoff"});
      if(path==="/api/studio/artists/presets")
        return send(res,200,Object.fromEntries(this.store.artists().map(a=>[a.id,this.studio.preset(a.id)])));
      let m=path.match(/^\/api\/studio\/assets\/([a-f0-9-]{36})\/content$/);
      if(m){
        const asset=this.studio.asset(m[1]);if(!asset)throw new DomainError("Asset not found",404);
        const data=await readFile(join(this.assetDir,asset.filename));
        res.writeHead(200,{"Content-Type":asset.mime,"Content-Length":data.length,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});
        res.end(data);return;
      }
      m=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/(assets|recipe)$/);
      if(m){const p=this.studio.require(m[1]);
        return send(res,200,m[2]==="assets"?this.studio.assets(p.id):{...sunoRecipe(p,this.references.recipeStyle(p.id)),selectedAssets:this.studio.assets(p.id).filter(a=>a.selected)});}
      if(path==="/api/studio/chatgpt-lyrics/status")
        return send(res,200,await this.chatgptLyrics.progress());
      throw new DomainError("Not found",404);
    }
    if(req.method!=="POST")throw new DomainError("Method not allowed",405);
    const upload=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/upload-audio$/);
    if(upload){
      this.studio.require(upload[1]);
      const {bytes,mime,extension}=await audioBuffer(req);
      await mkdir(this.assetDir,{recursive:true,mode:0o700});
      const filename=randomUUID()+"."+extension;
      await writeFile(join(this.assetDir,filename),bytes,{flag:"wx",mode:0o600});
      return send(res,201,this.studio.registerAsset(upload[1],"audio",filename,mime,{provider:"upload",briefFingerprint:studioBriefFingerprint(this.studio.require(upload[1]))}));
    }
    const data=await readJSON(req);
    const assetAction=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/assets\/([a-f0-9-]{36})\/(select|delete)$/);
    if(assetAction){
      const [,projectId,assetId,action]=assetAction;
      return send(res,200,action==="select"?this.studio.selectAsset(projectId,assetId,data?.kind):this.studio.deleteAsset(projectId,assetId));
    }
    if(path==="/api/studio/articles/import"){
      const imported=await this.articleImporter(data?.url);
      return send(res,200,imported);
    }
    // Compatibility: old Studio buttons call chatgpt-extract. Do NOT launch
    // browser automation or claim that a ChatGPT Safari login is API access.
    const localExtract=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/chatgpt-extract$/);
    if(localExtract){
      const project=await this.projectWithArticle(localExtract[1]);
      const composed=await this.localComposer.generate({
        ...project,artistDna:this.store.artist(project.artistId)?.dna||"",
        referenceDna:this.references.generationContext(project.id)
      });
      return send(res,200,this.studio.setResult(project.id,composed));
    }
    const chatgptLyricsRoute=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/chatgpt-lyrics$/);
    if(chatgptLyricsRoute){
      const project=await this.projectWithArticle(chatgptLyricsRoute[1]);
      const composed=await this.chatgptLyrics.generate({
        ...project,artistCandidates:this.store.artists(),artistLanguage:this.store.artist(project.artistId)?.language||"",artistDna:this.store.artist(project.artistId)?.dna||"",
        referenceDna:this.references.generationContext(project.id)
      });
      if(typeof this.chatgptLyrics.notePercent==="function")await this.chatgptLyrics.notePercent(96);
      const saved=this.studio.setResult(project.id,composed);
      if(typeof this.chatgptLyrics.notePercent==="function")await this.chatgptLyrics.notePercent(100);
      return send(res,200,saved);
    }
    if(path==="/api/studio/projects")return send(res,201,this.studio.save(data));
    const sunoBrowserAction=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/suno-browser\/(open|prefill|close)$/);
    if(sunoBrowserAction){
      const p=this.studio.require(sunoBrowserAction[1]),op=sunoBrowserAction[2];
      if(op==="open")return send(res,200,await this.sunoBrowser.open());
      if(op==="close")return send(res,200,await this.sunoBrowser.close());
      const recipe=sunoRecipe(p,this.references.recipeStyle(p.id));
      const result=await this.sunoBrowser.prefill(recipe);
      this.store.audit("supervised_browser_prefill","studio_project",p.id,{filled:result.filled,skipped:result.skipped});
      return send(res,200,result);
    }
    const referencesPost=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/references$/);
    if(referencesPost)return send(res,200,{references:this.references.set(referencesPost[1],data?.references)});
    if(path==="/api/studio/openai-key"){
      if(data&&Object.hasOwn(data,"password"))throw new DomainError("Use an OpenAI API key, never a ChatGPT website password");
      this.vault.save("openai_api_key","OpenAI API",data?.apiKey);
      this.store.audit("connection_updated","integration","openai");return send(res,200,this.vault.list());
    }
    if(path==="/api/studio/openai-key/remove"){
      this.vault.delete("openai_api_key");return send(res,200,this.vault.list());
    }
    let match=path.match(/^\/api\/studio\/artists\/([a-f0-9-]{36})\/preset$/);
    if(match)return send(res,200,this.studio.savePreset(match[1],data));
    match=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/(extract|ask|create-track|generate-art)$/);
    const resultMatch=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/result$/);
    if(resultMatch)return send(res,200,this.studio.setResult(resultMatch[1],data));
    if(!match)throw new DomainError("Not found",404);
    const p=this.studio.require(match[1]),operation=match[2];
    if(operation==="create-track")return send(res,201,this.studio.makeTrack(p.id));
    const key=this.vault.list().openai_api_key?.configured?this.vault.read("openai_api_key"):null;
    const hasAPIKey=!!(key||this.composer.key);
    if(operation==="extract"){
      const articleProject=await this.projectWithArticle(p.id);
      const context={...articleProject,artistDna:this.store.artist(articleProject.artistId)?.dna||"",
        referenceDna:this.references.generationContext(p.id)};
      const result=hasAPIKey?await this.composer.generate(context,key):
        await this.localComposer.generate(context);
      return send(res,200,this.studio.setResult(p.id,result));
    }
    if(operation==="ask")return send(res,200,hasAPIKey?
      await this.composer.ask(data?.question,p,key):
      await this.localComposer.ask(data?.question,p));
    if(operation==="generate-art"){
      const kind=data?.kind;
      if(!["cover","artist-photo"].includes(kind))throw new DomainError("Invalid asset type",400);
      const defaultPrompt=kind==="cover"?p.result?.coverPrompt:p.result?.artistPhotoPrompt;
      const prompt=data?.prompt||defaultPrompt;
      const context={title:sunoRecipe(p).title,concept:p.result?.concept||"",lyrics:p.result?.lyrics||"",genre:p.parameters.genre,
        artistName:this.store.artist(p.artistId)?.name||"",artistDna:this.store.artist(p.artistId)?.dna||""};
      const generated=await this.chatgptImages.generate({kind,prompt,context});
      const asset=this.studio.registerAsset(p.id,kind,generated.filename,generated.mime,
        {provider:"chatgpt",prompt,briefFingerprint:studioBriefFingerprint(p)});
      // Show the first imported image immediately; preserve an existing selection.
      if(!this.studio.assets(p.id).some(a=>a.kind===kind&&a.selected))
        this.studio.selectAsset(p.id,asset.id,kind);
      return send(res,201,this.studio.assets(p.id).find(a=>a.id===asset.id));
    }
    throw new DomainError("Not found",404);
  }
}
