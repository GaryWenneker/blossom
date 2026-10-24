import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Store } from '../src/storage.mjs';
import { StudioStore, studioBriefFingerprint } from '../src/studio.mjs';
import { createAppServer } from '../src/server.mjs';
import { studioView,studioAction,STUDIO_ASSET_VERSION } from '../public/studio.js';

const file='12345678-1234-1234-1234-123456789abc.png';
const brief={concept:'A fictional journey',lyrics:'[Verse 1] On the road',style:'Acoustic country',exclusions:[],moods:[],titles:['A Road'],coverPrompt:'A winter road through the mountains',artistPhotoPrompt:'A fictional country singer beside a car',suggestedGenre:'Country Pop',rationale:'Fictional story'};

test('asset migration preserves legacy files without claiming ChatGPT provenance or selecting them',()=>{
  const store=new Store(':memory:');
  try {
    const studio=new StudioStore(store),project=studio.save({title:'Legacy'});
    // Original pre-migration insert: newly added metadata must default honestly.
    store.db.prepare('INSERT INTO studio_assets(id,project_id,kind,filename,mime,created_at) VALUES(?,?,?,?,?,?)')
      .run('legacy-id',project.id,'cover',file,'image/png','2026-01-01');
    new StudioStore(store); // Idempotent setup, including a second MCP instance.
    const [asset]=studio.assets(project.id);
    assert.equal(asset.provider,'unknown');assert.equal(asset.selected,false);assert.equal(asset.briefMatch,'unknown');
    assert.equal(studio.asset(asset.id).filename,file);
  } finally {store.close();}
});

test('selection is explicit, exclusive per role, project-scoped and stable when new images arrive',()=>{
  const store=new Store(':memory:');
  try {
    const studio=new StudioStore(store),p=studio.save({title:'A'}),other=studio.save({title:'B'});
    const a=studio.registerAsset(p.id,'cover',file,'image/png');
    const b=studio.registerAsset(p.id,'cover',file,'image/png');
    assert.equal(studio.assets(p.id).some(x=>x.selected),false);
    studio.selectAsset(p.id,a.id,'cover');
    studio.registerAsset(p.id,'cover',file,'image/png');
    assert.equal(studio.assets(p.id).find(x=>x.selected).id,a.id);
    studio.selectAsset(p.id,b.id,'cover');
    assert.deepEqual(studio.assets(p.id).filter(x=>x.selected).map(x=>x.id),[b.id]);
    studio.selectAsset(p.id,a.id,'artist-photo');
    assert.equal(studio.assets(p.id).filter(x=>x.selected).length,2);
    assert.throws(()=>studio.selectAsset(other.id,a.id,'cover'),/not found/);
    assert.throws(()=>studio.deleteAsset(other.id,a.id),/not found/);
    assert.throws(()=>studio.selectAsset(p.id,a.id,'audio'),/role/);
    studio.deleteAsset(p.id,a.id);
    assert.equal(studio.asset(a.id),undefined);
    assert.equal(studio.assets(p.id).find(x=>x.id===a.id),undefined);
    assert.equal(store.db.prepare('SELECT filename,deleted_at FROM studio_assets WHERE id=?').get(a.id).filename,file);
    assert.equal(studio.assets(p.id).find(x=>x.id===b.id).selected,true);
  } finally {store.close();}
});

test('recorded brief and provider distinguish current, earlier and legacy assets',()=>{
  const store=new Store(':memory:');
  try {
    const studio=new StudioStore(store),project=studio.save({article:'A fictional news story about a journey in winter.'});
    const p=studio.setResult(project.id,brief);
    const image=studio.registerAsset(p.id,'cover',file,'image/png',{provider:'chatgpt',prompt:brief.coverPrompt,briefFingerprint:studioBriefFingerprint(p)});
    assert.equal(image.briefMatch,'current');assert.equal(image.provider,'chatgpt');
    studio.save({...p,title:'Retitled'});
    assert.equal(studio.assets(p.id)[0].briefMatch,'current');
    studio.setResult(p.id,{...brief,lyrics:'New song lyrics'});
    assert.equal(studio.assets(p.id)[0].briefMatch,'earlier');
  } finally {store.close();}
});

test('authenticated image generation records ChatGPT and context; select/delete guard project ownership',async t=>{
  const store=new Store(':memory:');let observed;
  const server=createAppServer({store,password:'long-test-password',provider:{available:()=>false},
    localComposer:{status:async()=>({available:false})},
    chatgptImages:{async generate(input){observed=input;return {filename:file,mime:'image/png',provider:'chatgpt'};}},
    draw:{enabled:()=>true,generate(){throw Error('Local images must not run');}}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
  const base='http://127.0.0.1:'+server.address().port;let cookie='';
  const post=(path,body={},headers={})=>fetch(base+path,{method:'POST',headers:{cookie,'content-type':'application/json','x-blossom-request':'ui',...headers},body:JSON.stringify(body)});
  const login=await post('/auth/login',{username:'admin',password:'long-test-password'});cookie=login.headers.get('set-cookie').split(';')[0];
  const status=await (await fetch(base+'/api/studio/status',{headers:{cookie}})).json();
  assert.equal(status.imageProvider,'chatgpt');assert.equal(status.drawConfigured,false);assert.equal(status.studioVersion,STUDIO_ASSET_VERSION);
  const p=await (await post('/api/studio/projects',{title:'Current project',article:'A sufficiently long fictional story about the countryside.'})).json();
  await post('/api/studio/projects/'+p.id+'/result',brief);
  const image=await (await post('/api/studio/projects/'+p.id+'/generate-art',{kind:'cover'})).json();
  assert.equal(observed.context.concept,brief.concept);assert.equal(observed.context.lyrics,brief.lyrics);
  assert.equal(image.provider,'chatgpt');assert.equal(image.briefMatch,'current');assert.equal(image.selected,true);
  const variant=await (await post('/api/studio/projects/'+p.id+'/generate-art',{kind:'cover'})).json();
  assert.equal(variant.selected,true,'a new album cover replaces the selected cover');
  assert.equal((await (await fetch(base+'/api/studio/projects/'+p.id+'/assets',{headers:{cookie}})).json())
    .find(asset=>asset.id===image.id).selected,false);
  const route='/api/studio/projects/'+p.id+'/assets/'+image.id;
  const forbidden=await post(route+'/select',{kind:'cover'},{Origin:'https://evil.example'});assert.equal(forbidden.status,403);
  assert.equal((await post(route+'/select',{kind:'cover'})).status,200);
  const recipe=await (await fetch(base+'/api/studio/projects/'+p.id+'/recipe',{headers:{cookie}})).json();
  assert.equal(recipe.selectedAssets[0].id,image.id);
  const other=await (await post('/api/studio/projects',{title:'Other'})).json();
  assert.equal((await post('/api/studio/projects/'+other.id+'/assets/'+image.id+'/delete')).status,404);
  assert.equal((await post(route+'/delete')).status,200);
  assert.equal((await fetch(base+image.url,{headers:{cookie}})).status,404);
  assert.equal(store.db.prepare('SELECT filename FROM studio_assets WHERE id=?').get(image.id).filename,file);
});

test('UI shows only selected previews, provenance and actionable removal/role choices',()=>{
  const state={data:{studioProjects:[],studioStatus:{studioVersion:STUDIO_ASSET_VERSION},studioAssets:[
    {id:'noise',kind:'cover',url:'/old-noise.png',provider:'unknown',briefMatch:'unknown',createdAt:'2026-01-01',selected:false},
    {id:'chosen',kind:'cover',url:'/chosen.png',provider:'chatgpt',briefMatch:'current',createdAt:'2026-01-02',selected:true,prompt:'A car on a road'}
  ]}};
  const html=studioView(state);
  assert.match(html,/<div class="studio-assetpreview"><img src="\/chosen.png"/);
  assert.match(html,/Legacy · provider unknown/);assert.match(html,/Current song brief/);
  assert.match(html,/Use as cover/);assert.match(html,/Use as artist photo/);assert.match(html,/studio-delete-asset/);
  assert.doesNotMatch(html,/DRAW THINGS|Draw Things:|local image generation available/);
});

test('new UI refuses unverified old image routing without saving or generating',async()=>{
  const messages=[];let called=false;
  await studioAction({dataset:{action:'studio-cover'},disabled:false},{data:{studioStatus:{drawConfigured:true}}},async()=>{called=true},async()=>{},text=>messages.push(text));
  assert.equal(called,false);assert.match(messages[0],/Restart the updated Blossom server/);
});

test('selection refresh keeps unsaved lyric and prompt edits without saving or creating another project',async()=>{
  const previous=globalThis.document;
  const fields={lyrics:{id:'studio-lyrics',value:'My unsaved lyrics'},prompt:{id:'studio-cover-prompt',value:'My custom art direction'}};
  globalThis.document={querySelectorAll:()=>Object.values(fields),getElementById:id=>Object.values(fields).find(x=>x.id===id)};
  const calls=[],messages=[];
  try {
    await studioAction({dataset:{action:'studio-select-asset',assetId:'a',kind:'cover'},disabled:false},
      {data:{studioProjects:[{id:'p'}],studioStatus:{studioVersion:STUDIO_ASSET_VERSION}}},
      async(path,body)=>calls.push({path,body}),
      async()=>{fields.lyrics.value='Old saved lyrics';fields.prompt.value='Old prompt'},
      text=>messages.push(text));
    assert.equal(calls.length,1);assert.equal(calls[0].path,'studio/projects/p/assets/a/select');
    assert.equal(fields.lyrics.value,'My unsaved lyrics');assert.equal(fields.prompt.value,'My custom art direction');
    assert.match(messages[0],/Selected asset/);
  } finally {if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
