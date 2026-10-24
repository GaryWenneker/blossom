import { MusicDNA } from "./music-dna.mjs";
import { StudioReferences, artistMusicStyle, artistMusicTraits } from "./music-dna-studio.mjs";
import { artistBannerPrompt, selectBannerSongs } from "./artist-banner-prompt.mjs";
import { coverArtPrompt } from "./cover-art-prompt.mjs";
import { StudioStore, LENGTH_PRESETS, sunoRecipe, studioBriefFingerprint } from "./studio.mjs";
import { OpenAIComposer } from "./providers/openai.mjs";
import { DrawThings } from "./drawthings.mjs";
import { ChatGptImages } from "./chatgpt-images.mjs";
import { DomainError } from "./domain.mjs";
import { SunoBrowserHandoff } from "./suno-playwright.mjs";
import { LocalComposer } from "./providers/local.mjs";
import { SunoPlatform, sunoReady, fetchSunoAudio, trustedSunoAudioUrl } from "./providers/suno-platform.mjs";
import { ChatGptLyricsBrowser, parseChatGptBrief } from "./chatgpt-playwright.mjs";
import { importArticle } from "./article-import.mjs";
import { mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { copySunoMp3s, sunoImageFile, titleDownloadMp3s } from "./suno-system-browser.mjs";
import { randomUUID } from "node:crypto";
import { validateUploadedImage } from "./image-bytes.mjs";

const send=(res,code,data)=>{res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data));};
async function coverInside(assetDir,candidate){
  if(!candidate)return null;
  try{
    const root=await realpath(assetDir),file=await realpath(candidate);
    const prefix=root.endsWith(sep)?root:root+sep;
    if(!file.startsWith(prefix)||!(file.endsWith(".png")||file.endsWith(".jpg")))return null;
    return file;
  }catch{return null;}
}
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
async function imageUpload(req){
  const type=String(req.headers["content-type"]||"").split(";")[0];
  const chunks=[];let length=0;
  for await(const chunk of req){
    length+=chunk.length;
    if(length>12*1024*1024)throw new DomainError("Image exceeds 12MB",413);
    chunks.push(chunk);
  }
  const checked=validateUploadedImage(Buffer.concat(chunks),type);
  return {bytes:Buffer.concat(chunks),...checked};
}
async function saveImage(assetDir,image){
  await mkdir(assetDir,{recursive:true,mode:0o700});
  const filename=randomUUID()+"."+image.extension;
  await writeFile(join(assetDir,filename),image.bytes,{flag:"wx",mode:0o600});
  return filename;
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
    this.sunoHarvest=new Map();
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
  extractionProject(project){
    const artist=project.artistId?this.store.artist(project.artistId):null;
    const artistMusicDna=artistMusicTraits(artist?.name?this.references.dna.profilesForArtist(artist.name):[]);
    return {...project,
      artistLanguage:artist?.language||"",
      artistCandidates:this.store.artists(),
      artistDna:artist?.dna||"",
      artistMusicDna,
      referenceDna:this.references.generationContext(project.id)};
  }
  sunoBrief(project){
    const context=this.extractionProject(project);
    const inspiration=[this.references.recipeStyle(project.id),artistMusicStyle(context.artistMusicDna)].filter(Boolean).join(", ");
    return sunoRecipe(context,inspiration);
  }

  bannerPromptSources(artist, project){
    const songs=selectBannerSongs(this.studio.projects(),{
      ...(project?{project}:{}),artistId:artist.id});
    const analyzedStyle=artistMusicStyle(artistMusicTraits(
      artist?.name?this.references.dna.profilesForArtist(artist.name):[]));
    return {songs,analyzedStyle,projectStyle:project?this.references.recipeStyle(project.id):""};
  }
  beginSunoHarvest(projectId, recipe, imageFile) {
    if (this.sunoHarvest.get(projectId)?.status === "waiting") return;
    this.sunoHarvest.set(projectId, {status:"waiting", art:"none", imported:0, error:""});
    void this.finishSunoHarvest(projectId, recipe, imageFile);
  }

  async finishSunoHarvest(projectId, recipe, imageFile) {
    try {
      const harvested = await this.sunoBrowser.harvest(recipe, {imageFile});
      const project = this.studio.require(projectId);
      if (!harvested.audioFiles.length) harvested.audioFiles = await titleDownloadMp3s(recipe?.title);
      const filenames = await copySunoMp3s(harvested.audioFiles, {assetDir:this.assetDir});
      if (!filenames.length) {
        const missingCover = harvested.art === "missing";
        this.sunoHarvest.set(projectId, {
          status:"error", art:harvested.art, imported:0,
          error: missingCover
            ? "The cover image was not placed on the Suno song, and Suno did not download an MP3."
            : "Suno did not download the MP3."
        });
        return;
      }
      const assets = filenames.map(filename => this.studio.registerAsset(projectId, "audio", filename, "audio/mpeg", {
        provider:"suno", briefFingerprint:studioBriefFingerprint(project)
      }));
      if (assets[0]) this.studio.selectAsset(projectId, assets[0].id, "audio");
      let imported = 0;
      if (assets.length && project.artistId && project.result?.concept) {
        imported = this.studio.linkSunoTakes(projectId, assets.map(asset => asset.id)).length;
      }
      this.sunoHarvest.set(projectId, {status:"done", art:harvested.art, imported, error:""});
    } catch (error) {
      this.sunoHarvest.set(projectId, {
        status:"error", art:"none", imported:0,
        error:error instanceof DomainError ? error.message : "Could not import the generated Suno songs"
      });
    }
  }

  async handle(req,res,path) {
    if(req.method==="GET"){
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
      const harvestPath=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/suno-browser\/harvest$/);
      if(harvestPath){
        this.studio.require(harvestPath[1]);
        return send(res,200,this.sunoHarvest.get(harvestPath[1])||{status:"idle",art:"none",imported:0,error:""});
      }
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
      if(path==="/api/studio/artwork")return send(res,200,this.studio.linkedArtwork());
      if(path==="/api/studio/artists/banners")
        return send(res,200,this.studio.artistBanners());
      if(path==="/api/studio/artists/covers")
        return send(res,200,this.studio.artistCovers());
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
        return send(res,200,m[2]==="assets"?this.studio.assets(p.id):{...this.sunoBrief(p),selectedAssets:this.studio.assets(p.id).filter(a=>a.selected)});}
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
    const bannerUpload=path.match(/^\/api\/studio\/artists\/([a-f0-9-]{36})\/upload-banner$/);
    if(bannerUpload){
      const artist=this.store.artist(bannerUpload[1]);
      if(!artist)throw new DomainError("Artist not found",404);
      const image=await imageUpload(req);
      const filename=await saveImage(this.assetDir,image);
      return send(res,201,this.studio.registerArtistPhoto(artist.id,{filename,mime:image.mime,provider:"upload"}));
    }
    const pictureUpload=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/upload-image\/(cover|track-art|artist-photo)$/);
    if(pictureUpload){
      const project=this.studio.require(pictureUpload[1]),kind=pictureUpload[2];
      if(kind==="artist-photo"&&!project.artistId)
        throw new DomainError("Choose an artist before uploading their banner",409);
      const image=await imageUpload(req);
      const filename=await saveImage(this.assetDir,image);
      const asset=this.studio.registerAsset(project.id,kind,filename,image.mime,{
        provider:"upload",artistId:kind==="cover"?project.artistId:""});
      if(kind==="artist-photo")this.studio.linkArtistImage(project.artistId,asset.id);
      if(kind==="cover"||!this.studio.assets(project.id).some(item=>item.kind===kind&&item.selected))
        this.studio.selectAsset(project.id,asset.id,kind);
      return send(res,201,this.studio.assets(project.id).find(item=>item.id===asset.id));
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
          !["error","failed"].includes(this.studio.sunoJob(projectId).status))
          throw new DomainError("This project already has a Suno generation",409);
        this.sunoInFlight.add(projectId);
        try{
          const recipe=this.sunoBrief(project);
          const submitted=await this.sunoPlatform.submit(recipe,key);
          return send(res,202,this.studio.beginSunoJob(projectId,submitted.id,submitted.status));
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
          {provider:"suno",briefFingerprint:studioBriefFingerprint(project)});
        this.studio.selectAsset(projectId,asset.id,"audio");
        if(!project.trackId&&project.artistId&&project.result?.concept)this.studio.makeTrack(projectId);
        this.studio.markSunoImported(projectId,job.id,asset.id);
        return send(res,201,{job:this.studio.sunoJob(projectId),asset});
      }finally{this.sunoInFlight.delete(projectId);}
    }
    const artistPhotoGenerate=path.match(/^\/api\/studio\/artists\/([a-f0-9-]{36})\/generate-photo$/);
    if(artistPhotoGenerate){
      const artist=this.store.artist(artistPhotoGenerate[1]);
      if(!artist)throw new DomainError("Artist not found",404);
      const sources=this.bannerPromptSources(artist);
      const prompt=artistBannerPrompt({
        artist,
        songs:sources.songs,
        analyzedStyle:sources.analyzedStyle,
        userPrompt:typeof data?.prompt==="string"?data.prompt:""
      });
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
    const artistMediaAction=path.match(/^\/api\/studio\/artists\/([a-f0-9-]{36})\/images\/([a-f0-9-]{36})\/(select|delete|focus)$/);
    if(artistMediaAction){
      const [,artistId,imageId,action]=artistMediaAction;
      if(action==="select")return send(res,200,this.studio.selectArtistImage(artistId,imageId));
      if(action==="delete")return send(res,200,this.studio.deleteArtistImage(artistId,imageId));
      return send(res,200,this.studio.setArtistImageFocus(artistId,imageId,data));
    }
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
      const composed=await this.localComposer.generate(this.extractionProject(project));
      return send(res,200,this.studio.setResult(project.id,composed));
    }
    const chatgptLyricsRoute=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/chatgpt-lyrics$/);
    if(chatgptLyricsRoute){
      const project=await this.projectWithArticle(chatgptLyricsRoute[1]);
      const composed=await this.chatgptLyrics.generate(this.extractionProject(project));
      if(typeof this.chatgptLyrics.notePercent==="function")await this.chatgptLyrics.notePercent(96);
      const saved=this.studio.setResult(project.id,composed);
      if(typeof this.chatgptLyrics.notePercent==="function")await this.chatgptLyrics.notePercent(100);
      return send(res,200,saved);
    }
    const pasteBriefRoute=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/paste-brief$/);
    if(pasteBriefRoute){
      const project=this.studio.require(pasteBriefRoute[1]);
      const text=typeof data?.text==="string"?data.text.trim():"";
      if(!text)throw new DomainError("Paste the song JSON first",400);
      let composed;
      try{composed=parseChatGptBrief(text);}
      catch(error){
        if(error?.code==="chatgpt_reply_invalid")
          throw new DomainError("Paste a song JSON brief that includes lyrics and style",400);
        throw error;
      }
      return send(res,200,this.studio.setResult(project.id,composed));
    }
    if(path==="/api/studio/projects")return send(res,201,this.studio.save(data));
    const projectDelete=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/delete$/);
    if(projectDelete){
      const removed=this.studio.deleteProject(projectDelete[1]);
      for(const filename of removed.removedFiles){
        if(!/^[0-9a-f-]{36}\.(?:png|wav|mp3)$/.test(filename))continue;
        await rm(join(this.assetDir,filename),{force:true});
      }
      return send(res,200,{deleted:removed.id});
    }
    const sunoBrowserAction=path.match(/^\/api\/studio\/projects\/([a-f0-9-]{36})\/suno-browser\/(open|prefill|submit|download|close)$/);
    if(sunoBrowserAction){
      const p=this.studio.require(sunoBrowserAction[1]),op=sunoBrowserAction[2];
      if(op==="open")return send(res,200,await this.sunoBrowser.open());
      if(op==="close")return send(res,200,await this.sunoBrowser.close());
      if(op==="download"){
        await mkdir(this.assetDir,{recursive:true,mode:0o700});
        const recipe=this.sunoBrief(p);
        const imageFile=await coverInside(this.assetDir,sunoImageFile(this.studio,p.id,this.assetDir));
        const filename=randomUUID()+".mp3",location=join(this.assetDir,filename);
        const saved=await this.sunoBrowser.downloadSelected(location,{recipe,imageFile});
        const bytes=await readFile(location);
        if(bytes.length<128 || !(bytes.subarray(0,3).toString()==="ID3" || bytes[0]===255&&(bytes[1]&224)===224))
          throw new DomainError("Downloaded file is not valid MP3 audio",400);
        const asset=this.studio.registerAsset(p.id,"audio",filename,"audio/mpeg",
          {provider:"suno",briefFingerprint:studioBriefFingerprint(p)});
        this.studio.selectAsset(p.id,asset.id,"audio");
        const assets=[asset];
        for(const extra of (saved.audioFiles||[]).slice(1)){
          const [extraName]=await copySunoMp3s([extra],{assetDir:this.assetDir});
          if(!extraName)continue;
          assets.push(this.studio.registerAsset(p.id,"audio",extraName,"audio/mpeg",
            {provider:"suno",briefFingerprint:studioBriefFingerprint(p)}));
        }
        if(assets.length>=2 && p.artistId && p.result?.concept)
          this.studio.linkSunoTakes(p.id,assets.map(item=>item.id));
        else if(!p.trackId && p.artistId && p.result?.concept)this.studio.makeTrack(p.id);
        return send(res,201,{asset,assets,cover:saved.art||"none"});
      }
      const recipe=this.sunoBrief(p);
      const result=op==="submit"?await this.sunoBrowser.submit(recipe):await this.sunoBrowser.prefill(recipe);
      if(op==="submit"&&typeof this.sunoBrowser.harvest==="function"){
        const imageFile=await coverInside(this.assetDir,sunoImageFile(this.studio,p.id,this.assetDir));
        this.beginSunoHarvest(p.id,recipe,imageFile);
        result.note="Suno is generating both songs. Blossom will place the track art and import both songs when they finish.";
      }
      this.store.audit("supervised_browser_prefill","studio_project",p.id,{filled:result.filled,skipped:result.skipped,cover:result.cover||"none"});
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
      const context=this.extractionProject(articleProject);
      const result=hasAPIKey?await this.composer.generate(context,key):
        await this.localComposer.generate(context);
      return send(res,200,this.studio.setResult(p.id,result));
    }
    if(operation==="ask")return send(res,200,hasAPIKey?
      await this.composer.ask(data?.question,p,key):
      await this.localComposer.ask(data?.question,p));
    if(operation==="generate-art"){
      const kind=data?.kind;
      if(!["cover","track-art","artist-photo"].includes(kind))throw new DomainError("Invalid asset type",400);
      if(kind==="artist-photo"&&!p.artistId)
        throw new DomainError("Choose an artist before generating their photo",409);
      const defaultPrompt=kind==="artist-photo"?p.result?.artistPhotoPrompt:p.result?.coverPrompt;
      const artistRecord=p.artistId?this.store.artist(p.artistId):null;
      let prompt=data?.prompt||defaultPrompt;
      const caller=typeof data?.prompt==="string"&&data.prompt.trim()?data.prompt:(defaultPrompt||"");
      if(kind==="artist-photo"){
        const sources=this.bannerPromptSources(artistRecord,p);
        prompt=artistBannerPrompt({
          artist:artistRecord,songs:sources.songs,analyzedStyle:sources.analyzedStyle,
          projectStyle:sources.projectStyle,userPrompt:caller
        });
      }
      if(kind==="cover"||kind==="track-art"){
        const sources=artistRecord
          ? this.bannerPromptSources(artistRecord,p)
          : {songs:selectBannerSongs(this.studio.projects(),{project:p}),analyzedStyle:"",projectStyle:this.references.recipeStyle(p.id)};
        prompt=coverArtPrompt({
          surface:kind==="track-art"?"track":"album",
          title:sunoRecipe(p).title,
          artist:artistRecord||{name:p.result?.artistName||"",genre:p.parameters?.genre||"",dna:""},
          songs:sources.songs,analyzedStyle:sources.analyzedStyle,
          projectStyle:sources.projectStyle,userPrompt:caller
        });
      }
      const context={title:sunoRecipe(p).title,concept:p.result?.concept||"",lyrics:p.result?.lyrics||"",genre:p.parameters.genre,
        artistName:artistRecord?.name||"",artistDna:artistRecord?.dna||""};
      const generated=await this.chatgptImages.generate({kind,prompt,context});
      const asset=this.studio.registerAsset(p.id,kind,generated.filename,generated.mime,
        {provider:"chatgpt",prompt,briefFingerprint:studioBriefFingerprint(p),
          artistId:kind==="cover"?p.artistId:""});
      // Artist photos are artist-owned assets as well as Studio source assets.
      // New variants join the artist's library without replacing the chosen banner.
      if(kind==="artist-photo")this.studio.linkArtistImage(p.artistId,asset.id);
      // A new album cover replaces the previous cover. Other kinds keep the first selection.
      if(kind==="cover"||!this.studio.assets(p.id).some(a=>a.kind===kind&&a.selected))
        this.studio.selectAsset(p.id,asset.id,kind);
      return send(res,201,this.studio.assets(p.id).find(a=>a.id===asset.id));
    }
    throw new DomainError("Not found",404);
  }
}
