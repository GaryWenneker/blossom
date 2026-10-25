import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Store } from "../src/storage.mjs";
import { StudioStore } from "../src/studio.mjs";
import { createAppServer } from "../src/server.mjs";
import { discographyView } from "../public/discography.js";
import { focusFromDrag,objectPosition,savedFocus,applyPhotoFocus } from "../public/artist-focus.js";

const artistInput={name:"Sample Artist",genre:"Indie Rock",language:"en",countries:["NL"],voice:"mixed",dna:"Wide group photo"};
const png="12345678-1234-1234-1234-123456789abc.png";

test("Artist images use an automatic top-safe crop and support a manual focus override",()=>{
 const store=new Store(":memory:");
 try{
  const studio=new StudioStore(store),artist=store.addArtist(artistInput);
  const image=studio.registerArtistPhoto(artist.id,{filename:png,mime:"image/png",provider:"upload"});
  assert.deepEqual(savedFocus(image),{focusX:50,focusY:0});
  assert.equal(image.focusSource,"auto");
  const manual=studio.setArtistImageFocus(artist.id,image.id,{focusX:42,focusY:18,source:"manual"});
  assert.deepEqual(savedFocus(manual),{focusX:42,focusY:18});
  assert.equal(manual.focusSource,"manual");
  assert.deepEqual({focusX:studio.artistBanners()[artist.id].focusX,focusY:studio.artistBanners()[artist.id].focusY},
    {focusX:42,focusY:18});
  assert.throws(()=>studio.setArtistImageFocus(artist.id,image.id,{focusX:101,focusY:18}),/0 to 100/);
 }finally{store.close();}
});

test("Legacy artist photo tables gain the automatic safe crop without losing images",()=>{
 const store=new Store(":memory:");
 try{
  const artist=store.addArtist(artistInput);
  store.db.exec(`CREATE TABLE studio_artist_images(
   id TEXT PRIMARY KEY,artist_id TEXT NOT NULL,source_asset_id TEXT UNIQUE,
   filename TEXT NOT NULL,mime TEXT NOT NULL,provider TEXT NOT NULL,
   prompt TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,
   selected INTEGER NOT NULL DEFAULT 0,deleted_at TEXT);
   INSERT INTO studio_artist_images(id,artist_id,filename,mime,provider,created_at,selected)
   VALUES('image-legacy','${artist.id}','${png}','image/png','upload','2026-01-01',1);`);
  const studio=new StudioStore(store),image=studio.artistImages(artist.id)[0];
  assert.equal(image.id,"image-legacy");
  assert.deepEqual(savedFocus(image),{focusX:50,focusY:0});
  assert.equal(image.focusSource,"auto");
  assert.equal(studio.artistBanners()[artist.id].focusY,0);
 }finally{store.close();}
});

test("Focus dragging preserves the source image and the discography hero uses the saved crop",()=>{
 const next=focusFromDrag({containerWidth:1200,containerHeight:300,naturalWidth:1920,naturalHeight:1080,
  focusX:50,focusY:0,dx:0,dy:-40});
 assert.ok(next.focusY>0,"dragging the image upward reveals more of the lower crop");
 assert.equal(objectPosition(50,next.focusY),"50% "+next.focusY+"%");
 const state={data:{artists:[{id:"artist-1",name:"Sample Artist",genre:"Indie Rock"}],
   artistBanners:{"artist-1":{url:"/banner.png",focusX:50,focusY:12}},genres:{}},
   discography:{artistId:"artist-1",albumId:"",albums:[],songs:[],filter:"all",album:null}};
 const html=discographyView(state);
 assert.match(html,/data-photo-focus data-focus-x="50" data-focus-y="12"/);
 assert.match(html,/catalog-artist-controls/);
 assert.match(html,/Discography/);
});

test("Authenticated focus endpoint persists the chosen point",async t=>{
 const store=new Store(":memory:"),artist=store.addArtist(artistInput),studio=new StudioStore(store);
 const image=studio.registerArtistPhoto(artist.id,{filename:png,mime:"image/png",provider:"upload"});
 const server=createAppServer({store,password:"long-test-password",provider:{available:()=>false},localComposer:{status:async()=>({available:false})}});
 server.listen(0,"127.0.0.1");await once(server,"listening");
 t.after(async()=>{await new Promise(done=>server.close(done));store.close();});
 const base="http://127.0.0.1:"+server.address().port;
 const login=await fetch(base+"/auth/login",{method:"POST",headers:{"content-type":"application/json","x-blossom-request":"ui"},
  body:JSON.stringify({username:"admin",password:"long-test-password"})});
 const cookie=login.headers.get("set-cookie").split(";")[0];
 const response=await fetch(base+"/api/studio/artists/"+artist.id+"/images/"+image.id+"/focus",{method:"POST",
  headers:{cookie,"content-type":"application/json","x-blossom-request":"ui"},body:JSON.stringify({focusX:36,focusY:11,source:"manual"})});
 assert.equal(response.status,200);
 const saved=await response.json();
 assert.equal(saved.id,image.id);assert.equal(saved.focusX,36);assert.equal(saved.focusY,11);assert.equal(saved.focusSource,"manual");
});

test("The active UI exposes a focus-point dialog and resets safely to automatic crop",async()=>{
 const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
 const css=await readFile(new URL("../public/viewport.css",import.meta.url),"utf8");
 assert.match(app,/data-action="artist-focus-open"/);
 assert.match(app,/data-action="artist-focus-auto"/);
 assert.match(app,/data-action="artist-focus-save"/);
 assert.match(app,/applyPhotoFocus\(view\)/);
 assert.match(css,/#artist-focus-dialog/);
});
