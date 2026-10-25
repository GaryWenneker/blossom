import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage.mjs';
import { StudioStore } from '../src/studio.mjs';
import { Discography } from '../src/discography.mjs';
import { discographyView,discographyRefresh,discographyAction } from '../public/discography.js';

test('discography renders escaped artist identity, release types, independent songs and album controls',async t=>{
 const store=new Store(),studio=new StudioStore(store),c=new Discography(store,studio);t.after(()=>store.close());
 const artist=store.addArtist({name:'Band <img onerror=alert(1)>',genre:'Indie',language:'en',voice:'mixed',dna:'Guitars'});
 const p=studio.save({title:'A < B',artistId:artist.id}),q=studio.save({title:'Second song',artistId:artist.id});
 const a=c.create({artistId:artist.id,title:'First album'});c.add(a.id,[{songId:'project:'+p.id},{songId:'project:'+q.id}],a.revision);
 const state={data:{artists:[artist],artistBanners:{}},discography:{artistId:artist.id,albumId:'',albums:[],songs:[],filter:'all',album:null}};
 const api=async(path,input)=>{
  if(path.startsWith('albums?'))return c.albums(artist.id);
  if(path.startsWith('catalog/songs?'))return c.songs(artist.id);
  if(path.endsWith('/reorder'))return c.reorder(a.id,input.entryIds,input.expectedRevision);
  if(path.endsWith('/remove'))return c.remove(a.id,path.split('/')[3],input.expectedRevision);
  if(path==='albums/'+a.id)return c.album(a.id);
  throw Error('Unexpected route '+path);
 };
 const refresh=()=>discographyRefresh(state,api);await refresh();
 let html=discographyView(state);assert.match(html,/Band &lt;img onerror=alert\(1\)&gt;/);assert.doesNotMatch(html,/<img onerror/);
 assert.match(html,/aria-pressed="true">All/);assert.match(html,/All songs/);assert.match(html,/A &lt; B/);
 await discographyAction({dataset:{action:'catalog-open',albumId:a.id}},state,api,refresh,()=>{},()=>{});
 html=discographyView(state);assert.match(html,/catalog-album-hero/);assert.match(html,/Choose recording for A &lt; B/);assert.match(html,/draggable="true"/);assert.match(html,/Upload square album cover/);
 const first=state.discography.album.entries[0].id,last=state.discography.album.entries[1].id;
 await discographyAction({dataset:{action:'catalog-move',entryId:last,direction:'-1'}},state,api,refresh,()=>{},()=>{});
 assert.deepEqual(c.album(a.id).entries.map(e=>e.id),[last,first]);
 await discographyAction({dataset:{action:'catalog-remove',entryId:first}},state,api,refresh,()=>{},()=>{});
 assert.equal(c.album(a.id).entries.length,1);assert.ok(studio.project(p.id));
 await discographyAction({dataset:{action:'catalog-artist'}},state,api,refresh,()=>{},()=>{});assert.equal(state.discography.albumId,'');
 assert.equal(await discographyAction({dataset:{action:'unrelated'}},state,api,refresh,()=>{},()=>{}),false);
});
