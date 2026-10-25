import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage.mjs';
import { StudioStore } from '../src/studio.mjs';
import { Discography } from '../src/discography.mjs';

const artistData={name:'Album artist',genre:'Alternative',language:'fr',voice:'mixed',dna:'Bass and drums',countries:[]};
function fixture(t,filename){
 const store=new Store(filename),studio=new StudioStore(store),catalog=new Discography(store,studio);
 t.after(()=>store.close());
 const artist=store.addArtist(artistData),other=store.addArtist({...artistData,name:'Another artist'});
 const project=studio.save({title:'First song',artistId:artist.id,parameters:{instrumental:true}});
 const second=studio.save({title:'Second song',artistId:artist.id});
 const alien=studio.save({title:'Alien song',artistId:other.id});
 const firstAudio=studio.registerAsset(project.id,'audio','11111111-1111-1111-1111-111111111111.wav','audio/wav');
 studio.selectAsset(project.id,firstAudio.id,'audio');
 const album=()=>catalog.create({artistId:artist.id,title:'First album',kind:'album'});
 return {store,studio,catalog,artist,other,project,second,alien,firstAudio,album};
}
test('collections validate artist, kind, date and title, and remain separate from distributor releases',t=>{
 const f=fixture(t),a=f.album();assert.equal(a.title,'First album');assert.equal(a.kind,'album');assert.deepEqual(a.entries,[]);
 for(const kind of ['ep','single'])assert.equal(f.catalog.create({artistId:f.artist.id,title:kind,kind}).kind,kind);
 assert.throws(()=>f.catalog.create({artistId:f.artist.id,title:'',kind:'album'}),/title/i);
 assert.throws(()=>f.catalog.create({artistId:f.artist.id,title:'Bad',kind:'other'}),/kind/i);
 assert.throws(()=>f.catalog.create({artistId:f.artist.id,title:'Bad',releaseDate:'2026-02-30'}),/date/i);
 assert.throws(()=>f.catalog.create({artistId:'missing',title:'Bad'}),/artist/i);
 assert.deepEqual(f.store.releases(),[]);
});
test('catalog includes drafts, canonicalizes linked production tracks and paginates',t=>{
 const f=fixture(t);f.studio.setResult(f.project.id,{concept:'Original song',style:'Alternative',lyrics:''});
 const {track}=f.studio.makeTrack(f.project.id);
 const orphan=f.store.addTrack({artistId:f.artist.id,title:'Standalone',mode:'instrumental',concept:'Piano'});
 const all=f.catalog.songs(f.artist.id,{limit:100});assert.equal(all.results.length,3);
 assert.equal(all.results.filter(s=>s.projectId===f.project.id).length,1);
 assert.equal(f.catalog.song('track:'+track.id).id,'project:'+f.project.id);
 assert.ok(all.results.some(s=>s.id==='track:'+orphan.id));
 const page=f.catalog.songs(f.artist.id,{limit:1});assert.equal(page.results.length,1);assert.ok(page.nextCursor);
 const next=f.catalog.songs(f.artist.id,{limit:100,cursor:page.nextCursor});
 assert.equal(new Set([...page.results,...next.results].map(x=>x.id)).size,3);
 assert.equal(next.nextCursor,null);
 assert.throws(()=>f.catalog.songs(f.artist.id,{limit:-1}),/limit/i);
});
test('bulk addition is idempotent, artist-scoped and all-or-nothing',t=>{
 const f=fixture(t),a=f.album();
 const songs=[{songId:'project:'+f.project.id},{songId:'project:'+f.second.id}];
 const b=f.catalog.add(a.id,songs,a.revision);assert.equal(b.entries.length,2);
 assert.equal(f.catalog.add(a.id,songs,b.revision).entries.length,2);
 assert.throws(()=>f.catalog.add(a.id,[{songId:'project:'+f.alien.id}],b.revision),/artist/i);
 const empty=f.catalog.create({artistId:f.artist.id,title:'Atomic'});
 assert.throws(()=>f.catalog.add(empty.id,[songs[0],{songId:'project:'+f.alien.id}],empty.revision),/artist/i);
 assert.equal(f.catalog.album(empty.id).entries.length,0);
 assert.throws(()=>f.catalog.add(empty.id,[],empty.revision),/songs/i);
 assert.throws(()=>f.catalog.add(empty.id,Array(101).fill(songs[0]),empty.revision),/100/);
});
test('album recording is pinned through import, Studio selection and source asset removal',t=>{
 const f=fixture(t),a=f.album();const b=f.catalog.add(a.id,[{songId:'project:'+f.project.id}],a.revision);
 const entry=b.entries[0];assert.equal(entry.audioAssetId,f.firstAudio.id);assert.ok(entry.audioUrl);
 const newer=f.studio.registerAsset(f.project.id,'audio','22222222-2222-2222-2222-222222222222.wav','audio/wav');
 f.studio.selectAsset(f.project.id,newer.id,'audio');f.studio.deleteAsset(f.project.id,f.firstAudio.id);
 assert.equal(f.catalog.album(a.id).entries[0].audioAssetId,f.firstAudio.id);
 const switched=f.catalog.recording(a.id,entry.id,newer.id,b.revision);
 assert.equal(switched.entries[0].audioAssetId,newer.id);
 assert.equal(f.catalog.song('project:'+f.project.id).takes.length,1);
});
test('recording selection rejects cross-project assets, images and missing entries',t=>{
 const f=fixture(t),a=f.album(),b=f.catalog.add(a.id,[{songId:'project:'+f.project.id}],a.revision);
 const other=f.studio.registerAsset(f.second.id,'audio','22222222-2222-2222-2222-222222222222.wav','audio/wav');
 const image=f.studio.registerAsset(f.project.id,'cover','33333333-3333-3333-3333-333333333333.png','image/png');
 for(const id of [other.id,image.id,'missing'])assert.throws(()=>f.catalog.recording(a.id,b.entries[0].id,id,b.revision),/recording/i);
 assert.throws(()=>f.catalog.recording(a.id,'missing',f.firstAudio.id,b.revision),/entry/i);
 assert.equal(f.catalog.album(a.id).revision,b.revision);
});
test('reorder accepts only exact permutations, rejects stale writes and detach preserves all sources',t=>{
 const f=fixture(t),a=f.album(),b=f.catalog.add(a.id,[{songId:'project:'+f.project.id},{songId:'project:'+f.second.id}],a.revision);
 const ids=b.entries.map(e=>e.id);const c=f.catalog.reorder(a.id,[...ids].reverse(),b.revision);
 assert.deepEqual(c.entries.map(e=>e.id),[...ids].reverse());
 assert.throws(()=>f.catalog.reorder(a.id,ids,b.revision),/changed/i);
 for(const bad of [[],[ids[0],ids[0]],['missing',ids[0]]])assert.throws(()=>f.catalog.reorder(a.id,bad,c.revision),/permutation/i);
 const d=f.catalog.remove(a.id,ids[0],c.revision);assert.equal(d.entries.length,1);
 assert.deepEqual(d.entries.map(x=>x.position),[1]);assert.ok(f.studio.project(f.project.id));assert.ok(f.studio.asset(f.firstAudio.id));
 assert.equal(f.catalog.song('project:'+f.project.id).takes.length,1);
});
test('one song can occur in a single and album without duplication of source data',t=>{
 const f=fixture(t),a=f.album(),s=f.catalog.create({artistId:f.artist.id,title:'Single',kind:'single'});
 const item={songId:'project:'+f.project.id};f.catalog.add(a.id,[item],a.revision);f.catalog.add(s.id,[item],s.revision);
 assert.equal(f.catalog.song(item.songId).collections.length,2);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM studio_projects').get().n,3);
});
test('metadata edits have revision protection and preserve immutable artist',t=>{
 const f=fixture(t),a=f.album();const b=f.catalog.update(a.id,{title:'New title',kind:'ep',releaseDate:'2026-12-01'},a.revision);
 assert.equal(b.title,'New title');assert.equal(b.kind,'ep');assert.equal(b.releaseDate,'2026-12-01');
 assert.throws(()=>f.catalog.update(a.id,{title:'Lost edit'},a.revision),/changed/i);
 assert.throws(()=>f.catalog.update(a.id,{artistId:f.other.id},b.revision),/field/i);
 assert.throws(()=>f.catalog.update(a.id,{title:42},b.revision),/title/i);
});
test('album migration and pinned recording survive database reopen without touching existing rows',t=>{
 const dir=mkdtempSync(join(tmpdir(),'blossom-discography-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'db.sqlite'),s=new Store(file),studio=new StudioStore(s),c=new Discography(s,studio);
 const artist=s.addArtist(artistData),p=studio.save({title:'Durable',artistId:artist.id});
 const a=c.create({artistId:artist.id,title:'Durable album'});c.add(a.id,[{songId:'project:'+p.id}],a.revision);s.close();
 const reopened=new Store(file);t.after(()=>reopened.close());const c2=new Discography(reopened,new StudioStore(reopened));
 assert.equal(c2.album(a.id).entries[0].title,'Durable');assert.equal(reopened.artist(artist.id).name,artist.name);
 new Discography(reopened,new StudioStore(reopened));assert.equal(c2.albums(artist.id).results.length,1);
});
test('generated reorder permutations always round-trip and preserve membership',t=>{
 const f=fixture(t),a=f.album();const items=Array.from({length:12},(_,i)=>({songId:'project:'+f.studio.save({title:'Song '+i,artistId:f.artist.id}).id}));
 let album=f.catalog.add(a.id,items,a.revision),seed=25026;
 for(let n=0;n<30;n++){
  const ids=album.entries.map(x=>x.id);for(let i=ids.length-1;i>0;i--){seed=(seed*1664525+1013904223)>>>0;const j=seed%(i+1);[ids[i],ids[j]]=[ids[j],ids[i]];}
  album=f.catalog.reorder(a.id,ids,album.revision);assert.deepEqual(album.entries.map(x=>x.id),ids);assert.equal(new Set(ids).size,12);
 }
});
