import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage.mjs';
import { StudioStore, DEFAULT_PARAMETERS, studioBriefFingerprint, sunoRecipe } from '../src/studio.mjs';
import { studioAction, studioInput, studioActiveId,studioSelectedId } from '../public/studio.js';
import { once } from 'node:events';
import { createAppServer } from '../src/server.mjs';
import { spawnSync } from 'node:child_process';
import { MusicDNA } from '../src/music-dna.mjs';
import { StudioReferences } from '../src/music-dna-studio.mjs';
import { inputFingerprint } from '../src/studio-integrity.mjs';

const artist={name:'Integrity fixture',genre:'Piano',language:'en',countries:[],voice:'instrumental',dna:'Acoustic piano'};
const brief={concept:'Fixture concept',lyrics:'',style:'Piano alone',exclusions:['Strings'],moods:['calm'],titles:['Fixture title'],coverPrompt:'Fixture cover',artistPhotoPrompt:'Fixture photo',suggestedGenre:'Piano',rationale:'Fixture'};
function setup(t){const store=new Store(':memory:');t.after(()=>store.close());return {store,studio:new StudioStore(store),a:store.addArtist(artist)};}
function project(studio,a,extra={}){return studio.save({title:'Fixture title',article:'A fictional article about a community orchestra.',artistId:a.id,parameters:{...DEFAULT_PARAMETERS,instrumental:true},...extra});}
function mockDom(a){
 const values={'studio-title':'New song','studio-article':'A fictional article about a community orchestra.','studio-artist':a.id,'studio-source':'','studio-model':'v6','studio-genre':'Piano','studio-language':'en','studio-excludes':'','studio-gender':'female','studio-styles':'','studio-weirdness':'22','studio-styleInfluence':'75','studio-variety':'40','studio-duration-preset':'radio','studio-duration':'205','studio-notes':'','studio-cover-prompt':'','studio-photo-prompt':'','studio-lyrics':''};
 const nodes=Object.fromEntries(Object.entries(values).map(([id,value])=>[id,{id,value}]));
 nodes['studio-instrumental']={checked:true};nodes['studio-max-mode']={checked:false};nodes['studio-personalize']={checked:false};
 globalThis.document={querySelector:s=>s.startsWith('#')?nodes[s.slice(1)]||null:null,getElementById:id=>nodes[id]||null};
}
for(const populated of [false,true])test(`ChatGPT new project creates once, preserving existing records (populated=${populated})`,async t=>{
 const {studio,a}=setup(t);const old=populated?project(studio,a,{title:'Unrelated original'}):null;mockDom(a);
 t.after(()=>delete globalThis.document);const state={data:{studioProjects:studio.projects()}};let saves=0;const errors=[];
 studioInput({target:{id:'studio-project-picker',value:'new'}},state,()=>{});
 const api=async(path,input)=>{if(path==='studio/projects'){saves++;return studio.save(input);}if(path.endsWith('/chatgpt-lyrics'))return studio.setResult(path.split('/')[2],brief);if(path.endsWith('/status'))return {percent:50};throw Error(path);};
 await studioAction({dataset:{action:'studio-chatgpt'}},state,api,async()=>{state.data.studioProjects=studio.projects();},(m,e)=>{if(e)errors.push(m);});
 assert.deepEqual(errors,[]);assert.equal(saves,1);assert.equal(studio.projects().length,populated?2:1);
 if(old)assert.deepEqual(studio.require(old.id),old);
});
test('missing selected project never falls back to another write target',t=>{
 const {studio,a}=setup(t);const p=project(studio,a);const state={data:{studioProjects:[p]}};
 studioInput({target:{id:'studio-project-picker',value:'missing-project'}},state,()=>{});
 assert.equal(studioActiveId(state),'');
});
test('replaying historical generation controls while saving lyrics preserves manual settings',t=>{
 const {studio,a}=setup(t),p=project(studio,a);studio.setResult(p.id,{...brief,generationParameters:{instrumental:false,vocalGender:'male',lyricLanguage:'auto'}});
 const edited=studio.save({...studio.require(p.id),parameters:{...DEFAULT_PARAMETERS,instrumental:true,vocalGender:'female',lyricLanguage:'de'}});
 const q=studio.setResult(p.id,{...edited.result,lyrics:'Edited only'});
 assert.equal(q.parameters.instrumental,true);assert.equal(q.parameters.vocalGender,'female');assert.equal(q.parameters.lyricLanguage,'de');
});
test('stale saves and generation responses reject with 409 without overwriting',t=>{
 const {studio,a}=setup(t),p=project(studio,a);const edited=studio.save({...p,title:'New title',expectedRevision:p.revision});
 assert.throws(()=>studio.save({...p,title:'Stale title',expectedRevision:p.revision}),e=>e.status===409);
 assert.throws(()=>studio.setResult(p.id,brief,{expectedRevision:p.revision}),e=>e.status===409);
 assert.deepEqual(studio.require(p.id),edited);
});
test('invalid AI parameters cannot create an unlinked artist',t=>{
 const {store,studio}=setup(t),p=studio.save({title:'New identity'}),before=store.artists().length;
 assert.throws(()=>studio.setResult(p.id,{...brief,artistName:'Rejected artist',generationParameters:{weirdness:101}}));
 assert.equal(store.artists().length,before);assert.deepEqual(studio.require(p.id).result,{});
});
test('audit failure rolls back artist creation, result and snapshots',t=>{
 const {store,studio}=setup(t),p=studio.save({title:'Rollback'}),before=store.artists().length;
 const audit=store.audit;store.audit=()=>{throw Error('Injected audit failure');};
 assert.throws(()=>studio.setResult(p.id,{...brief,artistName:'Rollback artist'}),/Injected audit failure/);store.audit=audit;
 assert.equal(store.artists().length,before);assert.deepEqual(studio.require(p.id).result,{});assert.equal(studio.history(p.id).length,1);
});
test('history is immutable and track mismatch is visible after project changes',t=>{
 const {store,studio,a}=setup(t),p=project(studio,a);studio.setResult(p.id,brief);const linked=studio.makeTrack(p.id);
 const before=store.track(linked.track.id);const prior=studio.history(p.id);
 studio.save({...studio.require(p.id),title:'Different title'});
 assert.deepEqual(store.track(before.id),before);assert.equal(studio.require(p.id).integrity.trackMismatch,true);
 assert.deepEqual(studio.history(p.id).slice(1),prior);
});
test('title and production instruction changes invalidate assets and mark brief stale',t=>{
 const {studio,a}=setup(t),p=project(studio,a);const generated=studio.setResult(p.id,brief);const hash=studioBriefFingerprint(generated);
 const changed=studio.save({...generated,title:'Different title',parameters:{...generated.parameters,customInstructions:'Include string orchestra'}});
 assert.notEqual(studioBriefFingerprint(changed),hash);assert.equal(changed.integrity.briefStale,true);
 assert.equal(sunoRecipe(changed).warnings.includes('brief_stale'),true);
});
test('cursor pagination visits all projects with equal timestamps and validates inputs',t=>{
 const {store,studio,a}=setup(t);for(let i=0;i<153;i++)project(studio,a,{title:'Song '+i});
 store.db.prepare('UPDATE studio_projects SET updated_at=?').run('2026-01-01T00:00:00Z');
 const ids=[];let cursor;do{const page=studio.projectPage({limit:31,cursor});assert.equal(page.total,153);ids.push(...page.results.map(p=>p.id));cursor=page.nextCursor;}while(cursor);
 assert.equal(ids.length,153);assert.equal(new Set(ids).size,153);assert.equal(studio.projects().length,150);
 assert.throws(()=>studio.projectPage({limit:0}));assert.throws(()=>studio.projectPage({cursor:'bad'}));
});
test('read-only inventory includes artists without projects and duplicate candidates',t=>{
 const {store,studio,a}=setup(t);project(studio,a);project(studio,a);store.addArtist({...artist,name:'No songs yet'});
 const before=store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;const x=studio.inventory();
 assert.equal(x.counts.artists,2);assert.equal(x.counts.projects,2);assert.equal(x.counts.audioAssets,0);
 assert.equal(x.artists.find(a=>a.name==='No songs yet').projectCount,0);assert.equal(x.duplicateCandidates.length,1);
 assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n,before);
});
test('new orphan links are rejected by database while legacy records survive migration',t=>{
 const {store,studio,a}=setup(t),p=project(studio,a);
 assert.throws(()=>store.db.prepare('UPDATE studio_projects SET artist_id=? WHERE id=?').run('missing',p.id));
 assert.throws(()=>store.db.prepare('UPDATE studio_projects SET track_id=? WHERE id=?').run('missing',p.id));
});
test('legacy snapshots migrate once and persist after reopening an on-disk database',t=>{
 const dir=mkdtempSync(join(tmpdir(),'blossom-integrity-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'legacy.db');
 let store=new Store(path);store.db.exec(`CREATE TABLE studio_projects(id TEXT PRIMARY KEY,title TEXT NOT NULL,article TEXT NOT NULL,source_url TEXT NOT NULL,artist_id TEXT,params TEXT NOT NULL,result TEXT NOT NULL,track_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
 const params={...DEFAULT_PARAMETERS,instrumental:true};store.db.prepare('INSERT INTO studio_projects VALUES(?,?,?,?,?,?,?,?,?,?)').run('legacy','Original','Article','','legacy-orphan',JSON.stringify(params),JSON.stringify(brief),null,'2026-01-01','2026-01-01');store.close();
 for(let i=0;i<2;i++){store=new Store(path);try{const studio=new StudioStore(store),p=studio.require('legacy');assert.equal(p.title,'Original');assert.deepEqual(p.parameters,params);assert.deepEqual(p.result,brief);assert.equal(studio.history(p.id).length,1);assert.equal(studio.inventory().orphans.length,1);}finally{store.close();}}
});
test('completed Suno takes retain their recipes and permit another completed take',t=>{
 const {studio,a}=setup(t),p=project(studio,a);studio.setResult(p.id,brief);const recipe=sunoRecipe(studio.require(p.id));
 studio.beginSunoJob(p.id,'take-1','submitted',recipe);assert.throws(()=>studio.beginSunoJob(p.id,'duplicate','submitted',recipe),e=>e.status===409);
 studio.updateSunoJob(p.id,'take-1',{status:'complete',audioUrl:'https://example.invalid/one.mp3'});studio.markSunoImported(p.id,'take-1','asset-1');
 studio.save({...studio.require(p.id),title:'New title'});studio.beginSunoJob(p.id,'take-2','submitted',sunoRecipe(studio.require(p.id)));
 const jobs=studio.sunoJobs(p.id);assert.equal(jobs.length,2);assert.equal(jobs.find(j=>j.id==='take-1').recipe.title,recipe.title);
});

test('HTTP history, inventory and pagination require auth; lyrics preserve controls and late AI is rejected',async t=>{
 const {store,studio,a}=setup(t);const p=project(studio,a);studio.setResult(p.id,{...brief,generationParameters:{instrumental:false,vocalGender:'male'}});
 const current=studio.save({...studio.require(p.id),parameters:{...DEFAULT_PARAMETERS,instrumental:true,vocalGender:'female'}});
 let release,started;const pending=new Promise(r=>release=r),begun=new Promise(r=>started=r);
 const server=createAppServer({store,password:'integrity-test-password',provider:{available:()=>false},
   chatgptLyrics:{generate:async()=>{started();await pending;return brief;},progress:async()=>({percent:10})},localComposer:{status:async()=>({available:false})}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;let cookie='';
 const request=(path,data)=>fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json','x-blossom-request':'ui'})},...(data===undefined?{}:{body:JSON.stringify(data)})});
 for(const path of ['/api/studio/inventory','/api/studio/projects/page','/api/studio/projects/'+p.id+'/history'])assert.equal((await request(path)).status,401);
 const login=await request('/auth/login',{username:'admin',password:'integrity-test-password'});cookie=login.headers.get('set-cookie').split(';')[0];
 const page=await (await request('/api/studio/projects/page?limit=1')).json();assert.equal(page.total,1);assert.equal(page.results[0].id,p.id);
 assert.equal((await request('/api/studio/projects/page?limit=0')).status,400);
 const saved=await (await request('/api/studio/projects/'+p.id+'/lyrics',{lyrics:'Only a lyric edit',expectedRevision:current.revision})).json();
 assert.equal(saved.parameters.instrumental,true);assert.equal(saved.parameters.vocalGender,'female');assert.equal(saved.integrity.briefStale,true);
 const response=request('/api/studio/projects/'+p.id+'/chatgpt-lyrics',{});await begun;
 studio.save({...studio.require(p.id),title:'Changed while generating'});release();assert.equal((await response).status,409);
 assert.equal(studio.require(p.id).title,'Changed while generating');
 assert.ok((await (await request('/api/studio/projects/'+p.id+'/history')).json()).length>=3);
 assert.equal((await (await request('/api/studio/inventory')).json()).counts.projects,1);
});

test('diagnostic CLI reads a legacy database without creating tables or touching data',t=>{
 const dir=mkdtempSync(join(tmpdir(),'blossom-diagnostic-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'legacy.db');
 const store=new Store(path);store.addArtist(artist);const before=store.db.prepare("SELECT name FROM sqlite_master ORDER BY name").all();
 const run=spawnSync(process.execPath,['scripts/diagnose-studio.mjs','--db',path],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).counts.artists,1);
 assert.deepEqual(store.db.prepare("SELECT name FROM sqlite_master ORDER BY name").all(),before);store.close();
 const invalid=spawnSync(process.execPath,['scripts/diagnose-studio.mjs'],{encoding:'utf8'});assert.equal(invalid.status,1);
});

test('string requests conflicting with a saved solo piano brief are visible in the recipe',t=>{
 const {studio,a}=setup(t),p=project(studio,a);studio.setResult(p.id,brief);
 const q=studio.save({...studio.require(p.id),parameters:{...DEFAULT_PARAMETERS,instrumental:true,customInstructions:'Include a string orchestra'}});
 assert.equal(q.integrity.instructionConflicts.length,1);assert.ok(sunoRecipe(q).warnings.includes('instruction_conflict'));
});

test('imported take can link its historical source without relabelling it as the latest project',t=>{
 const {store,studio,a}=setup(t),p=project(studio,a);const original=studio.setResult(p.id,brief);
 studio.save({...original,title:'Later working title'});
 const linked=studio.makeTrack(p.id,{sourceRevision:original.revision});assert.equal(linked.track.title,original.title);
 assert.equal(studio.require(p.id).integrity.trackMismatch,true);assert.equal(store.track(linked.track.id).concept,original.result.concept);
});

test('DNA selection and new analysis revisions invalidate old input and retain the used analysis ID',t=>{
 const {store,studio,a}=setup(t),dna=new MusicDNA(store),refs=new StudioReferences(store,studio,dna),p=project(studio,a);
 const profile=dna.create({artist:'Fixture reference',title:'Reference',sourceKind:'manual'});
 const analysis={analysisMethod:'editorial',analyzer:'fixture',confidence:0.5,genres:['Piano'],moods:[],instruments:[],vocals:{type:'instrumental'},production:{},sections:[],summary:'Synthetic profile'};
 dna.saveAnalysis(profile.id,analysis);refs.set(p.id,[{profileId:profile.id,weight:50}]);
 const generated=studio.setResult(p.id,brief);assert.equal(generated.referenceInputs.length,1);
 const oldHash=inputFingerprint(generated),usedId=generated.referenceInputs[0].analysisId;
 dna.saveAnalysis(profile.id,{...analysis,summary:'A revised synthetic profile'});
 assert.equal(studio.require(p.id).integrity.briefStale,true);
 assert.throws(()=>studio.setResult(p.id,brief,{expectedRevision:generated.revision,expectedInputHash:oldHash}),e=>e.status===409);
 assert.equal(studio.history(p.id)[0].snapshot.referenceInputs[0].analysisId,usedId);
});

test('partial control updates preserve other settings and generated artists use accepted controls',t=>{
 const {store,studio,a}=setup(t),p=project(studio,a);
 const q=studio.save({...p,parameters:{weirdness:33}});assert.equal(q.parameters.instrumental,true);assert.equal(q.parameters.weirdness,33);
 const empty=studio.save({title:'New artist'});const result=studio.setResult(empty.id,{...brief,artistName:'Generated instrumental identity',generationParameters:{instrumental:true,lyricLanguage:'fr'}});
 assert.equal(store.artist(result.artistId).voice,'instrumental');assert.equal(store.artist(result.artistId).language,'fr');
 assert.throws(()=>studio.setResult(p.id,{...brief,exclusions:'invalid list'}));
});

test('applying artist defaults to a new project keeps the newly returned ID active',async t=>{
 const {studio,a}=setup(t);project(studio,a,{title:'Previous project'});mockDom(a);t.after(()=>delete globalThis.document);
 const state={data:{studioProjects:studio.projects(),studioArtistPresets:{[a.id]:{...DEFAULT_PARAMETERS,instrumental:true}}}};let created;
 studioInput({target:{id:'studio-project-picker',value:'new'}},state,()=>{});
 await studioAction({dataset:{action:'studio-use-preset'}},state,async(path,input)=>{assert.equal(path,'studio/projects');created=studio.save(input);return created;},async()=>{state.data.studioProjects=studio.projects();},()=>{});
 assert.equal(studioSelectedId(),created.id);assert.equal(studioActiveId(state),created.id);assert.equal(studio.projects().length,2);
});

test('creating an artist adds its select option before linking the project',async t=>{
 const {store,studio,a}=setup(t);mockDom(a);const select=document.querySelector('#studio-artist');select.options=[];select.add=option=>select.options.push(option);
 globalThis.window={prompt:()=> 'New linked artist'};globalThis.Option=class {constructor(text,value){this.text=text;this.value=value;}};
 t.after(()=>{delete globalThis.document;delete globalThis.window;delete globalThis.Option;});
 const state={data:{studioProjects:[],artists:[]}};const errors=[];
 studioInput({target:{id:'studio-project-picker',value:'new'}},state,()=>{});
 const api=async(path,input)=>path==='artists'?store.addArtist(input):studio.save(input);
 await studioAction({dataset:{action:'studio-create-artist'}},state,api,async()=>{state.data.studioProjects=studio.projects();},(m,e)=>{if(e)errors.push(m);});
 assert.deepEqual(errors,[]);const created=store.artists().find(x=>x.name==='New linked artist');assert.ok(created);assert.equal(select.options[0].value,created.id);assert.equal(studio.projects()[0].artistId,created.id);
});

test('generated edit sequences preserve all immutable snapshots and stale-write invariants',t=>{
 const {studio,a}=setup(t);let p=project(studio,a);const expected=new Map([[p.revision,p.title]]);
 let seed=17;for(let i=0;i<30;i++){
   seed=(seed*1664525+1013904223)>>>0;const old=p;
   p=studio.save({...p,title:'Variant '+seed,parameters:{weirdness:seed%101},expectedRevision:p.revision});expected.set(p.revision,p.title);
   assert.equal(p.parameters.instrumental,true);assert.throws(()=>studio.save({...old,title:'Lost update',expectedRevision:old.revision}),e=>e.status===409);
 }
 const versions=studio.history(p.id);assert.equal(versions.length,31);
 for(const v of versions)assert.equal(v.snapshot.title,expected.get(v.revision));
});

test('an explicitly regenerated identical brief acknowledges the new input version',t=>{
 const {studio,a}=setup(t),p=project(studio,a);studio.setResult(p.id,brief);
 const edited=studio.save({...studio.require(p.id),title:'New working title'});assert.equal(edited.integrity.briefStale,true);
 const regenerated=studio.setResult(p.id,brief,{generated:true,expectedRevision:edited.revision});
 assert.equal(regenerated.integrity.briefStale,false);
});

test('assigning an artist to a project with a legacy selected photo composes transactions',t=>{
 const {studio,a}=setup(t),p=studio.save({title:'Photo before artist'});
 const image=studio.registerAsset(p.id,'artist-photo','11111111-1111-4111-8111-111111111111.png','image/png');studio.selectAsset(p.id,image.id,'artist-photo');
 const assigned=studio.save({...studio.require(p.id),artistId:a.id});
 assert.equal(assigned.artistId,a.id);assert.equal(studio.artistImages(a.id).length,1);assert.equal(studio.artistImages(a.id)[0].selected,true);
});

test('legacy Suno jobs migrate before integrity initialization and survive restart',t=>{
  const store=new Store(':memory:');t.after(()=>store.close());
  let studio=new StudioStore(store);
  const a=store.addArtist(artist),p=project(studio,a);
  store.db.exec('DROP TABLE studio_suno_jobs; CREATE TABLE studio_suno_jobs(project_id TEXT PRIMARY KEY,job_id TEXT,status TEXT,audio_url TEXT,imported_asset_id TEXT,created_at TEXT,updated_at TEXT)');
  store.db.prepare('INSERT INTO studio_suno_jobs VALUES(?,?,?,?,?,?,?)').run(p.id,'legacy-job','complete','https://example.invalid/audio','legacy-asset','2026-01-01','2026-01-02');
  studio=new StudioStore(store);
  const take=store.db.prepare('SELECT * FROM studio_suno_takes WHERE job_id=?').get('legacy-job');
  assert.equal(take.submitted_at,'2026-01-01');assert.equal(take.imported_asset_id,'legacy-asset');
  new StudioStore(store);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM studio_suno_takes WHERE job_id=?').get('legacy-job').n,1);
});
