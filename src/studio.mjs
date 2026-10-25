import { randomUUID, createHash } from "node:crypto";
import { DomainError } from "./domain.mjs";
import { applyProjectPatch } from "./studio-patches.mjs";
import { atomic,checkRevision,initializeIntegrity,inputFingerprint,snapshot,projectIntegrity,projectPage,inventory,referenceInputs } from "./studio-integrity.mjs";

export const LENGTH_PRESETS = Object.freeze({
  radio:{label:"Radio edit",seconds:205,min:165,max:240},
  streaming:{label:"Streaming single",seconds:180,min:120,max:240},
  focus:{label:"Focus / background",seconds:270,min:150,max:480},
  ambient:{label:"Ambient / sleep",seconds:420,min:240,max:900},
  custom:{label:"Custom",seconds:210,min:35,max:900}
});
export const LYRIC_LANGUAGES = Object.freeze({
  en:"English",nl:"Dutch",de:"German",fr:"French",es:"Spanish",it:"Italian",pt:"Portuguese"
});
export const DEFAULT_PARAMETERS = Object.freeze({
  sunoModel:"v6",lyricLanguage:"auto",genre:"Country Pop",additionalStyles:["Americana","Acoustic"],excludeStyles:["imitated voices","unlicensed samples"],
  vocalGender:"male",instrumental:false,maxMode:false,weirdness:22,styleInfluence:75,variety:40,
  personalize:false,durationPreset:"radio",targetSeconds:205,customInstructions:"",imagePrompt:"",artistPhotoPrompt:""
});
const parse=(text,fallback)=>{try{return JSON.parse(text)}catch{return fallback}};
const clean=(v,max=500)=>{if(typeof v!=="string")throw new DomainError("Expected text");return v.trim().slice(0,max)};
const uuid=()=>randomUUID();
function int(v,min,max,label){if(!Number.isInteger(v)||v<min||v>max)throw new DomainError(label+" must be "+min+"-"+max);return v;}
export function normalizeParameters(input={},base=DEFAULT_PARAMETERS){
  if(input===null || typeof input!=="object" || Array.isArray(input))throw new DomainError("Invalid parameters");
  const p={...base,...input};
  const preset=LENGTH_PRESETS[p.durationPreset];
  if(!preset)throw new DomainError("Invalid playlist length preset");
  p.targetSeconds=int(p.targetSeconds,preset.min,preset.max,"Target duration");
  for(const f of ["weirdness","styleInfluence","variety"])p[f]=int(p[f],0,100,f);
  for(const f of ["maxMode","instrumental","personalize"])if(typeof p[f]!=="boolean")throw new DomainError(f+" must be boolean");
  if(!["male","female","auto"].includes(p.vocalGender))throw new DomainError("Unsupported vocal gender");
  if(p.lyricLanguage!=="auto" && !Object.hasOwn(LYRIC_LANGUAGES,p.lyricLanguage))throw new DomainError("Unsupported lyric language");
  p.sunoModel=clean(p.sunoModel||"v6",50);
  p.genre=clean(p.genre,100);
  if(!p.genre)throw new DomainError("Genre required");
  for(const f of ["additionalStyles","excludeStyles"]){
    if(!Array.isArray(p[f])||p[f].length>16||p[f].some(x=>typeof x!=="string"||!x.trim()||x.length>100))
      throw new DomainError("Invalid "+f);
    p[f]=p[f].map(s=>s.trim());
  }
  for(const f of ["customInstructions","imagePrompt","artistPhotoPrompt"])p[f]=clean(p[f],1200);
  return p;
}
export function sunoRecipe(project, referenceStyles = "") {
  const p=project.parameters;
  return {provider:"suno",mode:"authorized-manual-handoff",model:project.parameters.sunoModel||"v6",
    title:project.title && project.title!=="Untitled project" ? project.title : project.result?.titles?.[0]||"Untitled",
    source:{projectId:project.id,revision:project.revision,artistId:project.artistId},
    lyrics:p.instrumental?"":project.result?.lyrics||"",
    style:[p.genre,...p.additionalStyles,project.result?.style||"",referenceStyles,p.customInstructions].filter(Boolean).join(", "),
    exclude:[...new Set([...p.excludeStyles,...(project.result?.exclusions||[])])].join(", "),vocalGender:p.instrumental?null:p.vocalGender,
    instrumental:p.instrumental,maxMode:p.maxMode,weirdness:p.weirdness,styleInfluence:p.styleInfluence,
    variety:p.variety,personalize:p.personalize,targetDurationSeconds:p.targetSeconds,
    lyricLanguage:LYRIC_LANGUAGES[p.lyricLanguage]||LYRIC_LANGUAGES.en,
    warnings:[...(project.integrity?.briefStale?["brief_stale"]:[]),...(project.integrity?.instructionConflicts?.length?["instruction_conflict"]:[])],
    note:"Duration is an editorial target, not a guaranteed Suno output. These keys are a preparation sheet, not an undocumented API request."
  };
}
export function studioBriefFingerprint(project) {
  return createHash("sha256").update(JSON.stringify({title:project.title,article:project.article,sourceUrl:project.sourceUrl,artistId:project.artistId,
    parameters:project.parameters,result:project.result,referenceInputs:project.referenceInputs||[]})).digest("hex");
}
export class StudioStore {
  constructor(store) {
    this.store=store;this.db=store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS studio_projects
        (id TEXT PRIMARY KEY, title TEXT NOT NULL, article TEXT NOT NULL DEFAULT '',
         source_url TEXT NOT NULL DEFAULT '', artist_id TEXT, params TEXT NOT NULL,
         result TEXT NOT NULL DEFAULT '{}', track_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_assets
        (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES studio_projects(id),
         kind TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_artist_presets
        (artist_id TEXT PRIMARY KEY REFERENCES artists(id), params TEXT NOT NULL);
    `);
    const columns=new Set(this.db.prepare("PRAGMA table_info(studio_assets)").all().map(c=>c.name));
    for(const [name,type] of Object.entries({provider:"TEXT NOT NULL DEFAULT 'unknown'",prompt:"TEXT NOT NULL DEFAULT ''",brief_fingerprint:"TEXT NOT NULL DEFAULT ''",selected:"INTEGER NOT NULL DEFAULT 0",deleted_at:"TEXT"}))
      if(!columns.has(name))this.db.exec("ALTER TABLE studio_assets ADD COLUMN "+name+" "+type);
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS studio_asset_selection ON studio_assets(project_id,kind) WHERE selected=1 AND deleted_at IS NULL");
    // Artist media is durable, independent of any News-to-Song project's
    // selection or removal. Existing selected project photos are migrated once.
    this.db.exec(`CREATE TABLE IF NOT EXISTS studio_artist_images
      (id TEXT PRIMARY KEY, artist_id TEXT NOT NULL REFERENCES artists(id),
       source_asset_id TEXT UNIQUE REFERENCES studio_assets(id),
       filename TEXT NOT NULL, mime TEXT NOT NULL, provider TEXT NOT NULL,
       prompt TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
       selected INTEGER NOT NULL DEFAULT 0, deleted_at TEXT,
       focus_x INTEGER NOT NULL DEFAULT 50, focus_y INTEGER NOT NULL DEFAULT 0,
       focus_source TEXT NOT NULL DEFAULT 'auto');
      CREATE UNIQUE INDEX IF NOT EXISTS studio_artist_image_active
        ON studio_artist_images(artist_id) WHERE selected=1 AND deleted_at IS NULL;`);
    const artistImageColumns=new Set(this.db.prepare("PRAGMA table_info(studio_artist_images)").all().map(c=>c.name));
    for(const [name,type] of Object.entries({focus_x:"INTEGER NOT NULL DEFAULT 50",focus_y:"INTEGER NOT NULL DEFAULT 0",focus_source:"TEXT NOT NULL DEFAULT 'auto'"}))
      if(!artistImageColumns.has(name))this.db.exec("ALTER TABLE studio_artist_images ADD COLUMN "+name+" "+type);
    this.migrateArtistImages();
    this.db.exec(`CREATE TABLE IF NOT EXISTS studio_suno_jobs
      (project_id TEXT PRIMARY KEY REFERENCES studio_projects(id),
       job_id TEXT NOT NULL, status TEXT NOT NULL, audio_url TEXT,
       imported_asset_id TEXT, submitted_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    initializeIntegrity(this.db);
    for(const row of this.db.prepare("SELECT id FROM studio_projects WHERE NOT EXISTS(SELECT 1 FROM studio_project_versions v WHERE v.project_id=studio_projects.id)").all())snapshot(this,row.id,"legacy_import");
  }
  projectPage(options){return projectPage(this,options);}
  inventory(){return inventory(this);}
  history(id){this.require(id);return this.db.prepare("SELECT revision,snapshot,reason,created_at AS createdAt FROM studio_project_versions WHERE project_id=? ORDER BY revision DESC").all(id).map(r=>({...r,snapshot:parse(r.snapshot,{})}));}
  projects() {return this.db.prepare("SELECT * FROM studio_projects ORDER BY updated_at DESC LIMIT 150").all().map(r=>this.convert(r));}
  convert(r){if(!r)return r;const p={id:r.id,title:r.title,article:r.article,sourceUrl:r.source_url,
    artistId:r.artist_id||"",parameters:parse(r.params,DEFAULT_PARAMETERS),result:parse(r.result,{}),
    trackId:r.track_id||"",createdAt:r.created_at,updatedAt:r.updated_at,revision:r.revision,briefInputHash:r.brief_input_hash||"",referenceInputs:referenceInputs(this.db,r.id)};return {...p,integrity:projectIntegrity(this,p)};}
  project(id){return this.convert(this.db.prepare("SELECT * FROM studio_projects WHERE id=?").get(id));}
  require(id){const p=this.project(id);if(!p)throw new DomainError("Project not found",404);return p;}
  preset(artistId){const row=this.db.prepare("SELECT params FROM studio_artist_presets WHERE artist_id=?").get(artistId);return row?parse(row.params,DEFAULT_PARAMETERS):null;}
  savePreset(artistId,params){
    if(!this.store.artist(artistId))throw new DomainError("Artist not found",404);
    const p=normalizeParameters(params);
    this.db.prepare("INSERT INTO studio_artist_presets VALUES(?,?) ON CONFLICT(artist_id) DO UPDATE SET params=excluded.params").run(artistId,JSON.stringify(p));
    this.store.audit("updated","artist_preset",artistId);
    return p;
  }
  patch(id,changes,options={}){return applyProjectPatch(this,id,changes,options,normalizeParameters,DEFAULT_PARAMETERS);}
  save(input={}){return atomic(this.db,()=>{
    if(!input.id&&input.requestId!==undefined){
      if(typeof input.requestId!=="string"||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId))throw new DomainError("Invalid draft request ID");
      const previous=this.db.prepare("SELECT project_id FROM studio_project_creations WHERE request_id=?").get(input.requestId);
      if(previous)return this.require(previous.project_id);
    }
    const p=this.saveProject(input);
    if(!input.id&&input.requestId)this.db.prepare("INSERT INTO studio_project_creations VALUES(?,?)").run(input.requestId,p.id);
    return p;
  });}
  saveProject(input={}){
    const existing=input.id?this.require(input.id):null;
    for(const key of ["title","article","sourceUrl","artistId"])if(Object.hasOwn(input,key)&&input[key]===null)throw new DomainError("Invalid "+key);
    const title=clean(input.title??existing?.title??"Untitled project",140)||"Untitled project";
    const article=clean(input.article??existing?.article??"",10000);
    const sourceUrl=clean(input.sourceUrl??existing?.sourceUrl??"",1000);
    if(sourceUrl){let url;try{url=new URL(sourceUrl)}catch{throw new DomainError("Invalid article URL");}
      if(!["https:","http:"].includes(url.protocol))throw new DomainError("Article URL must be http(s)");}
    const artistId=clean(input.artistId??existing?.artistId??"",80);
    if(artistId&&!this.store.artist(artistId))throw new DomainError("Artist not found",404);
    if(existing)checkRevision(existing,input.expectedRevision);
    const params=normalizeParameters(input.parameters||{},existing?.parameters||this.preset(artistId)||DEFAULT_PARAMETERS);
    const result=existing?.result||{};
    const id=existing?.id||uuid(),createdAt=existing?.createdAt||new Date().toISOString(),updatedAt=new Date().toISOString();
    if(existing&&title===existing.title&&article===existing.article&&sourceUrl===existing.sourceUrl&&artistId===existing.artistId&&JSON.stringify(params)===JSON.stringify(existing.parameters))return existing;
    this.db.prepare(`INSERT INTO studio_projects(id,title,article,source_url,artist_id,params,result,track_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,article=excluded.article,source_url=excluded.source_url,
      artist_id=excluded.artist_id,params=excluded.params,updated_at=excluded.updated_at,revision=studio_projects.revision+1`).run(
      id,title,article,sourceUrl,artistId||null,JSON.stringify(params),JSON.stringify(result),existing?.trackId||null,createdAt,updatedAt);
    if(artistId&&artistId!==existing?.artistId)this.associateArtistPhoto(id,artistId);
    this.store.audit(existing?"updated":"created","studio_project",id,{title});
    snapshot(this,id,existing?"project_edit":"created");
    return this.require(id);
  }
  associateArtistPhoto(id,artistId){
      // Associate legacy project-only artist photos when an artist is chosen
      // later. Never silently transfer an existing artist's media to another.
      const photo=this.db.prepare(`SELECT id FROM studio_assets
        WHERE project_id=? AND kind='artist-photo' AND selected=1 AND deleted_at IS NULL`).get(id);
      const owner=photo&&this.db.prepare(
        "SELECT artist_id AS artistId FROM studio_artist_images WHERE source_asset_id=?"
      ).get(photo.id);
      if(photo&&(!owner||owner.artistId===artistId))
        this.linkArtistImage(artistId,photo.id);
  }
  setResult(id,result,options={}){return atomic(this.db,()=>this.saveResult(id,result,options));}
  saveResult(id,result,{expectedRevision,expectedInputHash,generated=false,applyParameters=true}={}){
    const project=this.require(id);
    checkRevision(project,expectedRevision);
    if(expectedInputHash!==undefined&&expectedInputHash!==inputFingerprint(project))throw new DomainError("Project generation inputs changed. Regenerate the brief.",409);
    if(!result||typeof result!=="object"||typeof result.concept!=="string")throw new DomainError("Invalid AI response");
    for(const key of ["lyrics","style","coverPrompt","artistPhotoPrompt","suggestedGenre","rationale"])if(Object.hasOwn(result,key)&&typeof result[key]!=="string")throw new DomainError("Invalid result field: "+key);
    for(const key of ["exclusions","moods","titles"])if(Object.hasOwn(result,key)&&(!Array.isArray(result[key])||result[key].some(v=>typeof v!=="string")))throw new DomainError("Invalid result list: "+key);
    // Validate the entire parameter patch before writing either field.
    const allowed=["sunoModel","lyricLanguage","genre","additionalStyles","excludeStyles","vocalGender","instrumental","maxMode","weirdness","styleInfluence","variety","personalize","durationPreset","targetSeconds","customInstructions"];
    const patch=result.generationParameters;
    if(Object.hasOwn(result,"generationParameters") && (!patch || typeof patch!=="object" || Array.isArray(patch) || Object.keys(patch).some(k=>!allowed.includes(k))))
      throw new DomainError("Invalid generation parameters");
    const replay=JSON.stringify(patch)===JSON.stringify(project.result?.generationParameters);
    const params=patch&&applyParameters&&!replay?normalizeParameters(patch,project.parameters):{...project.parameters};
    let artistId=project.artistId||"";
    if(!artistId){
      const proposedId=typeof result.artistId==="string"?result.artistId:"";
      if(proposedId && this.store.artist(proposedId))artistId=proposedId;
      else if(proposedId)throw new DomainError("AI selected an unknown artist",400);
      if(!artistId && typeof result.artistName==="string" && result.artistName.trim()){
        const name=result.artistName.trim();
        if(name.length>80)throw new DomainError("Artist name exceeds 80 characters",400);
        const existing=this.store.artists().find(a=>a.name.toLocaleLowerCase()===name.toLocaleLowerCase());
        if(existing)artistId=existing.id;
        else{
          const genre=(result.suggestedGenre||params.genre||"Original").slice(0,100);
          const voice=params.instrumental?"instrumental":params.vocalGender==="auto"?"mixed":params.vocalGender;
          const language=params.lyricLanguage==="auto"?"en":params.lyricLanguage;
          const artist=this.store.addArtist({name,genre,voice,language,countries:[],dna:("Fictional artist created by Studio. "+(result.style||genre)).slice(0,1500)});
          artistId=artist.id;
        }
      }
      if(!artistId){
        const candidates=this.store.artists().filter(a=>a.genre.toLocaleLowerCase()===params.genre.toLocaleLowerCase() && (params.instrumental?a.voice==="instrumental":a.voice===params.vocalGender));
        if(candidates.length===1)artistId=candidates[0].id;
      }
    }
    if(result.coverPrompt && result.coverPrompt!==project.result?.coverPrompt)params.imagePrompt=result.coverPrompt;
    if(result.artistPhotoPrompt && result.artistPhotoPrompt!==project.result?.artistPhotoPrompt)params.artistPhotoPrompt=result.artistPhotoPrompt;
    const editing=!applyParameters||(!generated&&replay&&project.result?.concept&&["concept","style","exclusions","moods","titles","coverPrompt","artistPhotoPrompt","suggestedGenre","rationale"].every(k=>JSON.stringify(result[k])===JSON.stringify(project.result[k])));
    const hash=editing?project.briefInputHash:inputFingerprint({...project,artistId,parameters:params});
    if(JSON.stringify(result)===JSON.stringify(project.result)&&JSON.stringify(params)===JSON.stringify(project.parameters)&&artistId===project.artistId&&hash===project.briefInputHash)return project;
    this.db.prepare("UPDATE studio_projects SET result=?,params=?,artist_id=?,updated_at=?,revision=revision+1,brief_input_hash=? WHERE id=?").run(JSON.stringify(result),JSON.stringify(params),artistId||null,new Date().toISOString(),hash,id);
    this.store.audit("ai_extracted","studio_project",id,{title:result.titles?.[0]||""});
    snapshot(this,id,applyParameters?"generated_result":"lyrics_edit");
    return this.require(id);
  }
  makeTrack(id,options={}){return atomic(this.db,()=>this.createTrack(id,options));}
  createTrack(id,{sourceRevision}={}){
    const current=this.require(id);
    const p=sourceRevision===undefined?current:this.history(id).find(v=>v.revision===sourceRevision)?.snapshot;
    if(!p)throw new DomainError("Track source version not found",404);
    if(current.trackId)throw new DomainError("This project already has a linked track",409);
    if(!p.artistId)throw new DomainError("Choose an artist before creating a track",409);
    if(!p.result?.concept)throw new DomainError("Run AI extraction first",409);
    const t=this.store.addTrack({artistId:p.artistId,title:sunoRecipe(p).title,
      mode:p.parameters.instrumental?"instrumental":"vocal",concept:p.result.concept,
      lyrics:p.parameters.instrumental?"":p.result.lyrics||""});
    const track=this.store.progressTrack(t.id,"brief");
    this.db.prepare("UPDATE studio_projects SET track_id=?,updated_at=?,revision=revision+1 WHERE id=?").run(t.id,new Date().toISOString(),id);
    snapshot(this,id,"track_linked");
    this.store.audit("linked","studio_project",id,{trackId:t.id});return {project:this.require(id),track};
  }
  sunoJob(projectId){
    this.require(projectId);
    const row=this.db.prepare(`SELECT job_id AS id,status,audio_url AS audioUrl,
      imported_asset_id AS importedAssetId,submitted_at AS submittedAt,updated_at AS updatedAt
      FROM studio_suno_jobs WHERE project_id=?`).get(projectId);
    if(row){const take=this.db.prepare("SELECT recipe,brief_fingerprint FROM studio_suno_takes WHERE job_id=?").get(row.id);row.recipe=parse(take?.recipe,{});row.briefFingerprint=take?.brief_fingerprint||"";}
    return row||null;
  }
  sunoJobs(projectId){this.require(projectId);return this.db.prepare("SELECT job_id AS id,status,recipe,brief_fingerprint AS briefFingerprint,audio_url AS audioUrl,imported_asset_id AS importedAssetId,submitted_at AS submittedAt,updated_at AS updatedAt FROM studio_suno_takes WHERE project_id=? ORDER BY submitted_at DESC,job_id DESC").all(projectId).map(r=>({...r,recipe:parse(r.recipe,{})}));}
  beginSunoJob(projectId,id,status,recipe=sunoRecipe(this.require(projectId)),fingerprint=studioBriefFingerprint(this.require(projectId))){
    return atomic(this.db,()=>this.createSunoJob(projectId,id,status,recipe,fingerprint));
  }
  createSunoJob(projectId,id,status,recipe,fingerprint){
    this.require(projectId);
    const previous=this.sunoJob(projectId);
    if(previous&&!(["error","failed"].includes(previous.status)||(previous.status==="complete"&&previous.importedAssetId)))
      throw new DomainError("A Suno generation is already linked to this project",409);
    const now=new Date().toISOString();
    this.db.prepare(`INSERT INTO studio_suno_jobs
      (project_id,job_id,status,submitted_at,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET job_id=excluded.job_id,
      status=excluded.status,audio_url=NULL,imported_asset_id=NULL,
      submitted_at=excluded.submitted_at,updated_at=excluded.updated_at`)
      .run(projectId,id,status,now,now);
    this.db.prepare("INSERT INTO studio_suno_takes(job_id,project_id,recipe,brief_fingerprint,status,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id,projectId,JSON.stringify(recipe),fingerprint,status,now,now);
    this.store.audit("suno_submitted","studio_project",projectId,{status});
    return this.sunoJob(projectId);
  }
  updateSunoJob(projectId,id,patch){return atomic(this.db,()=>this.updateSunoTake(projectId,id,patch));}
  updateSunoTake(projectId,id,{status,audioUrl}){
    const previous=this.sunoJob(projectId);
    if(!previous||previous.id!==id)throw new DomainError("Unknown Suno generation",404);
    if(!["submitted","queued","streaming","complete","error","failed"].includes(status))
      throw new DomainError("Unknown Suno generation status",502);
    this.db.prepare(`UPDATE studio_suno_jobs SET status=?,audio_url=?,updated_at=?
      WHERE project_id=?`).run(status,audioUrl||null,new Date().toISOString(),projectId);
    this.db.prepare("UPDATE studio_suno_takes SET status=?,audio_url=?,updated_at=? WHERE job_id=?").run(status,audioUrl||null,new Date().toISOString(),id);
    return this.sunoJob(projectId);
  }
  markSunoImported(projectId,id,assetId){return atomic(this.db,()=>this.importSunoTake(projectId,id,assetId));}
  importSunoTake(projectId,id,assetId){
    const job=this.sunoJob(projectId);
    if(!job||job.id!==id||job.status!=="complete"||job.importedAssetId)
      throw new DomainError("Suno generation is not ready to import",409);
    this.db.prepare(`UPDATE studio_suno_jobs SET imported_asset_id=?,updated_at=?
      WHERE project_id=?`).run(assetId,new Date().toISOString(),projectId);
    this.db.prepare("UPDATE studio_suno_takes SET imported_asset_id=?,updated_at=? WHERE job_id=?").run(assetId,new Date().toISOString(),id);
    return this.sunoJob(projectId);
  }
  assets(projectId){
    const project=this.require(projectId),fingerprint=studioBriefFingerprint(project);
    return this.db.prepare("SELECT * FROM studio_assets WHERE project_id=? AND deleted_at IS NULL ORDER BY created_at DESC,id DESC")
      .all(projectId).map(r=>({id:r.id,projectId:r.project_id,kind:r.kind,mime:r.mime,createdAt:r.created_at,
        provider:r.provider,prompt:r.prompt,selected:!!r.selected,
        briefMatch:r.brief_fingerprint?(r.brief_fingerprint===fingerprint?"current":"earlier"):"unknown",
        url:"/api/studio/assets/"+r.id+"/content"}));
  }
  migrateArtistImages(){
    // Preserve historical selected photos in the new artist-owned library.
    // Repeatable across restarts, and no migration of square album covers.
    const rows=this.db.prepare(`SELECT p.artist_id AS artistId,a.id AS assetId,
      a.filename,a.mime,a.provider,a.prompt,a.created_at AS createdAt
      FROM studio_assets a JOIN studio_projects p ON p.id=a.project_id
      WHERE a.kind='artist-photo' AND a.selected=1
        AND a.deleted_at IS NULL AND p.artist_id IS NOT NULL AND p.artist_id!=''
        AND NOT EXISTS(SELECT 1 FROM studio_artist_images ai WHERE ai.source_asset_id=a.id)
      ORDER BY a.created_at DESC,a.id DESC`).all();
    for(const row of rows)
      this.linkArtistImage(row.artistId,row.assetId,{select:false});
  }
  artistImages(artistId){
    if(!this.store.artist(artistId))throw new DomainError("Artist not found",404);
    return this.db.prepare(`SELECT id,artist_id AS artistId,source_asset_id AS sourceAssetId,
      provider,prompt,created_at AS createdAt,selected,
      focus_x AS focusX,focus_y AS focusY,focus_source AS focusSource
      FROM studio_artist_images WHERE artist_id=? AND deleted_at IS NULL
      ORDER BY created_at DESC,id DESC`).all(artistId).map(row=>({
      ...row,selected:!!row.selected,url:"/api/studio/artist-images/"+row.id+"/content"
    }));
  }
  allArtistImages(){
    return Object.fromEntries(this.store.artists().map(a=>[a.id,this.artistImages(a.id)]));
  }
  artistImage(imageId){
    return this.db.prepare("SELECT * FROM studio_artist_images WHERE id=? AND deleted_at IS NULL").get(imageId);
  }
  linkArtistImage(artistId,assetId,{select=false}={}){
    if(!this.store.artist(artistId))throw new DomainError("Artist not found",404);
    const asset=this.asset(assetId);
    if(!asset||asset.kind!=="artist-photo")throw new DomainError("Only artist photos can be linked to an artist",400);
    // If a photo was previously linked to another artist, a separate record
    // for each artist still references the same file only with explicit linking.
    const found=this.db.prepare("SELECT id,artist_id FROM studio_artist_images WHERE source_asset_id=?").get(assetId);
    if(found&&found.artist_id!==artistId)
      throw new DomainError("This artist photo belongs to another artist",409);
    if(!found){
      this.db.prepare(`INSERT INTO studio_artist_images
        (id,artist_id,source_asset_id,filename,mime,provider,prompt,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(
        uuid(),artistId,assetId,asset.filename,asset.mime,asset.provider,asset.prompt,
        asset.created_at);
    }
    const active=this.db.prepare(`SELECT id FROM studio_artist_images
      WHERE artist_id=? AND selected=1 AND deleted_at IS NULL`).get(artistId);
    if(select||!active){
      const target=this.db.prepare("SELECT id FROM studio_artist_images WHERE source_asset_id=?").get(assetId);
      this.selectArtistImage(artistId,target.id);
    }
    return this.artistImages(artistId);
  }
  registerArtistPhoto(artistId,{filename,mime,provider="chatgpt",prompt=""}){
    if(!this.store.artist(artistId))throw new DomainError("Artist not found",404);
    if(!/^[0-9a-f-]{36}\.png$/.test(filename)||mime!=="image/png")
      throw new DomainError("Unsupported artist photo format",400);
    if(!["chatgpt","upload","draw-things"].includes(provider))
      throw new DomainError("Invalid artist image provider",400);
    const imageId=uuid(),createdAt=new Date().toISOString();
    this.db.prepare(`INSERT INTO studio_artist_images
      (id,artist_id,source_asset_id,filename,mime,provider,prompt,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(
      imageId,artistId,null,filename,mime,provider,clean(prompt,4000),createdAt);
    const active=this.db.prepare(`SELECT id FROM studio_artist_images
      WHERE artist_id=? AND selected=1 AND deleted_at IS NULL`).get(artistId);
    if(!active)this.selectArtistImage(artistId,imageId);
    this.store.audit("artist_photo_added","artist",artistId,{imageId,provider});
    return this.artistImages(artistId).find(image=>image.id===imageId);
  }
  deleteArtistImage(artistId,imageId){
    if(!this.store.artist(artistId))throw new DomainError("Artist not found",404);
    const image=this.artistImage(imageId);
    if(!image||image.artist_id!==artistId)
      throw new DomainError("Artist photo not found for this artist",404);
    this.db.exec("BEGIN IMMEDIATE");
    try{
      this.db.prepare(`UPDATE studio_artist_images
        SET selected=0,deleted_at=? WHERE id=?`).run(new Date().toISOString(),imageId);
      if(image.selected){
        const next=this.db.prepare(`SELECT id FROM studio_artist_images
          WHERE artist_id=? AND deleted_at IS NULL
          ORDER BY created_at DESC,id DESC LIMIT 1`).get(artistId);
        if(next)this.db.prepare("UPDATE studio_artist_images SET selected=1 WHERE id=?").run(next.id);
      }
      this.db.exec("COMMIT");
    }catch(error){this.db.exec("ROLLBACK");throw error;}
    this.store.audit("artist_photo_removed","artist",artistId,{imageId});
    return this.artistImages(artistId);
  }
  selectArtistImage(artistId,imageId){
    if(!this.store.artist(artistId))throw new DomainError("Artist not found",404);
    const image=this.artistImage(imageId);
    if(!image||image.artist_id!==artistId)
      throw new DomainError("Artist photo not found for this artist",404);
    return atomic(this.db,()=>{
      this.db.prepare("UPDATE studio_artist_images SET selected=0 WHERE artist_id=? AND deleted_at IS NULL").run(artistId);
      this.db.prepare("UPDATE studio_artist_images SET selected=1 WHERE id=?").run(imageId);
      this.store.audit("artist_photo_selected","artist",artistId,{imageId});
      return this.artistImages(artistId);
    });
  }
  setArtistImageFocus(artistId,imageId,{focusX,focusY,source="manual"}={}){
    if(!this.store.artist(artistId))throw new DomainError("Artist not found",404);
    const image=this.artistImage(imageId);
    if(!image||image.artist_id!==artistId)throw new DomainError("Artist photo not found for this artist",404);
    if(!Number.isInteger(focusX)||focusX<0||focusX>100||!Number.isInteger(focusY)||focusY<0||focusY>100)
      throw new DomainError("Focus point must use integer percentages from 0 to 100",400);
    if(!["auto","manual"].includes(source))throw new DomainError("Invalid focus source",400);
    this.db.prepare("UPDATE studio_artist_images SET focus_x=?,focus_y=?,focus_source=? WHERE id=?")
      .run(focusX,focusY,source,imageId);
    this.store.audit("artist_photo_focus_set","artist",artistId,{imageId,focusX,focusY,source});
    return this.artistImages(artistId).find(item=>item.id===imageId);
  }
  artistBanners(){
    const rows=this.db.prepare(`SELECT id,artist_id AS artistId,created_at AS createdAt,
      focus_x AS focusX,focus_y AS focusY,focus_source AS focusSource
      FROM studio_artist_images WHERE selected=1 AND deleted_at IS NULL`).all();
    return Object.fromEntries(rows.map(row=>[
      row.artistId,{assetId:row.id,url:"/api/studio/artist-images/"+row.id+"/content",
        createdAt:row.createdAt,focusX:row.focusX,focusY:row.focusY,focusSource:row.focusSource}
    ]));
  }
  asset(id){return this.db.prepare("SELECT * FROM studio_assets WHERE id=? AND deleted_at IS NULL").get(id);}
  requireAsset(projectId,id){
    this.require(projectId);
    const asset=this.asset(id);
    if(!asset||asset.project_id!==projectId)throw new DomainError("Asset not found in this project",404);
    return asset;
  }
  selectAsset(projectId,id,kind){
    const asset=this.requireAsset(projectId,id);
    const role=kind||asset.kind;
    if(!["cover","artist-photo","audio"].includes(role) || (asset.kind==="audio")!==(role==="audio"))
      throw new DomainError("Unsupported asset role",400);
    this.db.exec("BEGIN IMMEDIATE");
    try{
      this.db.prepare("UPDATE studio_assets SET selected=0 WHERE project_id=? AND kind=?").run(projectId,role);
      this.db.prepare("UPDATE studio_assets SET selected=1,kind=? WHERE id=?").run(role,id);
      this.db.exec("COMMIT");
    }catch(error){this.db.exec("ROLLBACK");throw error;}
    if(role==="artist-photo"){
      const artistId=this.require(projectId).artistId;
      if(artistId)this.linkArtistImage(artistId,id,{select:true});
    }
    this.store.audit("asset_selected","studio_project",projectId,{assetId:id,kind:role});
    return this.assets(projectId);
  }
  deleteAsset(projectId,id){
    this.requireAsset(projectId,id);
    // Remove from the project without destroying the original file.
    this.db.prepare("UPDATE studio_assets SET deleted_at=?,selected=0 WHERE id=?").run(new Date().toISOString(),id);
    this.store.audit("asset_removed","studio_project",projectId,{assetId:id});
    return this.assets(projectId);
  }
  registerAsset(projectId,kind,filename,mime,{provider="unknown",prompt="",briefFingerprint=""}={}){
    this.require(projectId);
    if(!["cover","artist-photo","audio"].includes(kind))throw new DomainError("Invalid asset type");
    if(!/^[0-9a-f-]{36}\.(?:png|wav|mp3)$/.test(filename))throw new DomainError("Invalid asset filename");
    if(!["chatgpt","upload","draw-things","suno","unknown"].includes(provider))throw new DomainError("Invalid asset provider");
    const id=uuid(),createdAt=new Date().toISOString();
    this.db.prepare("INSERT INTO studio_assets(id,project_id,kind,filename,mime,created_at,provider,prompt,brief_fingerprint) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id,projectId,kind,filename,mime,createdAt,provider,clean(prompt,4000),clean(briefFingerprint,64));
    this.store.audit("asset_added","studio_project",projectId,{assetId:id,kind,provider});
    return this.assets(projectId).find(a=>a.id===id);
  }
}
