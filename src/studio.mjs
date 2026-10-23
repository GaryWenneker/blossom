import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.mjs";

export const LENGTH_PRESETS = Object.freeze({
  radio:{label:"Radio edit",seconds:205,min:165,max:240},
  streaming:{label:"Streaming single",seconds:180,min:120,max:240},
  focus:{label:"Focus / background",seconds:270,min:150,max:480},
  ambient:{label:"Ambient / sleep",seconds:420,min:240,max:900},
  custom:{label:"Custom",seconds:210,min:35,max:900}
});
export const DEFAULT_PARAMETERS = Object.freeze({
  sunoModel:"v6",genre:"Country Pop",additionalStyles:["Americana","Acoustic"],excludeStyles:["imitated voices","unlicensed samples"],
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
export function sunoRecipe(project) {
  const p=project.parameters;
  return {provider:"suno",mode:"authorized-manual-handoff",model:project.parameters.sunoModel||"v6",
    title:project.title||project.result?.titles?.[0]||"Untitled",
    lyrics:p.instrumental?"":project.result?.lyrics||"",
    style:[p.genre,...p.additionalStyles,project.result?.style||"",p.customInstructions].filter(Boolean).join(", "),
    exclude:[...p.excludeStyles].join(", "),vocalGender:p.instrumental?null:p.vocalGender,
    instrumental:p.instrumental,maxMode:p.maxMode,weirdness:p.weirdness,styleInfluence:p.styleInfluence,
    variety:p.variety,personalize:p.personalize,targetDurationSeconds:p.targetSeconds,
    note:"Duration is an editorial target, not a guaranteed Suno output. These keys are a preparation sheet, not an undocumented API request."
  };
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
  }
  projects() {return this.db.prepare("SELECT * FROM studio_projects ORDER BY updated_at DESC LIMIT 150").all().map(r=>this.convert(r));}
  convert(r){return r&&{id:r.id,title:r.title,article:r.article,sourceUrl:r.source_url,
    artistId:r.artist_id||"",parameters:parse(r.params,DEFAULT_PARAMETERS),result:parse(r.result,{}),
    trackId:r.track_id||"",createdAt:r.created_at,updatedAt:r.updated_at};}
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
  save(input={}){
    const title=clean(input.title||"Untitled project",140)||"Untitled project";
    const article=clean(input.article||"",10000);
    const sourceUrl=clean(input.sourceUrl||"",1000);
    if(sourceUrl){let url;try{url=new URL(sourceUrl)}catch{throw new DomainError("Invalid article URL");}
      if(!["https:","http:"].includes(url.protocol))throw new DomainError("Article URL must be http(s)");}
    const artistId=clean(input.artistId||"",80);
    if(artistId&&!this.store.artist(artistId))throw new DomainError("Artist not found",404);
    const existing=input.id?this.require(input.id):null;
    const params=normalizeParameters(input.parameters||existing?.parameters||this.preset(artistId)||DEFAULT_PARAMETERS);
    const result=existing?.result||{};
    const id=existing?.id||uuid(),createdAt=existing?.createdAt||new Date().toISOString(),updatedAt=new Date().toISOString();
    this.db.prepare(`INSERT INTO studio_projects VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,article=excluded.article,source_url=excluded.source_url,
      artist_id=excluded.artist_id,params=excluded.params,updated_at=excluded.updated_at`).run(
      id,title,article,sourceUrl,artistId||null,JSON.stringify(params),JSON.stringify(result),existing?.trackId||null,createdAt,updatedAt);
    this.store.audit(existing?"updated":"created","studio_project",id,{title});
    return this.require(id);
  }
  setResult(id,result){
    this.require(id);
    if(!result||typeof result!=="object"||typeof result.concept!=="string")throw new DomainError("Invalid AI response");
    this.db.prepare("UPDATE studio_projects SET result=?,updated_at=? WHERE id=?").run(JSON.stringify(result),new Date().toISOString(),id);
    this.store.audit("ai_extracted","studio_project",id,{title:result.titles?.[0]||""});
    return this.require(id);
  }
  makeTrack(id){
    const p=this.require(id);
    if(p.trackId)throw new DomainError("This project already has a linked track",409);
    if(!p.artistId)throw new DomainError("Choose an artist before creating a track",409);
    if(!p.result?.concept)throw new DomainError("Run AI extraction first",409);
    const t=this.store.addTrack({artistId:p.artistId,title:p.title||p.result.titles?.[0]||"Untitled",
      mode:p.parameters.instrumental?"instrumental":"vocal",concept:p.result.concept,
      lyrics:p.parameters.instrumental?"":p.result.lyrics||""});
    const track=this.store.progressTrack(t.id,"brief");
    this.db.prepare("UPDATE studio_projects SET track_id=?,updated_at=? WHERE id=?").run(t.id,new Date().toISOString(),id);
    this.store.audit("linked","studio_project",id,{trackId:t.id});return {project:this.require(id),track};
  }
  assets(projectId){
    this.require(projectId);
    return this.db.prepare("SELECT id,project_id,kind,mime,created_at FROM studio_assets WHERE project_id=? ORDER BY created_at DESC")
      .all(projectId).map(r=>({id:r.id,projectId:r.project_id,kind:r.kind,mime:r.mime,createdAt:r.created_at,url:"/api/studio/assets/"+r.id+"/content"}));
  }
  asset(id){return this.db.prepare("SELECT * FROM studio_assets WHERE id=?").get(id);}
  registerAsset(projectId,kind,filename,mime){
    this.require(projectId);
    if(!["cover","artist-photo","audio"].includes(kind))throw new DomainError("Invalid asset type");
    if(!/^[0-9a-f-]{36}\.(?:png|wav|mp3)$/.test(filename))throw new DomainError("Invalid asset filename");
    const id=uuid(),createdAt=new Date().toISOString();
    this.db.prepare("INSERT INTO studio_assets VALUES(?,?,?,?,?,?)").run(id,projectId,kind,filename,mime,createdAt);
    this.store.audit("asset_added","studio_project",projectId,{assetId:id,kind});
    return this.assets(projectId).find(a=>a.id===id);
  }
}
