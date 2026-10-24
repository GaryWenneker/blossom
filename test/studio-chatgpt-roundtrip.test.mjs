import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Store } from '../src/storage.mjs';
import { StudioStore, sunoRecipe } from '../src/studio.mjs';
import { buildChatGptLyricsPrompt, parseChatGptBrief } from '../src/chatgpt-playwright.mjs';
import { chatGptDomScripts } from '../src/chatgpt-dom.mjs';
import { ChatGptImages } from '../src/chatgpt-images.mjs';
import { createAppServer } from '../src/server.mjs';

const brief={concept:'A fictional journey',lyrics:'[Verse 1]\nA quiet road\n[Chorus]\nHome again',style:'Dry acoustic country pop',exclusions:['EDM drops'],moods:['reflective'],titles:['Home Again'],coverPrompt:'A winter road in an Alpine valley',artistPhotoPrompt:'A fictional singer in natural daylight',suggestedGenre:'Country Pop',rationale:'Original fictional story'};

test('Safari scripts compile, wait for composer state, ignore old replies and streaming output',()=>{
  const scripts=chatGptDomScripts('A prompt with "quotes" and \'apostrophes\'\nAnd a new line');
  let clicks=0, inserted='',streaming=false;
  const nodes=[{innerText:'OLD RESPONSE'}];
  const editor={tagName:'DIV',focus(){},dispatchEvent(){}};
  const button={disabled:false,getAttribute(){return null},click(){clicks++}};
  const window={getSelection:()=>({removeAllRanges(){},addRange(){}})};
  const document={
    querySelector(selector){
      if(selector.includes('prompt-textarea'))return editor;
      if(selector.includes('stop-button'))return streaming?{}:null;
      return button;
    },
    querySelectorAll(){return nodes;},
    createRange(){return {selectNodeContents(){}};},
    execCommand(_name,_show,value){inserted=value;return true;}
  };
  const context=vm.createContext({window,document,Event:class {}});
  assert.equal(vm.runInContext(scripts.fill,context),'WAIT');
  assert.match(inserted,/quotes/);
  assert.equal(vm.runInContext(scripts.fill,context),'SUBMITTED');
  assert.equal(clicks,1);
  assert.equal(vm.runInContext(scripts.read,context),'WAIT');
  nodes.push({innerText:JSON.stringify(brief)});streaming=true;
  assert.equal(vm.runInContext(scripts.read,context),'WAIT');streaming=false;
  for(let i=0;i<3;i++)assert.equal(vm.runInContext(scripts.read,context),'WAIT');
  assert.equal(vm.runInContext(scripts.read,context),JSON.stringify(brief));
  // Compile the image branch as well: selectors must remain valid JavaScript.
  new vm.Script(chatGptDomScripts('Portrait',{image:true}).read);
});

test('English selection overrides Dutch source; controls survive parsing and persist atomically',()=>{
  const db=new Store(':memory:');
  try {
    const studio=new StudioStore(db);
    const p=studio.save({article:'Het dorp wordt wakker en een buurman gaat naar de winkel.',parameters:{lyricLanguage:'en',targetSeconds:215}});
    const prompt=buildChatGptLyricsPrompt(p);
    assert.match(prompt,/lyrics, titles, and concept in English/);
    assert.doesNotMatch(prompt,/Write the lyrics in Dutch/);
    assert.match(prompt,/styleInfluence/);
    const result=parseChatGptBrief(JSON.stringify({...brief,generationParameters:{weirdness:18,styleInfluence:82,variety:30}}));
    const saved=studio.setResult(p.id,result);
    assert.equal(saved.parameters.weirdness,18);
    assert.equal(saved.parameters.targetSeconds,215);
    assert.equal(saved.parameters.lyricLanguage,'en');
    assert.equal(saved.parameters.imagePrompt,brief.coverPrompt);
    const recipe=sunoRecipe(saved);
    assert.equal(recipe.title,'Home Again');
    assert.match(recipe.exclude,/EDM drops/);
    assert.equal(recipe.styleInfluence,82);
    assert.equal(recipe.lyrics,brief.lyrics);
    assert.throws(()=>studio.setResult(p.id,{...brief,lyrics:'bad replacement',generationParameters:{weirdness:999}}));
    assert.equal(studio.require(p.id).result.lyrics,brief.lyrics);
  } finally {db.close();}
});

test('ChatGPT PNG export is saved privately; unsupported, login and corrupt responses do not create assets',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'blossom-chatgpt-images-'));
  const png=Buffer.alloc(32);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.write('IHDR',12);png.writeUInt32BE(1024,16);png.writeUInt32BE(1024,20);
  let output='REPLY\ndata:image/png;base64,'+png.toString('base64');
  const generator=new ChatGptImages({directory,platform:'darwin',runner(_script,args,_opts,cb){
    assert.equal(args[0],'Safari');assert.match(args[1],/Generate one image now/);
    cb(null,output);
  }});
  try {
    const asset=await generator.generate({kind:'cover',prompt:brief.coverPrompt});
    assert.equal(asset.provider,'chatgpt');
    assert.deepEqual(await readFile(join(directory,asset.filename)),png);
    output='LOGIN';
    await assert.rejects(generator.generate({kind:'artist-photo',prompt:brief.artistPhotoPrompt}),/Sign in/);
    output='REPLY\ndata:image/png;base64,YmFk';
    await assert.rejects(generator.generate({kind:'cover',prompt:brief.coverPrompt}),/Invalid ChatGPT PNG/);
    assert.equal(generator.busy,false);
    await assert.rejects(new ChatGptImages({platform:'linux'}).generate({kind:'cover',prompt:brief.coverPrompt}),/Mac/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('Studio generates and saves lyrics, Suno controls and both ChatGPT images without Draw Things',async t=>{
  const store=new Store(':memory:');let imageCalls=[];
  const server=createAppServer({store,password:'long-test-password',provider:{available:()=>false},
    chatgptLyrics:{async generate(){return {...brief,generationParameters:{weirdness:17,styleInfluence:80}};}},
    chatgptImages:{async generate(input){imageCalls.push(input);return {filename:'12345678-1234-1234-1234-123456789abc.png',mime:'image/png'};}},
    draw:{enabled:()=>true,generate(){throw Error('Draw Things must not be called');}}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
  const base='http://127.0.0.1:'+server.address().port;
  let cookie='';
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{cookie,'content-type':'application/json','x-blossom-request':'ui'},body:JSON.stringify(body)});
  const login=await post('/auth/login',{username:'admin',password:'long-test-password'});
  cookie=login.headers.get('set-cookie').split(';')[0];
  const created=await (await post('/api/studio/projects',{article:'A fictional community comes together after a difficult winter.',parameters:{lyricLanguage:'en',targetSeconds:215}})).json();
  const p=await (await post('/api/studio/projects/'+created.id+'/chatgpt-lyrics',{})).json();
  assert.equal(p.result.lyrics,brief.lyrics);assert.equal(p.parameters.weirdness,17);
  for(const kind of ['cover','artist-photo']){
    const response=await post('/api/studio/projects/'+p.id+'/generate-art',{kind});
    assert.equal(response.status,201);const imported=await response.json();assert.equal(imported.kind,kind);assert.equal(imported.selected,true);
  }
  assert.deepEqual(imageCalls.map(x=>x.prompt),[brief.coverPrompt,brief.artistPhotoPrompt]);
  const recipe=await (await fetch(base+'/api/studio/projects/'+p.id+'/recipe',{headers:{cookie}})).json();
  assert.equal(recipe.weirdness,17);assert.equal(recipe.targetDurationSeconds,215);
  assert.match(recipe.exclude,/EDM drops/);
});

test('ChatGPT chooses a catalog artist; persistence validates IDs and preserves manual selection',()=>{
  const store=new Store(':memory:');
  try {
    const a=store.addArtist({name:'Quiet Roads',genre:'Country Pop',language:'English',countries:[],voice:'male',dna:'Dry acoustic guitar'});
    const b=store.addArtist({name:'Other Roads',genre:'Country Pop',language:'English',countries:[],voice:'male',dna:'Piano'});
    const studio=new StudioStore(store),p=studio.save({article:'A journey home'});
    const prompt=buildChatGptLyricsPrompt({...p,artistCandidates:store.artists()});
    assert.match(prompt,/Quiet Roads/);assert.match(prompt,/readable typography/);
    const parsed=parseChatGptBrief(JSON.stringify({...brief,artistId:a.id}));
    assert.equal(studio.setResult(p.id,parsed).artistId,a.id);
    assert.equal(studio.setResult(p.id,{...brief,artistId:b.id}).artistId,a.id);
    const empty=studio.save({article:'A second journey'});
    assert.throws(()=>studio.setResult(empty.id,{...brief,artistId:'invented'}),/unknown artist/);
    assert.equal(studio.require(empty.id).artistId,'');
  }finally{store.close();}
});
