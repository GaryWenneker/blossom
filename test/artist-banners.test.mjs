import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Store } from "../src/storage.mjs";
import { StudioStore } from "../src/studio.mjs";
import { createAppServer } from "../src/server.mjs";
import { validateDrawRequest } from "../src/drawthings.mjs";
import { ChatGptImages } from "../src/chatgpt-images.mjs";
import { studioView } from "../public/studio.js";

const pngName="12345678-1234-1234-1234-123456789abc.png";
const artistData={name:"Blue Meadow Quartet",genre:"Indie Folk",language:"en",
  countries:["NL"],voice:"mixed",dna:"Multi-part harmonies and acoustic instruments"};

test("Generated Studio photo is linked to the artist's own durable media library",()=>{
  const db=new Store(":memory:");
  try{
    const studio=new StudioStore(db);
    const band=db.addArtist(artistData);
    const second=db.addArtist({...artistData,name:"Copper Lantern"});
    const p=studio.save({title:"A new original song",artistId:band.id});
    const other=studio.save({title:"Another original song",artistId:second.id});
    const cover=studio.registerAsset(p.id,"cover",pngName,"image/png");
    studio.selectAsset(p.id,cover.id,"cover");
    assert.deepEqual(studio.artistBanners(),{},"square covers are not artist banners");
    const photo1=studio.registerAsset(p.id,"artist-photo",pngName,"image/png");
    studio.selectAsset(p.id,photo1.id,"artist-photo");
    const first=studio.artistImages(band.id)[0];
    assert.equal(first.sourceAssetId,photo1.id);
    assert.equal(first.selected,true);
    assert.equal(studio.artistBanners()[band.id].assetId,first.id);
    const photo2=studio.registerAsset(other.id,"artist-photo",pngName,"image/png");
    studio.selectAsset(other.id,photo2.id,"artist-photo");
    assert.equal(studio.artistImages(second.id)[0].sourceAssetId,photo2.id);
    const replacement=studio.registerAsset(p.id,"artist-photo",pngName,"image/png");
    studio.linkArtistImage(band.id,replacement.id);
    assert.equal(studio.artistBanners()[band.id].assetId,first.id,
      "Generating a variant must preserve the current artist background");
    const variant=studio.artistImages(band.id).find(x=>x.sourceAssetId===replacement.id);
    studio.selectArtistImage(band.id,variant.id);
    assert.equal(studio.artistBanners()[band.id].assetId,variant.id);
    assert.equal(studio.artistBanners()[band.id].url,
      "/api/studio/artist-images/"+variant.id+"/content");
    studio.deleteAsset(p.id,replacement.id);
    assert.equal(studio.artistBanners()[band.id].assetId,variant.id,
      "An artist photo must survive deletion from its Studio project");
    assert.throws(()=>studio.selectArtistImage(second.id,variant.id),
      /not found for this artist/);
    studio.save({...p,artistId:second.id});
    assert.equal(studio.artistBanners()[band.id].assetId,variant.id,
      "Editing project artist must not reassign the original artist media");
  }finally{db.close();}
});

test("Artist-only photos can be generated, selected and removed without any Studio project",()=>{
  const db=new Store(":memory:");
  try{
    const studio=new StudioStore(db);
    const artist=db.addArtist(artistData);
    const a=studio.registerArtistPhoto(artist.id,{
      filename:pngName,mime:"image/png",provider:"chatgpt",prompt:"Cinematic artist banner"});
    assert.equal(a.selected,true);
    assert.equal(a.sourceAssetId,null);
    const b=studio.registerArtistPhoto(artist.id,{
      filename:pngName,mime:"image/png",provider:"chatgpt",prompt:"Second artist banner"});
    assert.equal(b.selected,false);
    studio.selectArtistImage(artist.id,b.id);
    assert.equal(studio.artistBanners()[artist.id].assetId,b.id);
    studio.deleteArtistImage(artist.id,b.id);
    assert.equal(studio.artistBanners()[artist.id].assetId,a.id);
    studio.deleteArtistImage(artist.id,a.id);
    assert.equal(studio.artistBanners()[artist.id],undefined);
    assert.throws(()=>studio.selectArtistImage(artist.id,b.id),/not found/);
  }finally{db.close();}
});

test("Legacy selected Studio artist photos migrate once and survive restart",()=>{
  const db=new Store(":memory:");
  try{
    const artist=db.addArtist(artistData);
    const store=new StudioStore(db);
    const p=store.save({title:"Old project",artistId:artist.id});
    const photo=store.registerAsset(p.id,"artist-photo",pngName,"image/png");
    // Simulate previous schema after upgrade: a Studio selection, without
    // a standalone artist image record.
    db.db.prepare("UPDATE studio_assets SET selected=1 WHERE id=?").run(photo.id);
    assert.equal(store.artistImages(artist.id).length,0);
    const migrated=new StudioStore(db);
    assert.equal(migrated.artistImages(artist.id).length,1);
    assert.equal(migrated.artistImages(artist.id)[0].sourceAssetId,photo.id);
    new StudioStore(db);
    assert.equal(migrated.artistImages(artist.id).length,1,"Migration is idempotent");
  }finally{db.close();}
});

test("Artist photo API is authenticated, can generate directly for artists and can switch gallery backgrounds",async t=>{
  const fs=await import("node:fs/promises");
  const os=await import("node:os");
  const path=await import("node:path");
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"blossom-artist-api-"));
  await fs.writeFile(path.join(dir,pngName),Buffer.from("photo test bytes"));
  const db=new Store(":memory:");
  const artist=db.addArtist(artistData);
  const second=db.addArtist({...artistData,name:"Copper Lantern"});
  let calls=0;
  const server=createAppServer({store:db,password:"long-test-password",
    assetDir:dir,provider:{available:()=>false},
    chatgptImages:{generate:async input=>{calls++;
      assert.equal(input.kind,"artist-photo");
      assert.equal(input.context.artistName,artist.name);
      assert.match(input.prompt,/Blue Meadow Quartet/);
      return {filename:pngName,mime:"image/png",provider:"chatgpt"};
    }},
    localComposer:{status:async()=>({available:false})}});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(async()=>{
    await new Promise(done=>server.close(done));db.close();
    await fs.rm(dir,{recursive:true,force:true});
  });
  const url="http://127.0.0.1:"+server.address().port;
  assert.equal((await fetch(url+"/api/studio/artists/images")).status,401);
  const login=await fetch(url+"/auth/login",{
    method:"POST",headers:{"content-type":"application/json","x-blossom-request":"ui"},
    body:JSON.stringify({username:"admin",password:"long-test-password"})});
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const post=(urlPath,body={})=>fetch(url+urlPath,{method:"POST",
    headers:{cookie,"content-type":"application/json","x-blossom-request":"ui"},
    body:JSON.stringify(body)});
  const generate=await post("/api/studio/artists/"+artist.id+"/generate-photo",{});
  assert.equal(generate.status,201);
  const newPhoto=await generate.json();
  assert.equal(newPhoto.selected,true);assert.equal(calls,1);
  const photos=await (await fetch(url+"/api/studio/artists/images",{headers:{cookie}})).json();
  assert.equal(photos[artist.id][0].id,newPhoto.id);
  assert.deepEqual(photos[second.id],[]);
  const bytes=await fetch(url+newPhoto.url,{headers:{cookie}});
  assert.equal(bytes.status,200);
  assert.equal(await bytes.text(),"photo test bytes");
  const wrong=await post("/api/studio/artists/"+second.id+"/images/"+newPhoto.id+"/select");
  assert.equal(wrong.status,404);
  const del=await post("/api/studio/artists/"+artist.id+"/images/"+newPhoto.id+"/delete");
  assert.equal(del.status,200);
  assert.equal((await fetch(url+newPhoto.url,{headers:{cookie}})).status,404);
  const p=await post("/api/studio/projects",{title:"no artist",article:"Some words"});
  const project=await p.json();
  const forbidden=await post("/api/studio/projects/"+project.id+"/generate-art",{
    kind:"artist-photo",prompt:"Beautiful wide musician group portrait"});
  assert.equal(forbidden.status,409);
  assert.equal(calls,1,"No paid generation if the project has no artist");
});

test("Visual format: square album art and landscape artist banners, with responsive CSS",async()=>{
  const cover=validateDrawRequest({kind:"cover",prompt:"A professional original album sleeve"});
  const photo=validateDrawRequest({kind:"artist-photo",prompt:"An original promotional group photograph"});
  assert.equal(cover.width,1024);assert.equal(cover.height,1024);
  assert.equal(photo.width,1536);assert.equal(photo.height,864);
  const css=await readFile(new URL("../public/viewport.css",import.meta.url),"utf8");
  assert.match(css,/\.artist-banner-grid\{/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.artist-hero-image\{object-fit:cover/);
  assert.match(css,/@media\(max-width:700px\)/);
  const js=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(js,/artistBanners/);assert.match(js,/artist-hero-content/);
});

test("The ChatGPT request asks for a wide artist banner without baking names into pixels",async()=>{
  const dir=await import("node:os");
  const fs=await import("node:fs/promises");
  const path=await import("node:path");
  const folder=await fs.mkdtemp(path.join(dir.tmpdir(),"blossom-banner-test-"));
  const bytes=Buffer.alloc(32);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.write("IHDR",12);
  bytes.writeUInt32BE(1792,16);bytes.writeUInt32BE(1024,20);
  try{
    const generator=new ChatGptImages({directory:folder,platform:"darwin",
      runner(script,args,options,callback){
        assert.match(args[1],/horizontal 16:9 panoramic artist banner/);
        assert.match(args[1],/Do not render any artist name/);
        assert.match(args[1],/lower-left/);
        callback(null,"REPLY\ndata:image/png;base64,"+bytes.toString("base64"));
      }});
    assert.equal((await generator.generate({kind:"artist-photo",
      prompt:"Original music artist pictured on a wide outdoor stage"})).mime,"image/png");
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});

test("Studio shows wide artist image, name overlay and full-width Artists navigation",()=>{
  const state={data:{artists:[{id:"band-1",name:"Blue Meadow Quartet"}],
    studioProjects:[{id:"project-1",title:"One",artistId:"band-1",
      parameters:{sunoModel:"v6",genre:"Folk",additionalStyles:[],excludeStyles:[],
        vocalGender:"mixed",instrumental:false,maxMode:false,weirdness:20,
        styleInfluence:75,variety:40,personalize:false,targetSeconds:205,
        durationPreset:"radio",customInstructions:""},result:{}}],
    studioAssets:[{id:"image-1",kind:"artist-photo",selected:true,createdAt:"2026-10-24T12:00:00.000Z",provider:"chatgpt",briefMatch:"current",prompt:"",
      url:"/api/studio/assets/image-1/content"}],
    studioStatus:{},studioReferences:[],studioArtistPresets:{},studioPresets:{radio:{}}}};
  const html=studioView(state);
  assert.match(html,/class="studio-photo-banner"/);
  assert.match(html,/Wide artist banner/);
  assert.match(html,/Blue Meadow Quartet/);
  assert.match(html,/data-tab="artists"/);
});
