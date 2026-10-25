import { DomainError,id,now } from './domain.mjs';

const SONGS=`SELECT 'project:'||p.id AS song_key,p.id AS project_id,p.track_id,p.artist_id,p.title,p.created_at
 FROM studio_projects p WHERE p.artist_id IS NOT NULL
 UNION ALL SELECT 'track:'||t.id,NULL,t.id,t.artist_id,t.title,t.created_at FROM tracks t
 WHERE NOT EXISTS(SELECT 1 FROM studio_projects p WHERE p.track_id=t.id)`;
export function safeMediaFilename(filename){
 if(typeof filename!=='string'||! /^[a-f0-9-]{36}\.(png|jpe?g|webp|wav|mp3)$/.test(filename))throw new DomainError('Invalid media filename',400);
 return filename;
}
function metadata(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new DomainError('Invalid album');
 if(typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>140)throw new DomainError('Album title must be 1–140 characters');
 const kind=input.kind??'album',releaseDate=input.releaseDate??'';
 if(!['album','ep','single'].includes(kind))throw new DomainError('Invalid collection kind');
 if(typeof releaseDate!=='string'||releaseDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)||!Number.isFinite(Date.parse(releaseDate))||new Date(releaseDate).toISOString().slice(0,10)!==releaseDate))throw new DomainError('Invalid release date');
 return {title:input.title.trim(),kind,releaseDate};
}
function paging(options={}){
 const limit=options.limit??50,cursor=options.cursor??'';
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new DomainError('Limit must be 1–100');
 if(typeof cursor!=='string'||cursor.length>160)throw new DomainError('Invalid cursor');
 return {limit,cursor};
}
export class Discography {
 constructor(store,studio){
  this.store=store;this.db=store.db;this.studio=studio;
  this.db.exec(`CREATE TABLE IF NOT EXISTS albums(
   id TEXT PRIMARY KEY,artist_id TEXT NOT NULL REFERENCES artists(id),title TEXT NOT NULL,
   kind TEXT NOT NULL CHECK(kind IN ('album','ep','single')),release_date TEXT NOT NULL DEFAULT '',
   cover_filename TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,
   created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS albums_artist ON albums(artist_id,id);
   CREATE TABLE IF NOT EXISTS album_tracks(
   id TEXT PRIMARY KEY,album_id TEXT NOT NULL REFERENCES albums(id),song_key TEXT NOT NULL,
   project_id TEXT REFERENCES studio_projects(id),track_id TEXT REFERENCES tracks(id),
   title TEXT NOT NULL,position INTEGER NOT NULL,audio_asset_id TEXT REFERENCES studio_assets(id),
   audio_filename TEXT NOT NULL DEFAULT '',audio_mime TEXT NOT NULL DEFAULT '',audio_ref TEXT NOT NULL DEFAULT '',
   UNIQUE(album_id,song_key),CHECK((project_id IS NULL)!=(track_id IS NULL)));
   CREATE INDEX IF NOT EXISTS album_tracks_order ON album_tracks(album_id,position,id);`);
 }
 requireArtist(artistId){if(!this.store.artist(artistId))throw new DomainError('Artist not found',404);}
 row(albumId){const a=this.db.prepare('SELECT * FROM albums WHERE id=?').get(albumId);if(!a)throw new DomainError('Album not found',404);return a;}
 convert(a){return {id:a.id,artistId:a.artist_id,title:a.title,kind:a.kind,releaseDate:a.release_date,revision:a.revision,createdAt:a.created_at,updatedAt:a.updated_at,coverUrl:a.cover_filename?'/api/albums/'+a.id+'/cover':null,trackCount:this.db.prepare('SELECT count(*) n FROM album_tracks WHERE album_id=?').get(a.id).n};}
 create(input){
  this.requireArtist(input?.artistId);const m=metadata(input),key=id(),date=now();
  this.db.prepare('INSERT INTO albums(id,artist_id,title,kind,release_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(key,input.artistId,m.title,m.kind,m.releaseDate,date,date);
  this.store.audit('created','album',key,{title:m.title,kind:m.kind});return this.album(key);
 }
 albums(artistId,options={}){
  this.requireArtist(artistId);const {limit,cursor}=paging(options);
  const rows=this.db.prepare('SELECT * FROM albums WHERE artist_id=? AND id>? ORDER BY id LIMIT ?').all(artistId,cursor,limit+1);
  return {results:rows.slice(0,limit).map(a=>this.convert(a)),nextCursor:rows.length>limit?rows[limit-1].id:null};
 }
 album(albumId){
  const a=this.row(albumId),entries=this.db.prepare('SELECT * FROM album_tracks WHERE album_id=? ORDER BY position,id').all(albumId);
  return {...this.convert(a),entries:entries.map(r=>({id:r.id,songId:r.song_key,projectId:r.project_id,trackId:r.track_id,title:r.title,position:r.position,audioAssetId:r.audio_asset_id,audioUrl:r.audio_filename?'/api/albums/'+albumId+'/entries/'+r.id+'/audio':r.audio_ref||null}))};
 }
 songs(artistId,options={}){
  this.requireArtist(artistId);const {limit,cursor}=paging(options);
  const rows=this.db.prepare('SELECT * FROM ('+SONGS+') WHERE artist_id=? AND song_key>? ORDER BY song_key LIMIT ?').all(artistId,cursor,limit+1);
  return {results:rows.slice(0,limit).map(r=>this.song(r.song_key)),nextCursor:rows.length>limit?rows[limit-1].song_key:null};
 }
 song(songId){
  if(typeof songId!=='string'||! /^(project|track):[a-f0-9-]{36}$/.test(songId))throw new DomainError('Song not found',404);
  if(songId.startsWith('track:')){const linked=this.db.prepare('SELECT id FROM studio_projects WHERE track_id=? ORDER BY id LIMIT 1').get(songId.slice(6));if(linked)songId='project:'+linked.id;}
  const r=this.db.prepare('SELECT * FROM ('+SONGS+') WHERE song_key=?').get(songId);if(!r)throw new DomainError('Song not found',404);
  const assets=r.project_id?this.studio.assets(r.project_id):[];
  const takes=assets.filter(a=>a.kind==='audio'),cover=assets.find(a=>a.kind==='cover'&&a.selected),selected=takes.find(a=>a.selected);
  const track=r.track_id?this.store.track(r.track_id):null;
  return {id:r.song_key,projectId:r.project_id,trackId:r.track_id,artistId:r.artist_id,title:r.title,takes,coverUrl:cover?.url||null,coverAssetId:cover?.id||null,selectedAudioId:selected?.id||null,audioUrl:selected?.url||track?.audioRef||null,collections:this.db.prepare('SELECT a.id,a.title,a.kind FROM album_tracks e JOIN albums a ON a.id=e.album_id WHERE e.song_key=? ORDER BY a.title').all(r.song_key)};
 }
 mutate(albumId,expectedRevision,change){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const a=this.row(albumId);
   if(!Number.isInteger(expectedRevision)||a.revision!==expectedRevision)throw new DomainError('Album changed. Reload before saving.',409);
   if(change(a)!==false){this.db.prepare('UPDATE albums SET revision=revision+1,updated_at=? WHERE id=?').run(now(),albumId);
    this.store.audit('updated','album',albumId,{revision:a.revision+1});}this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  return this.album(albumId);
 }
 update(albumId,changes,revision){
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(k=>!['title','kind','releaseDate'].includes(k)))throw new DomainError('Unknown album field');
  return this.mutate(albumId,revision,a=>{const m=metadata({title:a.title,kind:a.kind,releaseDate:a.release_date,...changes});this.db.prepare('UPDATE albums SET title=?,kind=?,release_date=? WHERE id=?').run(m.title,m.kind,m.releaseDate,albumId);});
 }
 chosenRecording(song,assetId){
  if(assetId===null)return {id:null,filename:'',mime:'',ref:''};
  const key=assetId??song.selectedAudioId;
  if(key){const asset=this.studio.asset(key);if(!asset||asset.kind!=='audio'||asset.project_id!==song.projectId||!/\.(?:wav|mp3)$/.test(asset.filename))throw new DomainError('Recording not found for this song',404);safeMediaFilename(asset.filename);return {id:asset.id,filename:asset.filename,mime:asset.mime,ref:''};}
  return {id:null,filename:'',mime:'',ref:song.audioUrl||''};
 }
 add(albumId,items,revision){
  if(!Array.isArray(items)||!items.length||items.length>100)throw new DomainError('Select 1–100 songs');
  return this.mutate(albumId,revision,a=>{
   let added=0;
   for(const item of items){
    const song=this.song(item?.songId);if(song.artistId!==a.artist_id)throw new DomainError('Song belongs to another artist',409);
    if(this.db.prepare('SELECT 1 FROM album_tracks WHERE album_id=? AND song_key=?').get(albumId,song.id))continue;
    const count=this.db.prepare('SELECT count(*) n FROM album_tracks WHERE album_id=?').get(albumId).n;
    if(count>=200)throw new DomainError('An album supports at most 200 songs',409);
    const audio=this.chosenRecording(song,item.audioAssetId);
    this.db.prepare('INSERT INTO album_tracks(id,album_id,song_key,project_id,track_id,title,position,audio_asset_id,audio_filename,audio_mime,audio_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
     .run(id(),albumId,song.id,song.projectId,song.projectId?null:song.trackId,song.title,count+1,audio.id,audio.filename,audio.mime,audio.ref);
    added++;
   }
   return added>0;
  });
 }
 entry(albumId,entryId){this.row(albumId);const r=this.db.prepare('SELECT * FROM album_tracks WHERE album_id=? AND id=?').get(albumId,entryId);if(!r)throw new DomainError('Album entry not found',404);return r;}
 reorder(albumId,ids,revision){
  return this.mutate(albumId,revision,()=>{
   const entries=this.album(albumId).entries;
   if(!Array.isArray(ids)||ids.length!==entries.length||new Set(ids).size!==ids.length||entries.some(e=>!ids.includes(e.id)))throw new DomainError('Ordering must be an exact permutation of album entries');
   const update=this.db.prepare('UPDATE album_tracks SET position=? WHERE album_id=? AND id=?');ids.forEach((key,i)=>update.run(i+1,albumId,key));
  });
 }
 remove(albumId,entryId,revision){return this.mutate(albumId,revision,()=>{this.entry(albumId,entryId);this.db.prepare('DELETE FROM album_tracks WHERE album_id=? AND id=?').run(albumId,entryId);this.album(albumId).entries.forEach((e,i)=>this.db.prepare('UPDATE album_tracks SET position=? WHERE id=?').run(i+1,e.id));});}
 recording(albumId,entryId,assetId,revision){
  return this.mutate(albumId,revision,()=>{const entry=this.entry(albumId,entryId),song=this.song(entry.song_key),audio=this.chosenRecording(song,assetId);this.db.prepare('UPDATE album_tracks SET audio_asset_id=?,audio_filename=?,audio_mime=?,audio_ref=? WHERE id=?').run(audio.id,audio.filename,audio.mime,audio.ref,entryId);});
 }
 setCover(albumId,filename,revision){safeMediaFilename(filename);if(!/\.(?:png|jpe?g|webp)$/.test(filename))throw new DomainError('Use PNG, JPEG, or WebP cover artwork');return this.mutate(albumId,revision,()=>this.db.prepare('UPDATE albums SET cover_filename=? WHERE id=?').run(filename,albumId));}
}
