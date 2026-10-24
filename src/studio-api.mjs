import { inputFingerprint } from "./studio-integrity.mjs";
import { MusicDNA } from "./music-dna.mjs";
import { StudioReferences } from "./music-dna-studio.mjs";
import { StudioStore, LENGTH_PRESETS, sunoRecipe, studioBriefFingerprint } from "./studio.mjs";
import { OpenAIComposer } from "./providers/openai.mjs";
import { DrawThings } from "./drawthings.mjs";
import { ChatGptImages } from "./chatgpt-images.mjs";
import { DomainError } from "./domain.mjs";
import { SunoBrowserHandoff } from "./suno-playwright.mjs";
import { LocalComposer } from "./providers/local.mjs";
import { SunoPlatform, sunoReady, fetchSunoAudio, trustedSunoAudioUrl } from "./providers/suno-platform.mjs";
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
  constructor({store,vault,composer,localComposer,articleImporter=importArticle,draw,chatgptImages,sunoBrowser,sunoPlatform,sunoAudioFetcher=fetch,chatgptLyrics=null,nativeChatgptOptions={},assetDir=process.env.BLOSSOM_ASSET_DIR||".data/assets"}={}){
    this.store=store;this.vault=vault;this.studio=new StudioStore(store);
    this.nativeChatgptOptions=nativeChatgptOptions;
    this.references=new StudioReferences(store,this.studio,new MusicDNA(store));
    this.composer=composer||new OpenAIComposer();
    this.localComposer=localComposer||new LocalComposer();
    this.articleImporter=articleImporter;
    this.draw=draw||new DrawThings({directory:assetDir});
    this.assetDir=assetDir;
    this.chatgptImages=chatgptImages||new ChatGptImages({directory:assetDir});
    this.sunoBrowser=sunoBrowser||new SunoBrowserHandoff();
    this.sunoPlatform=sunoPlatform||new SunoPlatform();
    this.sunoAudioFetcher=sunoAudioFetcher;
    this.sunoInFlight=new Set();
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
    return this.studio.save({...project,article:imported.text,expectedRevision:project.revision});
  }
  async handle(req,res,path,query=new URLSearchParams()) {
    if(req.method==="GET"){
      if(path==="/api/studio/projects/page"){
        const page=this.studio.projectPage({limit:query.has("limit")?Number(query.get("limit")):50,cursor:query.get("cursor"),q:query.get("q")||""});
        return send(res,200,{...page,results:page.results.map(p=>({...p,sunoJob:this.studio.sunoJob(p.id)}))});
      }
      if(path==="/api/studio/inventory")return send(res,200,this.studio.inventory());
      const versions=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/(history|takes)$/);
      if(versions)return send(res,200,versions[2]==="history"?this.studio.history(versions[1]):this.studio.sunoJobs(versions[1]));
      const projectGet=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})$/);
      if(projectGet){const p=this.studio.require(projectGet[1]);return send(res,200,{...p,sunoJob:this.studio.sunoJob(p.id)});}
      if(path==="/api/studio/projects")return send(res,200,this.studio.projects().map(p=>({...p,sunoJob:this.studio.sunoJob(p.id)})));
      const legacyPhoto=path.match(/^\/api\/studio\/artists\/([a-f0-9-]{36})\/photo$/);
      if(legacyPhoto){
        const selected=this.studio.artistBanners()[legacyPhoto[1]];
        const image=selected&&this.studio.artistImage(selected.assetId);
        if(!image)throw new DomainError("Artist photo not found",404);
        const bytes=await readFile(join(this.assetDir,image.filename));
        res.writeHead(200,{"Content-Type":image.mime,"Content-Length":bytes.length,
          "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});
        res.end(bytes);return;
      }
      if(path==="/api/studio/suno-browser/status")
        return send(res,200,this.sunoBrowser.status());
      const sunoStatusPath=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/suno\/status$/);
      if(sunoStatusPath){
        const projectId=sunoStatusPath[1],job=this.studio.sunoJob(projectId);
        if(!job)return send(res,200,{status:"not_started"});
        if(job.status==="complete"||job.status==="error"||job.status==="failed")
          return send(res,200,job);
        const key=this.vault.list().suno_api_key?.configured?this.vault.read("suno_api_key"):null;
        if(!key)return send(res,200,{...job,warning:"Suno API key unavailable; generation status cannot be refreshed"});
        const remote=await this.sunoPlatform.status(job.id,key);
        const updated=this.studio.updateSunoJob(projectId,job.id,remote);
        return send(res,200,updated);
      }
      const referencesGet=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/references$/);
      if(referencesGet)return send(res,200,{references:this.references.list(referencesGet[1])});
      if(path==="/api/studio/presets")return send(res,200,LENGTH_PRESETS);
      if(path==="/api/studio/status")return send(res,200,{
        openaiConfigured:!!(this.vault.list().openai_api_key?.configured||process.env.OPENAI_API_KEY||this.composer.key),
        localAI:await this.localComposer.status(),
        studioVersion:"chatgpt-assets-v2",drawConfigured:false,imageProvider:"chatgpt",generationMode:"ChatGPT in signed-in Safari; results saved automatically",
        sunoGeneration:"official API when configured; otherwise authorized manual handoff",
        sunoApiConfigured:!!this.vault.list().suno_api_key?.configured});
      if(path==="/api/studio/artists/banners")
        return send(res,200,this.studio.artistBanners());
      if(path==="/api/studio/artists/images")
        return send(res,200,this.studio.allArtistImages());
      let artistMedia=path.match(/^\/api\/studio\/artist-images\/([a-f0-9-]{36})\/content$/);
      if(artistMedia){
        const image=this.studio.artistImage(artistMedia[1]);
        if(!image)throw new DomainError("Artist image not found",404);
        const bytes=await readFile(join(this.assetDir,image.filename));
        res.writeHead(200,{"Content-Type":image.mime,"Content-Length":bytes.length,
          "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});
        res.end(bytes);return;
      }
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
    if(req.method==="PATCH"){
      const target=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})$/);
      if(!target)throw new DomainError("Not found",404);
      const data=await readJSON(req);return send(res,200,this.studio.patch(target[1],data?.changes,{expectedRevision:data?.expectedRevision,baseValues:data?.baseValues}));
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
    const sunoAction=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/suno\/(generate|import)$/);
    if(sunoAction){
      const projectId=sunoAction[1],operation=sunoAction[2];
      const project=this.studio.require(projectId);
      const key=this.vault.list().suno_api_key?.configured?this.vault.read("suno_api_key"):null;
      if(operation==="generate"){
        if(!key)throw new DomainError("Suno Platform API key required for automatic music generation. Otherwise use the manual Suno handoff.",409);
        const readiness=sunoReady(project);
        if(!readiness.ready)throw new DomainError("Not ready for Suno: "+readiness.missing.join("; "),409);
        if(this.sunoInFlight.has(projectId)||this.studio.sunoJob(projectId)&&
          !["error","failed"].includes(this.studio.sunoJob(projectId).status)&&!this.studio.sunoJob(projectId).importedAssetId)
          throw new DomainError("This project already has a Suno generation",409);
        this.sunoInFlight.add(projectId);
        try{
          const recipe=sunoRecipe(project,this.references.recipeStyle(projectId));
          const submitted=await this.sunoPlatform.submit(recipe,key);
          return send(res,202,this.studio.beginSunoJob(projectId,submitted.id,submitted.status,recipe,studioBriefFingerprint(project)));
        }finally{this.sunoInFlight.delete(projectId);}
      }
      const job=this.studio.sunoJob(projectId);
      if(!job||job.status!=="complete"||!job.audioUrl||job.importedAssetId)
        throw new DomainError("A completed, unimported Suno audio result is required",409);
      if(this.sunoInFlight.has(projectId))throw new DomainError("Suno import already in progress",409);
      this.sunoInFlight.add(projectId);
      try{
        // Only allow known Suno media hosts; forbid redirects and invalid audio bytes.
        const {bytes,mime,extension}=await fetchSunoAudio(trustedSunoAudioUrl(job.audioUrl),{fetcher:this.sunoAudioFetcher});
        await mkdir(this.assetDir,{recursive:true,mode:0o700});
        const filename=randomUUID()+"."+extension;
        await writeFile(join(this.assetDir,filename),bytes,{flag:"wx",mode:0o600});
        const asset=this.studio.registerAsset(projectId,"audio",filename,mime,
          {provider:"suno",briefFingerprint:job.briefFingerprint||""});
        this.studio.selectAsset(projectId,asset.id,"audio");
        if(!project.trackId&&job.recipe?.source?.artistId)this.studio.makeTrack(projectId,{sourceRevision:job.recipe.source.revision});
        this.studio.markSunoImported(projectId,job.id,asset.id);
        return send(res,201,{job:this.studio.sunoJob(projectId),asset});
      }finally{this.sunoInFlight.delete(projectId);}
    }
    const artistPhotoGenerate=path.match(/^\/api\/studio\/artists\/([a-f0-9-]{36})\/generate-photo$/);
    if(artistPhotoGenerate){
      const artist=this.store.artist(artistPhotoGenerate[1]);
      if(!artist)throw new DomainError("Artist not found",404);
      const prompt=String(data?.prompt||(
        "Wide cinematic artist publicity photograph for a fictional "+artist.genre+
        " musician or group, "+artist.name+". Artistic identity: "+artist.dna+
        ". Professional editorial band photo; 16:9 landscape with negative space at bottom left."
      )).trim();
      if(prompt.length<10||prompt.length>4000)
        throw new DomainError("Artist photo prompt must be 10–4000 characters",400);
      const generated=await this.chatgptImages.generate({
        kind:"artist-photo",prompt,context:{
          artistName:artist.name,artistDna:artist.dna,genre:artist.genre,
          voice:artist.voice,language:artist.language
        }
      });
      return send(res,201,this.studio.registerArtistPhoto(artist.id,{
        filename:generated.filename,mime:generated.mime,provider:"chatgpt",prompt
      }));
    }
    const artistMediaAction=path.match(/^\/api\/studio\/artists\/([a-f0-9-]{36})\/images\/([a-f0-9-]{36})\/(select|delete)$/);
    if(artistMediaAction)
      return send(res,200,artistMediaAction[3]==="select"?
        this.studio.selectArtistImage(artistMediaAction[1],artistMediaAction[2]):
        this.studio.deleteArtistImage(artistMediaAction[1],artistMediaAction[2]));
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
      return send(res,200,this.studio.setResult(project.id,composed,{expectedRevision:project.revision,expectedInputHash:inputFingerprint(project),generated:true}));
    }
    const chatgptLyricsRoute=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/chatgpt-lyrics$/);
    if(chatgptLyricsRoute){
      const project=await this.projectWithArticle(chatgptLyricsRoute[1]);
      const composed=await this.chatgptLyrics.generate({
        ...project,artistCandidates:this.store.artists(),artistLanguage:this.store.artist(project.artistId)?.language||"",artistDna:this.store.artist(project.artistId)?.dna||"",
        referenceDna:this.references.generationContext(project.id)
      });
      if(typeof this.chatgptLyrics.notePercent==="function")await this.chatgptLyrics.notePercent(96);
      const saved=this.studio.setResult(project.id,composed,{expectedRevision:project.revision,expectedInputHash:inputFingerprint(project),generated:true});
      if(typeof this.chatgptLyrics.notePercent==="function")await this.chatgptLyrics.notePercent(100);
      return send(res,200,saved);
    }
    if(path==="/api/studio/projects")return send(res,201,this.studio.save(data));
    const sunoBrowserAction=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/suno-browser\/(open|prefill|submit|download|close)$/);
    if(sunoBrowserAction){
      const p=this.studio.require(sunoBrowserAction[1]),op=sunoBrowserAction[2];
      if(op==="open")return send(res,200,await this.sunoBrowser.open());
      if(op==="close")return send(res,200,await this.sunoBrowser.close());
      if(op==="download"){
        await mkdir(this.assetDir,{recursive:true,mode:0o700});
        const filename=randomUUID()+".mp3",location=join(this.assetDir,filename);
        await this.sunoBrowser.downloadSelected(location);
        const bytes=await readFile(location);
        if(bytes.length<128 || !(bytes.subarray(0,3).toString()==="ID3" || bytes[0]===255&&(bytes[1]&224)===224))
          throw new DomainError("Downloaded file is not valid MP3 audio",400);
        const asset=this.studio.registerAsset(p.id,"audio",filename,"audio/mpeg",
          {provider:"suno",briefFingerprint:studioBriefFingerprint(p)});
        this.studio.selectAsset(p.id,asset.id,"audio");
        if(!p.trackId && p.artistId && p.result?.concept)this.studio.makeTrack(p.id);
        return send(res,201,{asset});
      }
      const ready=sunoReady(p);if(op==="submit"&&!ready.ready)throw new DomainError("Not ready for Suno: "+ready.missing.join("; "),409);
      const recipe=sunoRecipe(p,this.references.recipeStyle(p.id));
      const result=op==="submit"?await this.sunoBrowser.submit(recipe):await this.sunoBrowser.prefill(recipe);
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
    const lyricsMatch=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/lyrics$/);
    if(lyricsMatch){
      if(typeof data?.lyrics!=="string"||data.lyrics.length>12000)throw new DomainError("Invalid lyrics",400);
      const p=this.studio.require(lyricsMatch[1]);
      return send(res,200,this.studio.setResult(p.id,{...p.result,lyrics:data.lyrics},{applyParameters:false,expectedRevision:data.expectedRevision}));
    }
    const resultMatch=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/result$/);
    if(resultMatch)return send(res,200,this.studio.setResult(resultMatch[1],data,{expectedRevision:data.expectedRevision}));
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
      return send(res,200,this.studio.setResult(p.id,result,{expectedRevision:articleProject.revision,expectedInputHash:inputFingerprint(articleProject),generated:true}));
    }
    if(operation==="ask")return send(res,200,hasAPIKey?
      await this.composer.ask(data?.question,p,key):
      await this.localComposer.ask(data?.question,p));
    if(operation==="generate-art"){
      const kind=data?.kind;
      if(!["cover","artist-photo"].includes(kind))throw new DomainError("Invalid asset type",400);
      if(kind==="artist-photo"&&!p.artistId)
        throw new DomainError("Choose an artist before generating their photo",409);
      const defaultPrompt=kind==="cover"?p.result?.coverPrompt:p.result?.artistPhotoPrompt;
      const prompt=data?.prompt||defaultPrompt;
      const context={title:sunoRecipe(p).title,concept:p.result?.concept||"",lyrics:p.result?.lyrics||"",genre:p.parameters.genre,
        artistName:this.store.artist(p.artistId)?.name||"",artistDna:this.store.artist(p.artistId)?.dna||""};
      const generated=await this.chatgptImages.generate({kind,prompt,context});
      const asset=this.studio.registerAsset(p.id,kind,generated.filename,generated.mime,
        {provider:"chatgpt",prompt,briefFingerprint:studioBriefFingerprint(p)});
      // Artist photos are artist-owned assets as well as Studio source assets.
      // New variants join the artist's library without replacing the chosen banner.
      if(kind==="artist-photo")this.studio.linkArtistImage(p.artistId,asset.id);
      // Show the first imported image immediately; preserve an existing selection.
      if(!this.studio.assets(p.id).some(a=>a.kind===kind&&a.selected))
        this.studio.selectAsset(p.id,asset.id,kind);
      return send(res,201,this.studio.assets(p.id).find(a=>a.id===asset.id));
    }
    throw new DomainError("Not found",404);
  }
}
