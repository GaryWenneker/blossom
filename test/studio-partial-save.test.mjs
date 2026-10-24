import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Store } from '../src/storage.mjs';
import { StudioStore,DEFAULT_PARAMETERS } from '../src/studio.mjs';
import { createAppServer } from '../src/server.mjs';

const artist={name:'Partial fixture',genre:'Piano',language:'fr',countries:[],voice:'female',dna:'Piano and strings'};
function fixture(t,path=':memory:'){
 const store=new Store(path);t.after(()=>store.close());const studio=new StudioStore(store),a=store.addArtist(artist);
 const p=studio.save({title:'Original',article:'An original article about a village orchestra.',sourceUrl:'https://example.org/source',artistId:a.id,parameters:{...DEFAULT_PARAMETERS,instrumental:true,vocalGender:'female',weirdness:17}});
 studio.setResult(p.id,{concept:'Original concept',lyrics:'Original lyrics',style:'Piano',exclusions:[],moods:[],titles:['Original'],generationParameters:{instrumental:false}});
 studio.save({...studio.require(p.id),parameters:{instrumental:true}});
 return {store,studio,p:studio.require(p.id),a};
}
test('legacy partial saves preserve every omitted field',t=>{
 const {studio,p}=fixture(t);const updated=studio.save({id:p.id,title:'Changed title',parameters:{weirdness:31}});
 assert.equal(updated.article,p.article);assert.equal(updated.sourceUrl,p.sourceUrl);assert.equal(updated.artistId,p.artistId);
 assert.equal(updated.parameters.instrumental,true);assert.equal(updated.parameters.vocalGender,'female');assert.deepEqual(updated.result,p.result);
});
test('partial project/result/parameter updates are atomic, preserve omissions and support explicit clearing',t=>{
 const {studio,p}=fixture(t);const updated=studio.patch(p.id,{article:'',parameters:{weirdness:31},result:{lyrics:'Only new lyrics'}},{expectedRevision:p.revision});
 assert.equal(updated.article,'');assert.equal(updated.title,p.title);assert.equal(updated.artistId,p.artistId);assert.equal(updated.sourceUrl,p.sourceUrl);
 assert.equal(updated.parameters.instrumental,true);assert.equal(updated.parameters.vocalGender,'female');assert.equal(updated.parameters.weirdness,31);
 assert.equal(updated.result.style,p.result.style);assert.equal(updated.result.lyrics,'Only new lyrics');assert.deepEqual(updated.result.generationParameters,p.result.generationParameters);
 assert.equal(updated.revision,p.revision+1);assert.equal(studio.history(p.id)[0].snapshot.result.lyrics,'Only new lyrics');
});
test('stale disjoint fields merge with base values; same-field conflicts never overwrite',t=>{
 const {studio,p}=fixture(t);studio.patch(p.id,{parameters:{weirdness:33}},{expectedRevision:p.revision});
 const q=studio.patch(p.id,{title:'Concurrent title'},{expectedRevision:p.revision,baseValues:{title:p.title}});
 assert.equal(q.parameters.weirdness,33);assert.equal(q.title,'Concurrent title');
 assert.throws(()=>studio.patch(p.id,{title:'Lost update'},{expectedRevision:p.revision,baseValues:{title:p.title}}),e=>e.status===409);
 assert.throws(()=>studio.patch(p.id,{article:'No precondition'},{expectedRevision:p.revision}),e=>e.status===409);
 assert.deepEqual(studio.require(p.id),q);
});
test('no-op patches are revision-idempotent, unsafe or invalid fields do not partially commit',t=>{
 const {store,studio,p}=fixture(t),n=studio.history(p.id).length;assert.deepEqual(studio.patch(p.id,{title:p.title}),p);assert.equal(studio.history(p.id).length,n);
 for(const changes of [{parameters:null},{result:null},{trackId:'fake'},{parameters:{unknown:5}},{result:{generationParameters:{instrumental:false}}},{title:null},{parameters:{weirdness:999}},{result:{lyrics:7}},{result:{moods:'bad'}},{sourceUrl:'javascript:alert(1)'},{sourceUrl:'invalid url'},{artistId:'missing'}]){
   assert.throws(()=>studio.patch(p.id,changes));assert.deepEqual(studio.require(p.id),p);
 }
 const audit=store.audit;store.audit=()=>{throw Error('Audit unavailable');};
 assert.throws(()=>studio.patch(p.id,{title:'Rollback'}),/Audit unavailable/);store.audit=audit;assert.deepEqual(studio.require(p.id),p);
 const q=studio.patch(p.id,{result:{moods:['Hopeful'],exclusions:[]}});assert.deepEqual(q.result.moods,['Hopeful']);assert.deepEqual(q.result.exclusions,[]);assert.equal(q.result.lyrics,p.result.lyrics);
});
test('retried new-draft requests create one durable project',t=>{
 const {studio}=fixture(t);const input={title:'One draft',requestId:'request-fixture-123'};
 const first=studio.save(input),retry=studio.save({...input,title:'Retry with changed text'});
 assert.equal(retry.id,first.id);assert.equal(retry.title,'One draft');
});

test('replaying an already acknowledged lyric edit does not create another revision',t=>{
 const {studio,p}=fixture(t),count=studio.history(p.id).length;
 const result=studio.setResult(p.id,p.result,{applyParameters:false,expectedRevision:p.revision});
 assert.equal(result.revision,p.revision);assert.equal(studio.history(p.id).length,count);
});
test('partial fields survive closing and reopening an actual database',t=>{
 const dir=mkdtempSync(join(tmpdir(),'blossom-partial-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'data.db');
 let store=new Store(path),studio=new StudioStore(store);const a=store.addArtist(artist);let p=studio.save({title:'Disk title',article:'Original article',artistId:a.id});
 p=studio.patch(p.id,{parameters:{instrumental:true},result:{lyrics:'Persistent lyrics'}},{expectedRevision:p.revision});store.close();
 store=new Store(path);try{studio=new StudioStore(store);const loaded=studio.require(p.id);assert.equal(loaded.article,'Original article');assert.equal(loaded.title,'Disk title');assert.equal(loaded.artistId,a.id);assert.equal(loaded.parameters.instrumental,true);assert.equal(loaded.result.lyrics,'Persistent lyrics');}finally{store.close();}
});
test('HTTP PATCH enforces authentication, request protection and partial-write semantics',async t=>{
 const {store,studio,p}=fixture(t),server=createAppServer({store,password:'partial-test-password',provider:{available:()=>false},localComposer:{status:async()=>({available:false})}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;let cookie='';
 const request=(method,path,data,headers={})=>fetch(base+path,{method,headers:{'content-type':'application/json','x-blossom-request':'ui',...(cookie?{cookie}:{}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const path='/api/studio/projects/'+p.id;
 assert.equal((await request('PATCH',path,{changes:{title:'No login'}})).status,401);
 const login=await request('POST','/auth/login',{username:'admin',password:'partial-test-password'});cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('PATCH',path,{changes:{title:'Cross-origin'}},{origin:'https://evil.example'})).status,403);
 assert.equal((await request('PATCH',path,{changes:{title:'No header'}},{'x-blossom-request':''})).status,403);
 const response=await request('PATCH',path,{changes:{result:{lyrics:'Saved by HTTP'}},expectedRevision:p.revision});assert.equal(response.status,200);
 const q=await response.json();assert.equal(q.title,p.title);assert.equal(q.article,p.article);assert.equal(q.parameters.instrumental,true);assert.equal(q.result.lyrics,'Saved by HTTP');
 assert.equal(studio.require(p.id).result.lyrics,'Saved by HTTP');
});
