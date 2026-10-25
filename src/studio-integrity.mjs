import { createHash } from 'node:crypto';
import { DomainError } from './domain.mjs';

export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function inputFingerprint(project){
  const {imagePrompt:_cover,artistPhotoPrompt:_photo,...parameters}=project.parameters||{};
  return digest({title:project.title,article:project.article,sourceUrl:project.sourceUrl,artistId:project.artistId,parameters,referenceInputs:project.referenceInputs||[]});
}
export function referenceInputs(db,projectId){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='studio_music_dna_refs'").get())return [];
  return db.prepare(`SELECT r.profile_id AS profileId,r.weight,p.current_analysis_id AS analysisId
    FROM studio_music_dna_refs r JOIN music_dna_profiles p ON p.id=r.profile_id
    WHERE r.project_id=? ORDER BY r.ordinal`).all(projectId);
}
export function atomic(db,operation){
  db.exec('SAVEPOINT studio_write');
  try{const result=operation();db.exec('RELEASE studio_write');return result;}
  catch(error){db.exec('ROLLBACK TO studio_write; RELEASE studio_write');throw error;}
}
export function checkRevision(project,expected){
  if(expected!==undefined&&(!Number.isInteger(expected)||expected!==project.revision))
    throw new DomainError('Project changed. Reload before applying this edit or generation result.',409);
}
export function initializeIntegrity(db){
  atomic(db,()=>{
    const columns=new Set(db.prepare('PRAGMA table_info(studio_projects)').all().map(c=>c.name));
    if(!columns.has('revision'))db.exec('ALTER TABLE studio_projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
    if(!columns.has('brief_input_hash'))db.exec("ALTER TABLE studio_projects ADD COLUMN brief_input_hash TEXT NOT NULL DEFAULT ''");
    // Older installations used created_at rather than submitted_at.
    // Upgrade in the same transaction before copying historical jobs.
    const jobColumns=new Set(db.prepare('PRAGMA table_info(studio_suno_jobs)').all().map(c=>c.name));
    if(!jobColumns.has('submitted_at')){
      db.exec('ALTER TABLE studio_suno_jobs ADD COLUMN submitted_at TEXT');
      const fallback=jobColumns.has('created_at')?'created_at':"NULL";
      db.exec(`UPDATE studio_suno_jobs SET submitted_at=COALESCE(${fallback},updated_at,'1970-01-01T00:00:00.000Z') WHERE submitted_at IS NULL`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS studio_project_creations(
      request_id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id));
      CREATE TABLE IF NOT EXISTS studio_project_versions(
      project_id TEXT NOT NULL REFERENCES studio_projects(id), revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(project_id,revision));`);
    // Some pre-release databases used a project-keyed takes table. Keep it
    // intact under a legacy name while creating the current job-keyed table.
    const hasTakes=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='studio_suno_takes'").get();
    const existingTakeColumns=hasTakes?new Set(db.prepare('PRAGMA table_info(studio_suno_takes)').all().map(c=>c.name)):new Set();
    let legacyTakes='';
    if(hasTakes&&(!existingTakeColumns.has('job_id')||!existingTakeColumns.has('project_id')||!existingTakeColumns.has('status'))){
      db.exec('DROP INDEX IF EXISTS studio_take_project');
      legacyTakes='studio_suno_takes_legacy_project_key';
      const collision=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(legacyTakes);
      if(collision)throw new Error('Both legacy and current Suno take tables exist; refusing to alter them automatically.');
      db.exec(`ALTER TABLE studio_suno_takes RENAME TO ${legacyTakes}`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS studio_suno_takes(
      job_id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES studio_projects(id),
      recipe TEXT NOT NULL DEFAULT '{}',brief_fingerprint TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,audio_url TEXT,imported_asset_id TEXT,
      submitted_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
    const takeColumns=new Set(db.prepare('PRAGMA table_info(studio_suno_takes)').all().map(c=>c.name));
    for(const [name,type] of Object.entries({job_id:'TEXT',project_id:'TEXT',recipe:"TEXT NOT NULL DEFAULT '{}'",brief_fingerprint:"TEXT NOT NULL DEFAULT ''",status:"TEXT NOT NULL DEFAULT 'legacy'",audio_url:'TEXT',imported_asset_id:'TEXT',submitted_at:'TEXT',updated_at:'TEXT'}))
      if(!takeColumns.has(name))db.exec(`ALTER TABLE studio_suno_takes ADD COLUMN ${name} ${type}`);
    if(legacyTakes){
      const rows=db.prepare(`SELECT * FROM ${legacyTakes}`).all();
      const insert=db.prepare(`INSERT OR IGNORE INTO studio_suno_takes
        (job_id,project_id,recipe,brief_fingerprint,status,audio_url,imported_asset_id,submitted_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`);
      for(const row of rows){
        const projectId=row.project_id??row.studio_project_id;
        const jobId=row.job_id??row.suno_job_id??row.take_id??row.id??projectId;
        if(!projectId||!jobId)throw new Error('Legacy Suno take is missing its project or job identifier; original table was preserved.');
        const created=row.created_at??row.submitted_at??'1970-01-01T00:00:00.000Z';
        insert.run(String(jobId),String(projectId),row.recipe??'{}',row.brief_fingerprint??'',row.status??'legacy',row.audio_url??null,row.imported_asset_id??null,String(created),String(row.updated_at??created));
      }
    }else if(hasTakes){
      // Fill newly added fields on prior job-keyed tables before indexing.
      const created=existingTakeColumns.has('created_at')?'created_at':'NULL';
      db.exec(`UPDATE studio_suno_takes SET submitted_at=COALESCE(submitted_at,${created},updated_at,'1970-01-01T00:00:00.000Z'),updated_at=COALESCE(updated_at,${created},submitted_at,'1970-01-01T00:00:00.000Z') WHERE submitted_at IS NULL OR updated_at IS NULL`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS studio_project_order ON studio_projects(updated_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS studio_project_artist ON studio_projects(artist_id);
      CREATE INDEX IF NOT EXISTS studio_take_project ON studio_suno_takes(project_id,submitted_at DESC);
      INSERT OR IGNORE INTO studio_suno_takes
        (job_id,project_id,recipe,brief_fingerprint,status,audio_url,imported_asset_id,submitted_at,updated_at)
        SELECT job_id,project_id,'{}','',status,audio_url,imported_asset_id,submitted_at,updated_at FROM studio_suno_jobs;`);
    // Guard new relationships without deleting or rewriting questionable legacy rows.
    for(const [column,table] of [['artist_id','artists'],['track_id','tracks']]){
      for(const event of ['INSERT','UPDATE']){
        const change=event==='UPDATE'?` AND NEW.${column} IS NOT OLD.${column}`:'';
        db.exec(`CREATE TRIGGER IF NOT EXISTS studio_${column}_${event.toLowerCase()}
          BEFORE ${event} ON studio_projects WHEN NEW.${column} IS NOT NULL AND NEW.${column}!=''
          ${change} AND NOT EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.${column})
          BEGIN SELECT RAISE(ABORT,'Invalid Studio relationship'); END;`);
      }
    }
  });
}
export function snapshot(studio,id,reason){
  const p=studio.require(id),{integrity:_integrity,...data}=p;
  studio.db.prepare('INSERT OR IGNORE INTO studio_project_versions VALUES(?,?,?,?,?)')
    .run(id,p.revision,JSON.stringify(data),reason,new Date().toISOString());
}
export function projectIntegrity(studio,p){
  const track=p.trackId?studio.db.prepare('SELECT artist_id AS artistId,title,concept,lyrics,mode FROM tracks WHERE id=?').get(p.trackId):null;
  return {
    briefStale:!!p.briefInputHash&&p.briefInputHash!==inputFingerprint(p),
    briefProvenance:p.result?.concept?(p.briefInputHash?'recorded':'legacy_unknown'):'not_generated',
    parameterDifferences:Object.keys(p.result?.generationParameters||{}).filter(k=>JSON.stringify(p.result.generationParameters[k])!==JSON.stringify(p.parameters[k])),
    instructionConflicts:instructionConflicts(p),
    trackMismatch:!!p.trackId&&(!track||track.artistId!==p.artistId||track.title!==(p.title&&p.title!=="Untitled project"?p.title:p.result?.titles?.[0]||"Untitled")||
      track.concept!==p.result?.concept||track.lyrics!==(p.parameters.instrumental?'':p.result?.lyrics||'')||
      track.mode!==(p.parameters.instrumental?'instrumental':'vocal'))
  };
}
export function instructionConflicts(p){
  const requested=[p.parameters?.customInstructions,...(p.parameters?.additionalStyles||[])].join(' ');
  const wantsStrings=/(?:include|add|with|accompanied by|avec|achter).{0,50}(?:string|orchestr|strijk)|strijkorkest/i.test(requested);
  const oldDirection=[p.result?.style,...(p.result?.exclusions||[])].join(' ');
  return wantsStrings&&/piano alone|piano only|solo (?:felt )?piano|strings|orchestral swells/i.test(oldDirection)
    ?['String accompaniment conflicts with the saved piano-only brief or exclusions. Update the instructions and regenerate the brief.']:[];
}
export function projectPage(studio,{limit=50,cursor,q=''}={}){
  if(!Number.isInteger(limit)||limit<1||limit>150||typeof q!=='string'||q.length>200)throw new DomainError('Invalid project page');
  let boundary;
  if(cursor!==undefined&&cursor!==null&&cursor!==''){
    try{boundary=JSON.parse(Buffer.from(cursor,'base64url').toString());}catch{throw new DomainError('Invalid project cursor');}
    if(!Array.isArray(boundary)||boundary.length!==2||boundary.some(x=>typeof x!=='string'||x.length>100))throw new DomainError('Invalid project cursor');
  }
  const filter="(title LIKE ? ESCAPE '\\' OR artist_id IN (SELECT id FROM artists WHERE name LIKE ? ESCAPE '\\'))";
  const term='%'+q.replace(/[\\%_]/g,c=>'\\'+c)+'%';
  const total=studio.db.prepare('SELECT COUNT(*) AS n FROM studio_projects WHERE '+filter).get(term,term).n;
  const rows=studio.db.prepare('SELECT * FROM studio_projects WHERE '+filter+
    (boundary?' AND (updated_at<? OR (updated_at=? AND id<?))':'')+' ORDER BY updated_at DESC,id DESC LIMIT ?')
    .all(term,term,...(boundary?[boundary[0],boundary[0],boundary[1]]:[]),limit+1);
  const hasMore=rows.length>limit,results=rows.slice(0,limit).map(r=>studio.convert(r)),last=results.at(-1);
  return {results,total,nextCursor:hasMore?Buffer.from(JSON.stringify([last.updatedAt,last.id])).toString('base64url'):null};
}
export function inventory(studio){
  const db=studio.db,rows=db.prepare('SELECT * FROM studio_projects').all(),artists=studio.store.artists();
  const projects=rows.map(r=>studio.convert(r)),groups=new Map();
  for(const p of projects){const key=digest({artistId:p.artistId,title:p.title,article:p.article,result:p.result});const group=groups.get(key)||[];group.push(p.id);groups.set(key,group);}
  const orphans=projects.filter(p=>(p.artistId&&!artists.some(a=>a.id===p.artistId))||(p.trackId&&!studio.store.track(p.trackId))).map(p=>({id:p.id,artistId:p.artistId,trackId:p.trackId}));
  return {counts:{artists:artists.length,projects:projects.length,tracks:studio.store.tracks().length,
    briefs:projects.filter(p=>p.result?.concept).length,audioAssets:db.prepare("SELECT COUNT(*) AS n FROM studio_assets WHERE kind='audio' AND deleted_at IS NULL").get().n},
    artists:artists.map(a=>({id:a.id,name:a.name,projectCount:projects.filter(p=>p.artistId===a.id).length})),
    duplicateCandidates:[...groups.values()].filter(ids=>ids.length>1),orphans,
    findings:projects.filter(p=>p.integrity.briefStale||p.integrity.trackMismatch||p.integrity.parameterDifferences.length).map(p=>({id:p.id,title:p.title,...p.integrity}))};
}
