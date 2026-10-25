import { randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Discography,safeMediaFilename } from './discography.mjs';
import { DomainError } from './domain.mjs';
import { inspectUploadedImage } from './uploaded-image.mjs';

const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function bytes(req,limit){
 const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>limit)throw new DomainError('Payload too large',413);chunks.push(chunk);}return Buffer.concat(chunks);
}
async function json(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new DomainError('Expected application/json',415);
 const data=await bytes(req,256000);try{return JSON.parse(data.toString('utf8'));}catch{throw new DomainError('Invalid JSON');}
}
export function validateCover(data){
 inspectUploadedImage(data,{square:true});
 return data;
}
function coverMime(filename){
 const name=String(filename||'').toLowerCase();
 if(name.endsWith('.png'))return 'image/png';
 if(name.endsWith('.webp'))return 'image/webp';
 if(name.endsWith('.jpg')||name.endsWith('.jpeg'))return 'image/jpeg';
 throw new DomainError('Cover not found',404);
}
function media(res,data,mime,range){
 const headers={'Content-Type':mime,'Cache-Control':'private, no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'};
 if(!range){res.writeHead(200,{...headers,'Content-Length':data.length});res.end(data);return;}
 const match=/^bytes=(\d+)-(\d*)$/.exec(range),start=match?Number(match[1]):-1,end=match?.[2]?Number(match[2]):data.length-1;
 if(start<0||start>=data.length||end<start){res.writeHead(416,{...headers,'Content-Range':'bytes */'+data.length});res.end();return;}
 const last=Math.min(end,data.length-1);res.writeHead(206,{...headers,'Content-Length':last-start+1,'Content-Range':`bytes ${start}-${last}/${data.length}`});res.end(data.subarray(start,last+1));
}
export class DiscographyAPI {
 constructor(store,studio,assetDir){this.catalog=new Discography(store,studio);this.studio=studio;this.assetDir=assetDir;}
 async file(res,filename,mime,range){
  safeMediaFilename(filename);let data;try{data=await readFile(join(this.assetDir,filename));}catch(error){if(error.code==='ENOENT')throw new DomainError('Media file not found',404);throw error;}
  media(res,data,mime,range);
 }
 async cover(req,res,albumId,query){
  this.catalog.row(albumId);
  const declared=String(req.headers['content-type']||'').split(';')[0];
  const data=await bytes(req,20*1024*1024),image=inspectUploadedImage(data,{square:true});
  if((declared==='image/jpg'?'image/jpeg':declared)!==image.mime)throw new DomainError('Upload a square PNG, JPEG, or WebP cover',415);
  const filename=randomUUID()+'.'+image.extension;
  await mkdir(this.assetDir,{recursive:true,mode:0o700});await writeFile(join(this.assetDir,filename),data,{flag:'wx',mode:0o600});
  try{return send(res,200,this.catalog.setCover(albumId,filename,Number(query.get('expectedRevision'))));}
  catch(error){await unlink(join(this.assetDir,filename));throw error;}
 }
 async handle(req,res,path,query){
  const c=this.catalog,match=path.match(/^\/api\/albums\/([a-f0-9-]{36})(?:\/(.*))?$/),albumId=match?.[1],suffix=match?.[2]||'';
  if(req.method==='GET'){
   const options={limit:query.has('limit')?Number(query.get('limit')):50,cursor:query.get('cursor')||''};
   if(path==='/api/albums')return send(res,200,c.albums(query.get('artistId'),options));
   if(path==='/api/catalog/songs')return send(res,200,c.songs(query.get('artistId'),options));
   const songPath=path.match(/^\/api\/catalog\/songs\/([^/]+)$/);
   if(songPath){let key;try{key=decodeURIComponent(songPath[1]);}catch{throw new DomainError('Invalid song ID');}return send(res,200,c.song(key));}
   if(albumId&&!suffix)return send(res,200,c.album(albumId));
   if(albumId&&suffix==='cover'){const a=c.row(albumId);if(!a.cover_filename)throw new DomainError('Cover not found',404);return this.file(res,a.cover_filename,coverMime(a.cover_filename));}
   const audio=suffix.match(/^entries\/([a-f0-9-]{36})\/audio$/);
   if(albumId&&audio){const e=c.entry(albumId,audio[1]);if(!e.audio_filename)throw new DomainError('Recording not found',404);return this.file(res,e.audio_filename,e.audio_mime,req.headers.range);}
   throw new DomainError('Not found',404);
  }
  if(req.method!=='POST')throw new DomainError('Method not allowed',405);
  if(albumId&&suffix==='cover')return this.cover(req,res,albumId,query);
  const input=await json(req);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new DomainError('Expected a JSON object');
  if(path==='/api/albums')return send(res,201,c.create(input));
  const revision=input.expectedRevision;
  if(albumId&&suffix==='edit')return send(res,200,c.update(albumId,input.changes,revision));
  if(albumId&&suffix==='tracks')return send(res,200,c.add(albumId,input.songs,revision));
  if(albumId&&suffix==='reorder')return send(res,200,c.reorder(albumId,input.entryIds,revision));
  if(albumId&&suffix==='cover/from-song'){
   const a=c.row(albumId),song=c.song(input.songId),asset=song.coverAssetId&&this.studio.asset(song.coverAssetId);
   if(song.artistId!==a.artist_id||!asset)throw new DomainError('No selected song cover for this artist',404);
   validateCover(await readFile(join(this.assetDir,safeMediaFilename(asset.filename))));
   return send(res,200,c.setCover(albumId,asset.filename,revision));
  }
  const entry=suffix.match(/^entries\/([a-f0-9-]{36})\/(remove|recording)$/);
  if(albumId&&entry)return send(res,200,entry[2]==='remove'?c.remove(albumId,entry[1],revision):c.recording(albumId,entry[1],input.audioAssetId,revision));
  throw new DomainError('Not found',404);
 }
}
