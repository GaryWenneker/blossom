import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioPersistence,projectChanges,mergeEdits } from '../public/studio-persistence.js';
import { Store } from '../src/storage.mjs';
import { StudioStore,DEFAULT_PARAMETERS } from '../src/studio.mjs';

const storage=()=>{const entries=new Map();return {getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};};
const draft={title:'Draft',article:'Article',sourceUrl:'',artistId:'',parameters:{...DEFAULT_PARAMETERS},result:{}};
function setup(t,extra={}){
 const db=new Store(':memory:');t.after(()=>db.close());const studio=new StudioStore(db),p=studio.save(draft),calls=[];
 const request=async(path,data,options)=>{calls.push({path,data,options});if(!data)return studio.require(path.split('/')[2]);return options?.method==='PATCH'?studio.patch(path.split('/')[2],data.changes,data):studio.save(data);};
 const s=storage(),events=[],controller=new StudioPersistence({project:p,request,storage:s,key:'draft',delay:60000,onStatus:(...v)=>events.push(v),...extra});
 t.after(()=>clearTimeout(controller.timer));return {studio,p,request,calls,s,events,controller};
}
test('diff includes only changed nested fields, never historical generation controls',()=>{
 const base={...draft,result:{lyrics:'Old',generationParameters:{instrumental:false}}};
 assert.deepEqual(projectChanges(base,{...base,parameters:{...base.parameters,weirdness:44},result:{...base.result,lyrics:'New'}}),{parameters:{weirdness:44},result:{lyrics:'New'}});
});
test('autosave persists only changed values and clears its backup after acknowledgement',async t=>{
 const {controller,calls,s,studio,p}=setup(t);controller.edit({parameters:{weirdness:44},result:{lyrics:'New'}});assert.ok(s.getItem('draft'));
 await controller.flush();assert.equal(calls.length,1);assert.equal(calls[0].options.method,'PATCH');assert.deepEqual(calls[0].data.changes,{parameters:{weirdness:44},result:{lyrics:'New'}});
 assert.equal(studio.require(p.id).title,p.title);assert.equal(studio.require(p.id).result.lyrics,'New');assert.equal(s.getItem('draft'),null);
});
test('typing during a pending request is serialized and saved in a second partial update',async t=>{
 const {controller,request,calls,studio,p}=setup(t);let release,started;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);let first=true;
 controller.request=async(...args)=>{if(first){first=false;started();await gate;}return request(...args);};
 controller.edit({title:'First edit'});const saving=controller.flush();await ready;controller.edit({result:{lyrics:'Typed while saving'}});release();await saving;
 assert.equal(calls.length,2);assert.deepEqual(calls[0].data.changes,{title:'First edit'});assert.deepEqual(calls[1].data.changes,{result:{lyrics:'Typed while saving'}});
 assert.equal(studio.require(p.id).result.lyrics,'Typed while saving');assert.equal(controller.dirty,false);
});
test('concurrent disjoint edits merge; same-field conflict stays locally recoverable across reload',async t=>{
 const {controller,studio,p,s,request}=setup(t);studio.patch(p.id,{parameters:{weirdness:31}});controller.edit({title:'My title'});await controller.flush();assert.equal(studio.require(p.id).parameters.weirdness,31);
 controller.edit({title:'My conflicting title'});studio.patch(p.id,{title:'Other tab title'});await assert.rejects(controller.flush(),e=>e.status===409);assert.ok(s.getItem('draft'));
 const restored=new StudioPersistence({project:studio.require(p.id),request,storage:s,key:'draft',delay:60000});t.after(()=>clearTimeout(restored.timer));
 assert.equal(restored.draft.title,'My conflicting title');assert.equal(studio.require(p.id).title,'Other tab title');
 await restored.resolve(true);assert.equal(studio.require(p.id).title,'My conflicting title');
});
test('choosing saved version explicitly discards only the pending edits',async t=>{
 const {controller,studio,p}=setup(t);controller.edit({title:'My title'});studio.patch(p.id,{title:'Other title'});
 await assert.rejects(controller.flush());await controller.resolve(false);assert.equal(controller.draft.title,'Other title');assert.equal(controller.dirty,false);
});
test('new draft retry after lost acknowledgement creates once and retains later edits and lyrics',async t=>{
 const {studio,s}=setup(t);let fail=true;
 const request=async(path,data,options)=>{if(options?.method==='PATCH')return studio.patch(path.split('/')[2],data.changes,data);const p=studio.save(data);if(fail){fail=false;throw Error('Acknowledgement lost');}return p;};
 const c=new StudioPersistence({project:{...draft,title:''},request,storage:s,key:'new',requestId:'idempotent-request-123',delay:60000});t.after(()=>clearTimeout(c.timer));
 c.edit({title:'First title',result:{lyrics:'Original lyrics'}});await assert.rejects(c.flush(),/Acknowledgement lost/);
 c.edit({title:'Later title'});await c.flush();assert.equal(studio.projects().length,2);assert.equal(studio.require(c.base.id).title,'Later title');assert.equal(studio.require(c.base.id).result.lyrics,'Original lyrics');
});
test('failed backup or network never reports a successful save',async t=>{
 const {p}=setup(t),events=[];
 const c=new StudioPersistence({project:p,request:async()=>{throw Error('Offline');},storage:{getItem:()=>null,setItem:()=>{throw Error('Storage full');}},key:'x',delay:60000,onStatus:(...event)=>events.push(event)});t.after(()=>clearTimeout(c.timer));
 c.edit({article:'Offline edit'});await assert.rejects(c.flush(),/Offline/);assert.ok(c.backupError);assert.equal(events.some(e=>e[0]==='saved'),false);assert.equal(c.draft.article,'Offline edit');
});

test('typing while explicitly resolving a conflict is retained in the resolved patch',async t=>{
 const {controller,studio,p,request}=setup(t);controller.edit({title:'My title'});studio.patch(p.id,{title:'Other title'});await assert.rejects(controller.flush());
 let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 controller.request=async(...args)=>{if(args[1]===undefined){started();await gate;}return request(...args);};
 const resolving=controller.resolve(true);await ready;controller.edit({result:{lyrics:'Typed during conflict resolution'}});release();await resolving;
 assert.equal(studio.require(p.id).title,'My title');assert.equal(studio.require(p.id).result.lyrics,'Typed during conflict resolution');
});
