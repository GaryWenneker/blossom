import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve,dirname,join,basename } from 'node:path';
import { createHash } from 'node:crypto';

// Open the actual database read-only: no Store constructors or migrations.
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const filename=option('--db')||process.env.BLOSSOM_DB;
if(!filename){console.error('Usage: node scripts/diagnose-studio.mjs --db /absolute/path/blossom.db [--assets /absolute/path/assets]');process.exit(1);}
const path=resolve(filename),assets=resolve(option('--assets')||join(dirname(path),'assets'));
const db=new DatabaseSync(path,{readOnly:true});
try{
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
  const rows=table=>tables.has(table)?db.prepare('SELECT * FROM '+table).all():[];
  const artists=rows('artists'),projects=rows('studio_projects'),tracks=rows('tracks'),files=rows('studio_assets').filter(a=>!a.deleted_at);
  const artistIds=new Set(artists.map(a=>a.id)),trackIds=new Set(tracks.map(t=>t.id)),groups=new Map();
  for(const p of projects){const key=createHash('sha256').update(JSON.stringify([p.artist_id,p.title,p.article,p.result])).digest('hex');groups.set(key,[...(groups.get(key)||[]),p.id]);}
  const report={database:path,integrity:db.prepare('PRAGMA quick_check').all(),foreignKeyViolations:db.prepare('PRAGMA foreign_key_check').all(),
    counts:{artists:artists.length,projects:projects.length,tracks:tracks.length,audioAssets:files.filter(a=>a.kind==='audio').length},
    artists:artists.map(a=>({id:a.id,name:a.name,projects:projects.filter(p=>p.artist_id===a.id).length})),
    duplicateCandidates:[...groups.values()].filter(g=>g.length>1),
    orphanProjects:projects.filter(p=>p.artist_id&&!artistIds.has(p.artist_id)||p.track_id&&!trackIds.has(p.track_id)).map(p=>({id:p.id,title:p.title})),
    missingAssets:files.filter(a=>basename(a.filename)!==a.filename||!existsSync(join(assets,a.filename))).map(a=>({id:a.id,kind:a.kind})),
    note:'Read-only inventory. Matching content is a candidate for review, never an instruction to delete or merge.'};
  console.log(JSON.stringify(report,null,2));
  if(report.integrity.some(r=>Object.values(r)[0]!=='ok'))process.exitCode=2;
}finally{db.close();}
