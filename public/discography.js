import { savedFocus } from "./artist-focus.js";
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kindName=kind=>({album:'Album',ep:'EP',single:'Single'}[kind]||kind);
let dialogContext={},dragged='';
function library(state){
 if(!state.discography){let saved={};try{saved=JSON.parse(sessionStorage.getItem('blossom.discography')||'{}');}catch{}
  state.discography={artistId:saved.artistId||'',albumId:saved.albumId||'',albums:[],songs:[],filter:'all',album:null};}
 return state.discography;
}
function remember(state){const d=library(state);try{sessionStorage.setItem('blossom.discography',JSON.stringify({artistId:d.artistId,albumId:d.albumId}));}catch{}}
export function openArtistRoster(state){
 const d=library(state);
 d.artistId='';d.albumId='';d.album=null;
 remember(state);
 return d;
}
export async function discographyRefresh(state,api){
 const d=library(state);if(!d.artistId)return;
 if(!state.data.artists.some(a=>a.id===d.artistId)){d.artistId='';d.albumId='';remember(state);return;}
 const [albums,songs,album]=await Promise.all([api('albums?artistId='+d.artistId+'&limit=100'),api('catalog/songs?artistId='+d.artistId+'&limit=100'),d.albumId?api('albums/'+d.albumId):null]);
 Object.assign(d,{albums:albums.results,songs:songs.results,albumsCursor:albums.nextCursor,songsCursor:songs.nextCursor,album});
}
function button(action,label,attrs='',style='secondary'){return '<button type="button" class="'+style+'" data-action="catalog-'+action+'" '+attrs+'>'+label+'</button>';}
function cover(url,title,classes=''){return '<div class="catalog-cover '+classes+'">'+(url?'<img src="'+esc(url)+'" alt="Cover for '+esc(title)+'" loading="lazy">':'<span aria-hidden="true">♫</span>')+'</div>';}
function player(url){return url?'<audio controls preload="none" src="'+esc(url)+'" aria-label="Preview recording"></audio>':'<span class="catalog-draft">No recording yet</span>';}
function songRows(songs){return songs.map((s,i)=>'<div class="catalog-song-row">'+
 '<span class="catalog-number">'+(i+1)+'</span>'+cover(s.coverUrl,s.title,'catalog-mini-cover')+
 '<div class="catalog-song-title"><strong>'+esc(s.title)+'</strong><small>'+esc(s.collections.length?s.collections.map(a=>a.title).join(' · '):'Not on a release yet')+'</small></div>'+
 player(s.audioUrl)+button('add-song','＋','data-song-id="'+esc(s.id)+'" aria-label="Add '+esc(s.title)+' to album"','catalog-round')+'</div>').join('');}
function albumRows(album){return album.entries.map((entry,i)=>'<div class="catalog-track-row" draggable="true" data-entry="'+esc(entry.id)+'">'+
 '<span class="catalog-number" title="Drag to reorder">'+(i+1)+'</span><div class="catalog-song-title"><strong>'+esc(entry.title)+'</strong><small>'+esc(entry.audioUrl?'Pinned recording':'Draft · choose a recording when ready')+'</small></div>'+
 player(entry.audioUrl)+'<div class="catalog-row-actions">'+
 button('pin','Recording','data-entry-id="'+entry.id+'" aria-label="Choose recording for '+esc(entry.title)+'"')+
 button('move','↑','data-entry-id="'+entry.id+'" data-direction="-1" aria-label="Move '+esc(entry.title)+' up" '+(i===0?'disabled':''),'catalog-round')+
 button('move','↓','data-entry-id="'+entry.id+'" data-direction="1" aria-label="Move '+esc(entry.title)+' down" '+(i===album.entries.length-1?'disabled':''),'catalog-round')+
 button('remove','×','data-entry-id="'+entry.id+'" aria-label="Remove '+esc(entry.title)+' from album"','catalog-round')+'</div></div>').join('');}
export function discographyView(state){
 const d=library(state);if(!d.artistId)return null;
 const artist=state.data.artists.find(a=>a.id===d.artistId);if(!artist)return null;
 const banner=state.data.artistBanners?.[artist.id],focus=savedFocus(banner),album=d.album;
 const nav=button(album?'artist':'roster',album?'← Back to artist':'← All artists','aria-label="'+(album?'Back to artist':'All artists')+'"');
 if(album)return '<section class="catalog-workspace">'+nav+
  '<header class="catalog-album-hero">'+cover(album.coverUrl,album.title)+
  '<div><p class="catalog-eyebrow">'+esc(kindName(album.kind))+' · DRAFT COLLECTION</p><h1>'+esc(album.title)+'</h1><p>'+esc(artist.name)+' · '+album.entries.length+' songs'+(album.releaseDate?' · '+esc(album.releaseDate):'')+'</p><div class="actions">'+button('add','＋ Add songs','aria-label="Add songs"','primary')+button('edit','Edit release')+'</div></div></header>'+
  '<div class="catalog-cover-actions"><label class="secondary catalog-upload">'+esc(album.coverUrl?'Change cover':'Upload cover')+'<input id="catalog-cover-file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload square album cover"></label><span class="small">Square PNG, JPEG, or WebP · paste a photo on this release · up to 20 MB</span>'+button('reuse-cover','Use a song cover')+'</div>'+
  '<div class="catalog-list-heading"><span>#</span><span>Title</span><span>Recording &amp; order</span></div><div class="catalog-track-list">'+
  (album.entries.length?albumRows(album):'<div class="catalog-empty"><h2>Your album starts here</h2><p>Add existing songs, then arrange the track list. Draft songs are welcome.</p>'+button('add','Add songs','', 'primary')+'</div>')+
  '</div><p class="catalog-note">Drag songs to reorder, or use the arrow buttons. Album recordings stay fixed until you change them here. Removing a song keeps its project and audio.</p></section>';
 const filtered=d.albums.filter(a=>d.filter==='all'||a.kind===d.filter);
 return '<section class="catalog-workspace"><header class="catalog-artist-hero">'+
  (banner?'<img src="'+esc(banner.url)+'" alt="Artist banner for '+esc(artist.name)+'" data-photo-focus data-focus-x="'+focus.focusX+'" data-focus-y="'+focus.focusY+'">':'<div class="catalog-artist-placeholder" aria-hidden="true">'+esc(artist.name.slice(0,1))+'</div>')+
  '<div class="catalog-artist-shade"></div><div class="catalog-artist-heading"><p class="catalog-eyebrow">BLOSSOM ARTIST · '+esc(artist.genre)+'</p><h1>'+esc(artist.name)+'</h1><p class="catalog-artist-meta">'+d.albums.length+' releases <span>·</span> '+d.songs.length+' songs</p></div></header>'+
  '<div class="catalog-artist-controls">'+button('new','＋ New release','aria-label="New release"','primary')+button('roster','← All artists','aria-label="All artists"')+'</div>'+
  '<div class="catalog-section-heading"><h2>Discography</h2></div>'+
  '<div class="catalog-filters" aria-label="Release types">'+[['all','All'],['album','Albums'],['ep','EPs'],['single','Singles']].map(([key,label])=>button('filter',label,'data-kind="'+key+'" aria-pressed="'+(d.filter===key)+'"','catalog-chip')).join('')+'</div>'+
  (filtered.length?'<div class="catalog-album-grid">'+filtered.map(a=>'<button type="button" class="catalog-album-card" data-action="catalog-open" data-album-id="'+a.id+'">'+cover(a.coverUrl,a.title)+'<strong>'+esc(a.title)+'</strong><small>'+esc(kindName(a.kind))+' · '+a.trackCount+' songs'+(a.releaseDate?' · '+esc(a.releaseDate.slice(0,4)):'')+'</small></button>').join('')+'</div>':'<div class="catalog-empty"><h3>No releases here yet</h3><p>Create an album, EP or single and add songs from your library.</p></div>')+
  (d.albumsCursor?button('more-albums','Load more releases'):'')+
  '<div class="catalog-section-heading"><h2>All songs</h2><span class="small">Independent songs · one recording can belong to several releases</span></div>'+
  '<div class="catalog-song-list">'+(d.songs.length?songRows(d.songs):'<div class="catalog-empty">Create a song for this artist in News to Song or Tracks &amp; Suno.</div>')+'</div>'+
  (d.songsCursor?button('more-songs','Load more songs'):'')+'</section>';
}
function showDialog(title,body,context){
 dialogContext=context;const dialog=document.getElementById('catalog-dialog');
 dialog.innerHTML='<div class="dialog-header"><strong id="catalog-dialog-title">'+esc(title)+'</strong>'+button('close','×','aria-label="Close album dialog"','icon-button')+'</div>'+body+'<p id="catalog-error" role="alert"></p>';
 if(!dialog.open)dialog.showModal();
}
function releaseForm(state,pendingSong=null,edit=false){
 const d=library(state),album=edit?d.album:null;
 showDialog(edit?'Edit release':'Create a release','<form id="catalog-form" class="catalog-form"><label>Release title<input name="title" required maxlength="140" value="'+esc(album?.title||'')+'" placeholder="Give your release a name"></label>'+
  '<label>Release type<select name="kind">'+[['album','Album'],['ep','EP'],['single','Single']].map(([value,label])=>'<option value="'+value+'" '+(album?.kind===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
  '<label>Release date (optional)<input type="date" name="releaseDate" value="'+esc(album?.releaseDate||'')+'"></label>'+
  '<p class="catalog-note">'+(pendingSong?'The song will be linked to this release.':'Add songs and a square cover after creating the release.')+' This organizes your library; it does not publish to a distributor.</p>'+
  '<div class="actions"><button type="submit" class="primary">'+(edit?'Save release':'Create release')+'</button>'+button('close','Cancel')+'</div></form>',{mode:edit?'edit':'create',artistId:pendingSong?.artistId||d.artistId,song:pendingSong,album});
}
function takeOptions(song,current){
 return '<option value="">No recording yet</option>'+(current&&!song.takes.some(t=>t.id===current)?'<option value="'+esc(current)+'" selected>Current pinned recording (kept in album)</option>':'')+
 song.takes.map((take,i)=>'<option value="'+take.id+'" '+(take.id===current?'selected':'')+'>Take '+(song.takes.length-i)+' · '+esc(take.provider)+' · '+esc(take.createdAt.slice(0,16).replace('T',' '))+'</option>').join('');
}
async function linkSong(state,api,songId){
 const song=await api('catalog/songs/'+encodeURIComponent(songId));
 const albums=await api('albums?artistId='+song.artistId+'&limit=100');
 if(!albums.results.length){releaseForm(state,song);return;}
 showDialog('Add “'+song.title+'” to a release','<form id="catalog-form" class="catalog-form"><label>Release<select name="albumId">'+albums.results.map(a=>'<option value="'+a.id+'">'+esc(a.title)+' · '+kindName(a.kind)+'</option>').join('')+'</select></label>'+
  '<label>Recording<select name="audioAssetId">'+takeOptions(song,song.selectedAudioId)+'</select></label><div class="actions"><button type="submit" class="primary">Add song</button>'+button('new-from-song','Create new release')+(albums.nextCursor?button('picker-more-albums','Load more releases'):'')+'</div></form>',{mode:'link',song,albumsCursor:albums.nextCursor});
}
function pickerRows(songs,album){return songs.map(song=>{
 const present=album.entries.some(e=>e.songId===song.id);
 return '<div class="catalog-picker-row"><label><input type="checkbox" name="songId" value="'+esc(song.id)+'" aria-label="Add '+esc(song.title)+'" '+(present?'disabled':'')+'><span><strong>'+esc(song.title)+'</strong><small>'+esc(present?'Already on this release':song.takes.length+' recordings')+'</small></span></label><select data-song-take="'+esc(song.id)+'" aria-label="Recording for '+esc(song.title)+'">'+takeOptions(song,song.selectedAudioId)+'</select></div>';
 }).join('');}
async function addPicker(state,api){
 const d=library(state),page=await api('catalog/songs?artistId='+d.artistId+'&limit=100');
 showDialog('Add songs to '+d.album.title,'<form id="catalog-form" class="catalog-form"><label>Find songs<input type="search" id="catalog-find" placeholder="Search loaded songs"></label><div class="catalog-picker-list">'+pickerRows(page.results,d.album)+'</div>'+
  (page.nextCursor?button('picker-more-songs','Load more songs'):'')+'<div class="actions"><button type="submit" class="primary">Add selected songs</button>'+button('close','Cancel')+'</div></form>',{mode:'add',album:d.album,songsCursor:page.nextCursor});
}
export function catalogAlbum(state){return library(state).album;}
export async function uploadCover(album,file,api){
 if(!file)return album;const type=file.type==="image/jpg"?"image/jpeg":file.type;
 if(!["image/png","image/jpeg","image/webp"].includes(type))throw Error("Choose a PNG, JPEG, or WebP cover");
 const response=await fetch("/api/albums/"+album.id+"/cover?expectedRevision="+album.revision,{method:"POST",headers:{"Content-Type":type,"X-Blossom-Request":"ui"},body:file});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Cover upload failed');return result;
}
export async function discographyAction(el,state,api,refresh,message,render){
 const act=el.dataset.action;if(!act?.startsWith('catalog-'))return false;
 const d=library(state),a=d.album;
 if(act==='catalog-close'){document.getElementById('catalog-dialog').close();return true;}
 if(act==='catalog-roster'){d.artistId='';d.albumId='';remember(state);render();return true;}
 if(act==='catalog-artist'){d.albumId='';d.album=null;remember(state);await refresh();return true;}
 if(act==='catalog-artist-open'){d.artistId=el.dataset.artistId;d.albumId='';remember(state);await refresh();return true;}
 if(act==='catalog-open'){d.albumId=el.dataset.albumId;remember(state);await refresh();return true;}
 if(act==='catalog-filter'){d.filter=el.dataset.kind;render();return true;}
 if(act==='catalog-new'){releaseForm(state);return true;}
 if(act==='catalog-edit'){releaseForm(state,null,true);return true;}
 if(act==='catalog-new-from-song'){const audioId=document.querySelector('#catalog-form select[name=audioAssetId]')?.value||null;releaseForm(state,{...dialogContext.song,pendingAudioId:audioId});return true;}
 if(act==='catalog-add'){await addPicker(state,api);return true;}
 if(['catalog-add-song','catalog-add-project','catalog-add-track'].includes(act)){
  await linkSong(state,api,el.dataset.songId||(act==='catalog-add-project'?'project:':'track:')+el.dataset.id);return true;
 }
 if(act==='catalog-pin'){
  const entry=a.entries.find(x=>x.id===el.dataset.entryId),song=await api('catalog/songs/'+encodeURIComponent(entry.songId));
  showDialog('Choose album recording','<form id="catalog-form" class="catalog-form"><p>'+esc(entry.title)+'</p><label>Album recording<select name="audioAssetId">'+takeOptions(song,entry.audioAssetId)+'</select></label><p class="catalog-note">This only changes the recording on this release.</p><button type="submit" class="primary">Save recording</button></form>',{mode:'pin',album:a,entry});return true;
 }
 if(act==='catalog-remove'){await api('albums/'+a.id+'/entries/'+el.dataset.entryId+'/remove',{expectedRevision:a.revision});await refresh();message('Removed from album. Song and recordings kept.');return true;}
 if(act==='catalog-move'){
  const ids=a.entries.map(x=>x.id),i=ids.indexOf(el.dataset.entryId),j=i+Number(el.dataset.direction);if(i<0||j<0||j>=ids.length)return true;
  [ids[i],ids[j]]=[ids[j],ids[i]];await api('albums/'+a.id+'/reorder',{entryIds:ids,expectedRevision:a.revision});await refresh();return true;
 }
 if(act==='catalog-reuse-cover'){
  const songs=await Promise.all(a.entries.map(e=>api('catalog/songs/'+encodeURIComponent(e.songId))));
  const covers=songs.filter(s=>s.coverAssetId);if(!covers.length)throw Error('Select a square cover in one of the album’s song projects first, or upload a PNG here.');
  showDialog('Choose a song cover','<form id="catalog-form" class="catalog-form"><label>Song cover<select name="songId">'+covers.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.title)+'</option>').join('')+'</select></label><button type="submit" class="primary">Use cover</button></form>',{mode:'cover',album:a});return true;
 }
 if(act==='catalog-more-albums'||act==='catalog-more-songs'){
  const albums=act==='catalog-more-albums',page=await api((albums?'albums':'catalog/songs')+'?artistId='+d.artistId+'&limit=100&cursor='+encodeURIComponent(albums?d.albumsCursor:d.songsCursor));
  d[albums?'albums':'songs'].push(...page.results);d[albums?'albumsCursor':'songsCursor']=page.nextCursor;render();return true;
 }
 if(act==='catalog-picker-more-songs'){
  const page=await api('catalog/songs?artistId='+dialogContext.album.artistId+'&limit=100&cursor='+encodeURIComponent(dialogContext.songsCursor));
  document.querySelector('.catalog-picker-list').insertAdjacentHTML('beforeend',pickerRows(page.results,dialogContext.album));dialogContext.songsCursor=page.nextCursor;if(!page.nextCursor)el.remove();return true;
 }
 if(act==='catalog-picker-more-albums'){
  const page=await api('albums?artistId='+dialogContext.song.artistId+'&limit=100&cursor='+encodeURIComponent(dialogContext.albumsCursor));
  document.querySelector('#catalog-form select[name=albumId]').insertAdjacentHTML('beforeend',page.results.map(a=>'<option value="'+a.id+'">'+esc(a.title)+'</option>').join(''));dialogContext.albumsCursor=page.nextCursor;if(!page.nextCursor)el.remove();return true;
 }
 return true;
}
export function bindDiscography(state,api,refresh,message){
 document.addEventListener('submit',async event=>{
  if(event.target.id!=='catalog-form')return;event.preventDefault();const form=event.target,submit=form.querySelector('[type=submit]');if(submit.disabled)return;submit.disabled=true;
  const ctx=dialogContext,data=Object.fromEntries(new FormData(form));let album;
  try{
   if(ctx.mode==='create'){
    album=ctx.created||await api('albums',{artistId:ctx.artistId,...data});ctx.created=album;
    if(ctx.song)album=await api('albums/'+album.id+'/tracks',{songs:[{songId:ctx.song.id,audioAssetId:Object.hasOwn(ctx.song,'pendingAudioId')?ctx.song.pendingAudioId:ctx.song.selectedAudioId}],expectedRevision:album.revision});
   }else if(ctx.mode==='edit')album=await api('albums/'+ctx.album.id+'/edit',{changes:data,expectedRevision:ctx.album.revision});
   else if(ctx.mode==='link'){album=await api('albums/'+data.albumId);album=await api('albums/'+album.id+'/tracks',{songs:[{songId:ctx.song.id,audioAssetId:data.audioAssetId||null}],expectedRevision:album.revision});}
   else if(ctx.mode==='add'){
    const selected=[...form.querySelectorAll('input[name=songId]:checked')].map(input=>({songId:input.value,audioAssetId:[...form.querySelectorAll('[data-song-take]')].find(s=>s.dataset.songTake===input.value)?.value||null}));
    album=await api('albums/'+ctx.album.id+'/tracks',{songs:selected,expectedRevision:ctx.album.revision});
   }else if(ctx.mode==='pin'){
    album=data.audioAssetId===ctx.entry.audioAssetId?ctx.album:await api('albums/'+ctx.album.id+'/entries/'+ctx.entry.id+'/recording',{audioAssetId:data.audioAssetId||null,expectedRevision:ctx.album.revision});
   }else if(ctx.mode==='cover')album=await api('albums/'+ctx.album.id+'/cover/from-song',{songId:data.songId,expectedRevision:ctx.album.revision});
   const d=library(state);d.artistId=album.artistId;d.albumId=album.id;remember(state);document.getElementById('catalog-dialog').close();
   state.tab='artists';history.replaceState(null,'','#artists');await refresh();message('Release saved');
  }catch(error){document.getElementById('catalog-error').textContent=error.message;message(error.message,true);}
  finally{submit.disabled=false;}
 });
 document.addEventListener('input',event=>{if(event.target.id==='catalog-find'){const query=event.target.value.toLocaleLowerCase();document.querySelectorAll('.catalog-picker-row').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase().includes(query));}});
 document.addEventListener('change',async event=>{
  if(event.target.id!=='catalog-cover-file')return;event.target.disabled=true;
  try{await uploadCover(library(state).album,event.target.files[0],api);await refresh();message('Album cover saved');}catch(error){message(error.message,true);}finally{event.target.disabled=false;event.target.value='';}
 });
 document.addEventListener('dragstart',event=>{const row=event.target.closest('.catalog-track-row');if(row){dragged=row.dataset.entry;event.dataTransfer.setData('text/plain',dragged);event.dataTransfer.effectAllowed='move';}});
 document.addEventListener('dragover',event=>{if(event.target.closest('.catalog-track-row'))event.preventDefault();});
 document.addEventListener('drop',async event=>{
  const row=event.target.closest('.catalog-track-row');if(!row||!dragged)return;event.preventDefault();const a=library(state).album,ids=a.entries.map(e=>e.id),from=ids.indexOf(dragged),to=ids.indexOf(row.dataset.entry);dragged='';if(from<0||to<0||from===to)return;
  ids.splice(to,0,ids.splice(from,1)[0]);try{await api('albums/'+a.id+'/reorder',{entryIds:ids,expectedRevision:a.revision});await refresh();}catch(error){message(error.message,true);}
 });
 document.addEventListener('dragend',()=>{dragged='';});
}
