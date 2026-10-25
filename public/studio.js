import {StudioPersistence,projectChanges,mergeEdits,readDraft} from "./studio-persistence.js";
export const STUDIO_ASSET_VERSION="chatgpt-assets-v2";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const presetNames={radio:"Radio edit",streaming:"Streaming",focus:"Focus",ambient:"Ambient",custom:"Custom"};
const defaults={sunoModel:"v6",lyricLanguage:"auto",genre:"Country Pop",additionalStyles:["Americana","Acoustic"],excludeStyles:["Auto-Tune","unlicensed samples"],vocalGender:"male",
 instrumental:false,maxMode:false,weirdness:22,styleInfluence:75,variety:40,personalize:false,
 durationPreset:"radio",targetSeconds:205,customInstructions:"",imagePrompt:"",artistPhotoPrompt:""};
const work={activeId:null,creatingNew:false,busy:false,assistantAnswer:"",uploading:false,bottomTab:"tracks",chatgptPoll:null,activeStep:1,sunoTimer:null,saveStatus:"Saved",renderedProject:null};
let persistenceContext=null;
const controllers=new Map();
const draftPrefix="blossom.studio.draft.v1:";
function draftStorage(){try{return globalThis.localStorage;}catch{return undefined;}}
function saveSelection(){try{draftStorage()?.setItem("blossom.studio.active",work.creatingNew?"new":work.activeId||"");}catch{}}
function showSaveStatus(status,error,backupError){
 const labels={pending:"Pending",saving:"Saving…",saved:"Saved",conflict:"Conflict — local edits kept",error:"Not saved"};
 work.saveStatus=(labels[status]||status)+(backupError&&status!=="saved"?" · local backup unavailable":"");
 const node=typeof document!=="undefined"&&document.getElementById?.("studio-save-state");if(node)node.textContent=work.saveStatus;
 const controls=typeof document!=="undefined"&&document.getElementById?.("studio-save-conflict");if(controls)controls.hidden=status!=="conflict";
}
function controllerFor(state,api){
 const p=stateOf(state),key=p?.id||"new";
 if(controllers.has(key)){
  const c=controllers.get(key);if(p&&!c.dirty&&!c.running){c.base=JSON.parse(JSON.stringify(p));c.draft=JSON.parse(JSON.stringify(p));}return c;
 }
 const c=new StudioPersistence({project:p||{title:"",article:"",sourceUrl:"",artistId:"",parameters:{...defaults},result:{}},request:api,storage:draftStorage(),key:draftPrefix+key,
  onStatus:(status,error)=>{if(stateOf(state)?.id===c.base.id||work.creatingNew&&key==="new")showSaveStatus(status,error,c.backupError);},
  onSaved:saved=>{
   const active=stateOf(state)?.id===saved.id||work.creatingNew&&key==="new";
   const previous=(state.data.studioProjects||[]).find(x=>x.id===saved.id);
   state.data.studioProjects=[{...previous,...saved},...(state.data.studioProjects||[]).filter(x=>x.id!==saved.id)];controllers.set(saved.id,c);
   if(key==="new"){
    controllers.delete("new");const oldKey=c.key;c.key=draftPrefix+saved.id;c.persist();
    if(!c.backupError)try{draftStorage()?.removeItem(oldKey);}catch{}
   }
   if(active){work.activeId=saved.id;work.creatingNew=false;saveSelection();
    updateStudioReadiness(state);
    const hint=typeof document!=="undefined"&&document.getElementById?.("studio-brief-state");if(hint)hint.textContent=saved.integrity?.briefStale?"Brief uses earlier inputs. Regenerate it before making music.":"";
   }
  }});
 controllers.set(key,c);return c;
}
export function studioConfigurePersistence(state,api,message){
 persistenceContext={state,api,message};
 try{const selected=draftStorage()?.getItem("blossom.studio.active");if(selected==="new")work.creatingNew=true;else if(/^[a-f0-9-]{36}$/.test(selected||""))work.activeId=selected;}catch{}
}
export async function studioFlush(){
 for(const c of new Set(controllers.values()))if(c.dirty||c.running)await c.flush();
}
export function studioResumePersistence(){
 if(!persistenceContext)return;const {state,api}=persistenceContext;const key=stateOf(state)?.id||"new";
 if(!readDraft(draftStorage(),draftPrefix+key))return;
 const c=controllerFor(state,api);if(!c.error)void c.flush().catch(()=>{});
}
export function studioAutoSave(event,state,api){
 const key=event.target.id;
 const top={"studio-title":"title","studio-article":"article","studio-source":"sourceUrl","studio-artist":"artistId"};
 const controls={"studio-model":"sunoModel","studio-genre":"genre","studio-styles":"additionalStyles","studio-excludes":"excludeStyles","studio-language":"lyricLanguage","studio-gender":"vocalGender","studio-instrumental":"instrumental","studio-max-mode":"maxMode","studio-personalize":"personalize","studio-weirdness":"weirdness","studio-styleInfluence":"styleInfluence","studio-variety":"variety","studio-duration-preset":"durationPreset","studio-duration":"targetSeconds","studio-notes":"customInstructions","studio-cover-prompt":"imagePrompt","studio-photo-prompt":"artistPhotoPrompt"};
 let changes;
 if(top[key])changes={[top[key]]:event.target.value};
 else if(key==="studio-lyrics")changes={result:{lyrics:event.target.value}};
 else if(controls[key]){const params=paramsFromDOM();changes={parameters:{[controls[key]]:params[controls[key]]}};if(key==="studio-duration-preset")changes.parameters.targetSeconds=params.targetSeconds;}
 if(changes){saveSelection();controllerFor(state,api).edit(changes);}
}
const formatTime=s=>Math.floor(s/60)+":"+String(s%60).padStart(2,"0");
const encode=v=>esc(v);
export function studioSunoReadiness(project){
 const missing=[];
 if(!project?.artistId)missing.push("Choose an artist");
 if(project?.integrity?.briefStale)missing.push("Regenerate the brief after changing its inputs");
 if(project?.integrity?.instructionConflicts?.length)missing.push("Resolve conflicting brief instructions");
 const title=project?.title&&project.title!=="Untitled project"?project.title:project?.result?.titles?.[0];
 if(!title||title==="Untitled")missing.push("Choose a song title");
 if(!project?.result?.concept?.trim())missing.push("Generate the AI brief");
 if(!project?.parameters?.genre?.trim())missing.push("Choose a genre");
 if(!project?.parameters?.instrumental&&!project?.result?.lyrics?.trim())missing.push("Generate or write lyrics");
 return {ready:missing.length===0,missing};
}
export function studioStepState(project,assets=[]){
 const ready=studioSunoReadiness(project),p=project||{},result=p.result||{};
 return [
  {label:"Article",done:!!p.article?.trim()||!!p.sourceUrl?.trim()},
  {label:"AI Brief",done:!!result.concept?.trim()&&
    (p.parameters?.instrumental||!!result.lyrics?.trim())},
  {label:"Configure",done:!!p.parameters?.genre&&!!p.artistId},
  {label:"Artwork",done:assets.some(a=>a.kind==="cover"&&a.selected)},
  {label:"Release",done:!!p.sunoJob?.importedAssetId,ready:ready.ready}
 ];
}
function studioStepper(p,assets){
 const stages=studioStepState(p,assets);
 return '<nav class="studio-stepper" aria-label="Studio production steps">'+
 stages.map((step,index)=>{
   const number=index+1;
   return (index?'<i aria-hidden="true"></i>':'')+
   '<button type="button" data-action="studio-step" data-step="'+number+'"'+
   ' class="studio-step'+(number===work.activeStep?' active':'')+
   (step.done?' completed':'')+'"'+
   (number===work.activeStep?' aria-current="step"':'')+'>'+
   '<b>'+(step.done?'✓':number)+'</b><span>'+step.label+'</span></button>';
 }).join("")+'</nav>';
}

const stateOf=state=>{if(work.creatingNew)return null;const list=state.data.studioProjects||[];
 return work.activeId?(list.find(p=>p.id===work.activeId)||null):(list[0]||null);};
const tags=values=>(values||[]).map(v=>'<span class="studio-chip">'+esc(v)+'</span>').join("");
const field=(label,input)=>'<label class="studio-field"><span>'+label+'</span>'+input+'</label>';
const slider=(id,label,value)=>'<div class="studio-slider">'+
 '<label for="studio-'+id+'">'+label+' <output id="out-'+id+'">'+value+'%</output></label>'+
 '<input id="studio-'+id+'" type="range" min="0" max="100" step="1" value="'+value+'"></div>';
const choose=(id,options,current)=>'<select id="'+id+'">'+options.map(([v,l])=>'<option value="'+esc(v)+'" '+(v===current?'selected':'')+'>'+esc(l)+'</option>').join("")+'</select>';
const safeList=value=>value.map(v=>esc(v)).join(", ");
function paramsFromDOM(){
 const textList=id=>(document.getElementById(id)?.value||"").split(",").map(x=>x.trim()).filter(Boolean).slice(0,16);
 return {sunoModel:document.querySelector("#studio-model").value,genre:document.querySelector("#studio-genre").value.trim(),additionalStyles:textList("studio-styles"),
   lyricLanguage:document.querySelector("#studio-language")?.value||"auto",excludeStyles:textList("studio-excludes"),vocalGender:document.querySelector("#studio-gender").value,
   instrumental:document.querySelector("#studio-instrumental").checked,
   maxMode:document.querySelector("#studio-max-mode").checked,
   personalize:document.querySelector("#studio-personalize").checked,
   weirdness:Number(document.querySelector("#studio-weirdness").value),
   styleInfluence:Number(document.querySelector("#studio-styleInfluence").value),
   variety:Number(document.querySelector("#studio-variety").value),
   durationPreset:document.querySelector("#studio-duration-preset").value,
   targetSeconds:Number(document.querySelector("#studio-duration").value),
   customInstructions:document.querySelector("#studio-notes").value.trim(),
   imagePrompt:document.querySelector("#studio-cover-prompt").value.trim(),
   artistPhotoPrompt:document.querySelector("#studio-photo-prompt").value.trim()};
}
const panels=(p,assets,state)=>{
 const result=p?.result||{},params=p?.parameters||defaults;
 const artists=state.data.artists||[],genres=Object.values(state.data.genres||{}).flat();
 const referenceOptions=(state.data.musicDnaProfiles||[]).filter(x=>x.analysisVersion>0);
 const projectReferences=state.data.studioReferences||[];
 const image=assets.find(a=>a.kind==="cover"&&a.selected),photo=assets.find(a=>a.kind==="artist-photo"&&a.selected)||state.data.artistBanners?.[p?.artistId];
 const artistName=(state.data.artists||[]).find(a=>a.id===p?.artistId)?.name||"Artist";
 const automaticLabel="✦ Generate with ChatGPT";
 const projectOptions=(state.data.studioProjects||[]).map(x=>'<option value="'+esc(x.id)+'" '+(x.id===p?.id?"selected":"")+'>'+esc(((state.data.artists||[]).find(a=>a.id===x.artistId)?.name||'No artist')+' · '+x.title+' · '+x.id.slice(0,8))+'</option>').join("");
 const artPrompt=params.imagePrompt||result.coverPrompt||"",photoPrompt=params.artistPhotoPrompt||result.artistPhotoPrompt||"";
 const updateNotice=state.data.studioStatus?.studioVersion!==STUDIO_ASSET_VERSION?'<div class="studio-update-notice" role="status">Update required: restart Blossom and reload this page to use ChatGPT images and asset selection.</div>':'';
 return '<div class="studio-toolbar">'+
 '<div class="studio-title"><div class="studio-square-icon">♫</div><div><h1>News to Song</h1><p>From story to original music, visual identity and release preparation.</p></div></div>'+
 '<div class="studio-toolbar-actions"><select id="studio-project-picker" aria-label="Select project"><option value="new">+ New project</option>'+projectOptions+'</select>'+
 '<button class="secondary" data-action="studio-save">Save project</button>'+
 '<button class="primary studio-run" data-action="studio-generate-all">✦ Prepare all</button></div></div>'+
 studioStepper(p,assets)+
 '<div class="studio-columns">'+
 '<section id="studio-step-1" class="studio-panel studio-article" tabindex="-1"><div class="studio-panel-head"><h2>01 <span>News article</span></h2><span class="studio-mini-tag">SOURCE</span></div>'+
 '<div id="studio-save-conflict" '+(work.saveStatus.startsWith('Conflict')?'':'hidden')+'><p class="studio-hint">The same field changed elsewhere. Your local edits are kept.</p><button class="secondary mini" data-action="studio-conflict-local">Keep my edits</button><button class="secondary mini" data-action="studio-conflict-server">Use saved version</button></div>'+
 field("Project title",'<input id="studio-title" maxlength="140" placeholder="Still by Hand" value="'+esc(p?.title||"")+'">')+
 '<details class="studio-library-tools"><summary>Projects, history &amp; library checks</summary>'+
 '<div class="studio-file-actions"><button class="secondary mini" data-action="studio-history">History</button>'+
 '<button class="secondary mini" data-action="studio-inventory">Check library</button>'+
 (state.data.studioProjectPage?.nextCursor?'<button class="secondary mini" data-action="studio-project-more">More projects</button>':'')+'</div>'+
 '<input id="studio-project-search" aria-label="Search projects or artists" placeholder="Search projects or artists" value="'+esc(state.projectQuery||'')+'"><button class="secondary mini" data-action="studio-project-search">Search</button></details>'+
 '<p id="studio-brief-state" class="studio-hint" role="status">'+(p?.integrity?.briefStale?'Brief uses earlier inputs. Regenerate it before making music.':'')+'</p>'+
 (p?.integrity?.instructionConflicts||[]).map(message=>'<p class="studio-hint" role="status">'+esc(message)+'</p>').join('')+
 (p?.integrity?.trackMismatch?'<p class="studio-hint" role="status">The linked track belongs to an earlier project version.</p>':'')+
 field("Artist",'<select id="studio-artist"><option value="">Choose an artist</option>'+artists.map(a=>'<option value="'+esc(a.id)+'" '+(a.id===p?.artistId?"selected":"")+'>'+esc(a.name)+" · "+esc(a.genre)+'</option>').join("")+'</select>')+
 '<div class="studio-artist-identity"><span>Assigned artist: <strong>'+
 esc(artists.find(a=>a.id===p?.artistId)?.name||result.artistName||"Not assigned")+'</strong></span>'+
 '<button class="secondary mini" type="button" data-action="studio-create-artist">Create / link artist</button></div>'+
 '<div class="studio-tabstrip"><span class="active">Artikeltekst / bron-URL</span><span>Music DNA</span><span>Origineel concept</span></div>'+
 '<textarea id="studio-article" placeholder="Paste a news story, your own writing, or an original song concept..." spellcheck="true">'+esc(p?.article||"")+'</textarea>'+
 field("Artikel-URL",'<input id="studio-source" type="url" placeholder="https://www.nu.nl/..." value="'+esc(p?.sourceUrl||"")+'">')+
 '<button type="button" class="secondary studio-import-button" data-action="studio-import-article">Haal artikel op</button>'+
 '<div class="studio-panel-bottom"><small>Uses the ChatGPT account already signed in to Safari.</small><button data-action="studio-chatgpt" class="primary">'+automaticLabel+'</button></div></section>'+
 '<section id="studio-step-2" class="studio-panel studio-results" tabindex="-1"><div class="studio-panel-head"><h2>02 <span>AI extraction</span></h2><button class="secondary mini" data-action="studio-chatgpt">Generate again</button></div>'+
 '<div class="studio-label">Song concept</div><div class="studio-concept">'+esc(result.concept||"Importeer een artikel of vul een URL in en laat Blossom automatisch originele lyrics maken.")+'</div>'+
 '<div class="studio-label">Mood</div><div class="studio-chiprow">'+(tags(result.moods)||'<span class="studio-muted">AI will suggest emotions</span>')+'</div>'+
 '<div class="studio-label">Suggested titles</div><div class="studio-ideas">'+(result.titles?.length?result.titles.map((title,i)=>'<div><span>'+(i+1)+'. '+esc(title)+'</span><button class="secondary mini" data-action="studio-use-title" data-title="'+esc(title)+'">Use</button></div>').join(""):'<div class="studio-muted">Title suggestions appear here</div>')+'</div>'+
 '<div class="studio-label">Generated lyrics <button class="secondary mini" data-action="studio-save-lyrics">Save edits</button></div>'+
 '<textarea id="studio-lyrics" rows="11" placeholder="Original [Verse], [Chorus], [Bridge] sections appear here">'+esc(result.lyrics||"")+'</textarea>'+
 '<div class="studio-label">AI production notes</div><p class="studio-hint">'+esc(result.rationale||"Choose your artist and genre for tailored arrangements.")+'</p></section>'+
 '<section id="studio-step-3" class="studio-panel studio-controls" tabindex="-1"><div class="studio-panel-head"><h2>03 <span>Generation parameters</span></h2><button class="secondary mini" data-action="studio-use-preset">Artist default</button></div>'+
 field("Suno model",'<input id="studio-model" maxlength="50" value="'+esc(params.sunoModel||"v6")+'" aria-label="Model selected in Suno">')+
 field("Primary genre",'<input id="studio-genre" list="studio-genres" value="'+esc(params.genre)+'"><datalist id="studio-genres">'+genres.map(g=>'<option value="'+esc(g)+'"></option>').join("")+'</datalist>')+
 field("Additional styles (comma separated)",'<input id="studio-styles" value="'+safeList(params.additionalStyles||[])+'" placeholder="Americana, Acoustic, Country Folk">')+
 '<div class="studio-dna-picker"><strong>Music DNA inspiration</strong><p class="studio-hint">Use analyzed recordings as references for an original arrangement. No source lyrics or melodies are copied.</p>'+
 '<div class="studio-dna-choice">'+
 field("DNA reference",'<select id="studio-dna-select"><option value="">Choose an analyzed recording</option>'+referenceOptions.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.artist+" · "+r.title)+'</option>').join("")+'</select>')+
 field("Influence",'<input id="studio-dna-weight" type="number" min="1" max="100" value="50">')+
 '<button class="secondary mini" data-action="studio-add-dna" '+(referenceOptions.length?'':'disabled')+'>Add reference</button></div>'+
 (projectReferences.length ? '<div class="studio-dna-linked">'+projectReferences.map(r=>'<div><span>'+esc(r.profile.artist+" · "+r.profile.title)+' ('+r.weight+'%)</span><button class="secondary mini" data-action="studio-remove-dna" data-profile-id="'+esc(r.profileId)+'" aria-label="Remove reference">Remove</button></div>').join("")+'</div>' : '<p class="studio-hint">No DNA references linked yet. Analyze a recording in the Music DNA library first.</p>')+
 '</div>'+
 field("Exclude styles / instruments",'<input id="studio-excludes" value="'+safeList(params.excludeStyles||[])+'">')+
 '<div class="studio-control-grid">'+
 field("Lyrics language",choose("studio-language",[["auto","Artist / article language"],["en","English"],["nl","Dutch"],["de","German"],["fr","French"],["es","Spanish"],["it","Italian"],["pt","Portuguese"]],params.lyricLanguage||"auto"))+
 field("Vocal gender",choose("studio-gender",[["male","Male"],["female","Female"],["auto","Auto"]],params.vocalGender))+
 field("Playlist intent / length",choose("studio-duration-preset",Object.keys(presetNames).map(k=>[k,presetNames[k]]),params.durationPreset))+'</div>'+
 '<div class="studio-duration"><div><label for="studio-duration">Target duration</label><output id="studio-duration-value">'+formatTime(params.targetSeconds)+'</output></div><input id="studio-duration" type="range" min="35" max="900" step="5" value="'+params.targetSeconds+'"><div class="studio-duration-note">30 seconds is Spotify’s counted-play threshold, not an editorial playlist qualification. Suno duration is a target, never guaranteed.</div></div>'+
 '<div class="studio-toggles">'+
 '<label><input id="studio-instrumental" type="checkbox" '+(params.instrumental?"checked":"")+'> Instrumental</label>'+
 '<label><input id="studio-max-mode" type="checkbox" '+(params.maxMode?"checked":"")+'> Max Mode</label>'+
 '<label><input id="studio-personalize" type="checkbox" '+(params.personalize?"checked":"")+'> Personalize</label></div>'+
 slider("weirdness","Weirdness",params.weirdness)+slider("styleInfluence","Style Influence",params.styleInfluence)+slider("variety","Variety",params.variety)+
 field("Creative instructions",'<textarea id="studio-notes" rows="2" placeholder="No echo, warm analogue mix, early 1960s feel...">'+esc(params.customInstructions||"")+'</textarea>')+
 '<div class="studio-control-footer"><button class="secondary" data-action="studio-save-preset">Save as artist default</button><button class="primary" data-action="studio-recipe">Suno blueprint ↗</button></div>'+
 '<div class="studio-suno-handoff"><button type="button" class="secondary" data-action="studio-suno-open">Open Suno in Safari / browser ↗</button>'+
 '<button type="button" class="primary" data-action="studio-suno-prefill">View / copy Suno blueprint</button>'+
 '<p class="studio-hint">Use your regular browser for Google login. Copy the blueprint into Suno and click Generate yourself.</p></div></section>'+
 '<section id="studio-step-4" class="studio-panel studio-art" tabindex="-1">'+updateNotice+'<div class="studio-panel-head"><h2>04 <span>Asset generation</span></h2><span class="studio-mini-tag">CHATGPT</span></div>'+
 '<div class="studio-assetpreview">'+(image?'<img src="'+esc(image.url)+'" alt="Generated album artwork" loading="lazy">':'<div class="studio-empty-art"><div>♫</div><strong>ALBUM ART</strong><small>Generate with ChatGPT, then select a cover below</small></div>')+'</div>'+
 '<div class="studio-arttabs"><span>Album cover</span><span>Artist portrait</span></div>'+
 field("Album artwork prompt",'<textarea id="studio-cover-prompt" rows="3" placeholder="Original cinematic artwork, square format...">'+esc(artPrompt)+'</textarea>')+
 '<button class="secondary mini" data-action="studio-brief-cover-prompt">Use song brief prompt</button>'+
 '<button class="primary wide" data-action="studio-cover">Generate album art with ChatGPT</button>'+
 field("Wide artist banner prompt (16:9)",'<textarea id="studio-photo-prompt" rows="2" placeholder="Photorealistic cinematic 16:9 wide artist or band banner, room for name overlay...">'+esc(photoPrompt)+'</textarea>')+
 '<button class="secondary mini" data-action="studio-brief-photo-prompt">Use song brief prompt</button>'+
 '<button class="secondary wide" data-action="studio-photo">Generate wide artist cover with ChatGPT</button>'+
 (photo?'<div class="studio-photo-thumb"><div class="studio-photo-banner"><img src="'+esc(photo.url)+'" alt="Wide artist cover for '+esc(artistName)+'" loading="lazy"><strong>'+esc(artistName)+'</strong></div><span class="studio-photo-caption">Wide artist banner · selected</span><button type="button" class="secondary mini" data-tab="artists">View full-width in Artists →</button></div>':'<p class="studio-hint">Artist photos generate as wide landscape banners. Choose an artist and link the selected photo to display it on the Artists page.</p>')+
 '</section></div>'+
 '<section id="studio-step-5" class="studio-panel studio-release" tabindex="-1" aria-label="Release in Suno">'+
 '<div class="studio-panel-head"><h2>05 <span>Release · Generate in Suno</span></h2><span class="studio-mini-tag">'+
 (state.data.studioStatus?.sunoApiConfigured?"SUNO PLATFORM API":"SUNO BROWSER")+'</span></div>'+
 '<div class="studio-release-body">'+
 '<div><strong>Production readiness</strong>'+
 (studioSunoReadiness(p).ready?'<p class="studio-ready">✓ Artist, title, brief, style and lyrics are ready.</p>':
  '<p class="studio-hint">Complete: '+esc(studioSunoReadiness(p).missing.join(" · "))+'</p>')+
 '<p class="studio-hint">Album artwork is optional for Suno generation. Your selected artist banner remains linked to the artist.</p></div>'+
 '<div class="studio-release-controls"><button type="button" class="primary" data-action="studio-suno-generate" '+
 (studioSunoReadiness(p).ready?'':'disabled')+'>'+
 (state.data.studioStatus?.sunoApiConfigured?'♫ Generate music in Suno':'♫ Generate in Suno (Playwright) ↗')+'</button>'+
 '<button type="button" class="secondary" data-action="studio-suno-browser-download">Import selected Suno MP3</button>'+
 '<button type="button" class="secondary" data-action="catalog-add-project" data-id="'+esc(p?.id||'')+'" '+(p?.id&&p?.artistId?'':'disabled')+'>Add to album / EP / single</button>'+
 '<button type="button" class="secondary" data-action="studio-suno-status"'+(p?.sunoJob?'':' disabled')+'>Check generation status</button>'+
 '<button type="button" class="secondary" data-action="studio-suno-import"'+
 (p?.sunoJob?.status==="complete"&&!p?.sunoJob?.importedAssetId?'':' disabled')+
 '>Import finished Suno audio</button></div>'+
 '<div class="studio-release-status" role="status">'+
 (p?.sunoJob?
 'Suno job: '+esc(p.sunoJob.status)+(p.sunoJob.importedAssetId?' · Imported into Blossom':'') :
 (state.data.studioStatus?.sunoApiConfigured?
 'Suno API key is configured. Generation creates a paid Suno task; confirm before submission.':
 'No Suno Platform API key configured. The button opens the authorized Suno workflow; press Create there, then import the MP3 here.'))+
 '</div></div></section>'+
 '<div class="studio-lower studio-output"><div class="studio-output-tabs" role="tablist" aria-label="Studio output">'+
 '<button type="button" class="studio-output-tab" role="tab" data-action="studio-bottom-tab" data-tab="tracks" aria-controls="studio-pane-tracks" aria-selected="'+(work.bottomTab==="tracks"?"true":"false")+'">Briefs, audio &amp; assets</button>'+
 '<button type="button" class="studio-output-tab" role="tab" data-action="studio-bottom-tab" data-tab="assistant" aria-controls="studio-pane-assistant" aria-selected="'+(work.bottomTab==="assistant"?"true":"false")+'">AI assistant</button></div>'+
 '<section id="studio-pane-tracks" role="tabpanel" aria-label="Generated tracks and assets" class="studio-panel studio-files studio-bottom-pane" '+(work.bottomTab==="tracks"?"":"hidden")+' tabindex="0"><div class="studio-panel-head"><h2>Production briefs &amp; linked assets</h2><span class="studio-mini-tag">'+(p?.trackId?'1 brief':'0 briefs')+' · '+assets.filter(a=>a.kind==='audio').length+' audio files</span></div>'+
 '<div class="studio-tracks">'+(p?.trackId?'<div class="studio-trackline"><div class="studio-note">♫</div><div><strong>'+esc(p.title)+'</strong><small>Track linked · ID '+esc(p.trackId.slice(0,8))+'</small></div><span class="studio-mini-tag">IN PRODUCTION</span></div>':'<div class="studio-empty-row">No track linked yet. Extract an article, then create the production brief.</div>')+
 assets.map(a=>'<div class="studio-trackline">'+(a.kind==="audio"?'<div class="studio-note">▶</div>':'<img src="'+esc(a.url)+'" alt="'+esc(a.kind)+'">')+
 '<div><strong>'+esc(a.kind.replace("-"," "))+(a.selected?' · <span class="studio-selected-label">Selected</span>':'')+'</strong><small>'+esc(a.createdAt.slice(0,16).replace("T"," "))+' · '+esc(a.provider==="chatgpt"?"ChatGPT":a.provider==="upload"?"Uploaded audio":a.provider==="draw-things"?"Draw Things":"Legacy · provider unknown")+' · '+esc(a.briefMatch==="current"?"Current song brief":a.briefMatch==="earlier"?"Earlier song brief":"Brief not recorded")+'</small>'+
 (a.prompt?'<details class="studio-asset-details"><summary>View prompt</summary><p>'+esc(a.prompt)+'</p></details>':'')+'</div>'+
 '<div class="studio-asset-actions">'+(a.kind==="audio"?'<button class="secondary mini" data-action="studio-select-asset" data-asset-id="'+esc(a.id)+'" data-kind="audio" '+(a.selected?'disabled':'')+'>Use audio</button>':
 '<button class="secondary mini" data-action="studio-select-asset" data-asset-id="'+esc(a.id)+'" data-kind="cover" '+(a.selected&&a.kind==="cover"?'disabled':'')+'>Use as cover</button>'+
 '<button class="secondary mini" data-action="studio-select-asset" data-asset-id="'+esc(a.id)+'" data-kind="artist-photo" '+(a.selected&&a.kind==="artist-photo"?'disabled':'')+'>Use as artist photo</button>')+
 '<button class="secondary mini" data-action="studio-delete-asset" data-asset-id="'+esc(a.id)+'">Remove</button></div>'+
 (a.kind==="audio"?'<audio controls preload="none" src="'+esc(a.url)+'"></audio>':'<a class="secondary mini" href="'+esc(a.url)+'" target="_blank">Open</a>')+'</div>').join("")+'</div>'+
 '<div class="studio-file-actions"><button class="primary" data-action="studio-create-track">Create linked track</button>'+
 '<label class="secondary studio-upload">Import Suno audio<input id="studio-audio-file" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" hidden></label></div></section>'+
 '<section id="studio-pane-assistant" role="tabpanel" aria-label="AI assistant" class="studio-panel studio-assistant studio-bottom-pane" '+(work.bottomTab==="assistant"?"":"hidden")+' tabindex="0"><div class="studio-panel-head"><h2>AI assistant</h2><span class="studio-mini-tag">'+(state.data.studioStatus?.openaiConfigured?"OPENAI API":"LOKALE AI")+'</span></div>'+
 '<p class="studio-hint">Ask about the arrangement, lyrics, instrumentation or release preparation, without leaving Blossom.</p>'+
 '<textarea id="studio-question" placeholder="Make these lyrics sound more like 1960s country, with less reverb..." rows="3"></textarea>'+
 '<button class="secondary wide" data-action="studio-ask">Ask AI assistant</button>'+
 '<div class="studio-answer">'+esc(work.assistantAnswer||"Antwoorden verschijnen hier. Het lokale model vereist geen API-key.")+'</div></section></div>';
};
export function studioView(state){
 const saved=stateOf(state),key=saved?.id||"new",c=controllers.get(key),stored=readDraft(draftStorage(),draftPrefix+key);
 const edits=c?.dirty?c.changes:stored?projectChanges(stored.base,stored.draft):{};
 const project=Object.keys(edits).length?mergeEdits(saved||{parameters:defaults,result:{}},edits):saved;
 work.renderedProject=project;
 const assets=state.data.studioAssets||[];
 const status=state.data.studioStatus||{};
 return '<div class="studio-workspace">'+panels(project,assets,state)+
 '<div class="studio-statusline"><span>● Lyrics: ChatGPT in your signed-in Safari</span>'+
 '<span>● Images: ChatGPT · '+esc(status.studioVersion===STUDIO_ASSET_VERSION?"asset selection ready":"restart Blossom and reload this page")+'</span>'+
 '<span id="studio-save-state" role="status" aria-live="polite">'+esc(Object.keys(edits).length&&work.saveStatus==='Saved'?'Pending':work.saveStatus)+'</span></div></div>';
}
function collect(state){
 return {id:stateOf(state)?.id,title:document.querySelector("#studio-title").value,
 article:document.querySelector("#studio-article").value,
 artistId:document.querySelector("#studio-artist").value,
 sourceUrl:document.querySelector("#studio-source").value,parameters:paramsFromDOM()};
}
async function save(state,api,patch={}){
 if(work.activeId&&!work.creatingNew&&!stateOf(state))throw Error("Selected project is unavailable. Reload it before saving.");
 const selected=stateOf(state),c=controllerFor(state,api);
 const baseline=work.renderedProject&&work.renderedProject.id===selected?.id?work.renderedProject:selected||c.base;
 const values={...collect(state),...patch};const lyrics=document.querySelector("#studio-lyrics");
 if(lyrics&&lyrics.value!==(baseline.result?.lyrics||""))values.result={lyrics:lyrics.value};
 const edits=projectChanges(baseline,values);
 if(Object.keys(edits).length)c.edit(edits);
 return c.flush();
}
export function pasteStartsLyrics(field,text){
 const value=String(text??"").trim();
 if(field==="url"){
  try{const url=new URL(value);return url.protocol==="http:"||url.protocol==="https:";}
  catch{return false;}
 }
 return field==="article"&&value.length>=80;
}
export function nextChatGptPercent(current,incoming){
 const value=Math.max(0,Math.min(100,Math.round(Number(incoming)||0)));
 return value<current?current:value;
}
export function chatGptProgressMarkup(status){
 const percent=Math.max(0,Math.min(100,Math.round(Number(status?.percent)||0)));
 const label=esc(status?.label||"Working with ChatGPT");
 return '<div class="studio-chatgpt-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+percent+'" aria-label="'+label+'"><span>'+label+'</span><div class="studio-chatgpt-progress-track"><div class="studio-chatgpt-progress-fill" style="width:'+percent+'%"></div></div></div>';
}
function paintChatGptProgress(status){
 if(typeof document==="undefined"||!document.querySelector||!status||typeof status!=="object")return;
 const incoming=Math.max(0,Math.min(100,Math.round(Number(status.percent)||0)));
 const percent=nextChatGptPercent(work.chatgptPercent||0,incoming);
 if(percent!==incoming)return;
 work.chatgptPercent=percent;
 const markup=chatGptProgressMarkup({...status,percent});
 const existing=document.querySelector(".studio-chatgpt-progress");
 if(existing&&typeof existing.outerHTML==="string"){existing.outerHTML=markup;return;}
 const host=document.querySelector(".studio-panel-bottom");
 if(!host||typeof host.insertAdjacentHTML!=="function")return;
 host.insertAdjacentHTML("afterbegin",markup);
}
function clearChatGptProgress(){
 work.chatgptPercent=0;
 const existing=typeof document!=="undefined"&&document.querySelector?.(".studio-chatgpt-progress");
 if(existing&&typeof existing.remove==="function")existing.remove();
}
async function generateChatGpt(state,api,refresh,message,savedProject){
 message("ChatGPT is writing the lyrics…");
 const project=savedProject||await save(state,api);
 work.chatgptPercent=0;
 paintChatGptProgress({percent:8,label:"Opening your ChatGPT tab"});
 const paint=()=>api("studio/chatgpt-lyrics/status").then(paintChatGptProgress).catch(()=>{});
 paint();
 if(work.chatgptPoll)clearInterval(work.chatgptPoll);
 work.chatgptPoll=setInterval(paint,800);
 try{await api("studio/projects/"+project.id+"/chatgpt-lyrics",{});
  paintChatGptProgress({percent:100,label:"Song brief placed in Blossom"});}
 catch(error){
  clearChatGptProgress();
  if(error.code==="chatgpt_login_required"){
   message(error.message||"Sign in to ChatGPT in the opened Safari window, then generate again.",true);
   return;
  }
  throw error;
 }
 finally{if(work.chatgptPoll){clearInterval(work.chatgptPoll);work.chatgptPoll=null;}}
 await refresh();
 message("Song brief saved: lyrics, style, titles, and artwork prompts.");
}
export async function studioPaste(field,state,api,refresh,message){
 if(work.busy){message("Current studio operation is still running",true);return;}
 work.busy=true;
 try{
  if(field==="url"){
   const sourceUrl=document.querySelector("#studio-source").value.trim();
   if(!pasteStartsLyrics("url",sourceUrl))return;
   const article=await api("studio/articles/import",{url:sourceUrl});
   document.querySelector("#studio-article").value=article.text;
   document.querySelector("#studio-source").value=article.sourceUrl;
   const title=document.querySelector("#studio-title");
   if(!title.value.trim()||title.value==="Untitled project")title.value=article.title||"News article";
  }else if(!pasteStartsLyrics("article",document.querySelector("#studio-article").value))return;
  await generateChatGpt(state,api,refresh,message);
 }finally{work.busy=false;}
}
async function refreshKeepingInputs(refresh){
 const edits=[...document.querySelectorAll(".studio-workspace input[id], .studio-workspace textarea[id], .studio-workspace select[id]")]
   .filter(node=>node.id!=="studio-project-picker"&&node.type!=="file")
   .map(node=>({id:node.id,value:node.value,checked:node.checked}));
 await refresh();
 for(const edit of edits){
   const node=document.getElementById(edit.id);
   if(node){node.value=edit.value;if(typeof edit.checked==="boolean")node.checked=edit.checked;}
 }
 for(const id of ["weirdness","styleInfluence","variety"]){
   const value=document.getElementById("studio-"+id)?.value,out=document.getElementById("out-"+id);
   if(out&&value!==undefined)out.textContent=value+"%";
 }
 const duration=document.getElementById("studio-duration"),output=document.getElementById("studio-duration-value");
 if(duration&&output)output.textContent=formatTime(Number(duration.value));
}
function watchSunoProject(projectId,api,refresh,message){
 if(work.sunoTimer){clearInterval(work.sunoTimer);work.sunoTimer=null;}
 let busy=false,attempts=0;
 work.sunoTimer=setInterval(async()=>{
   if(busy)return;
   busy=true;
   try{
     const job=await api("studio/projects/"+projectId+"/suno/status");
     attempts++;
     if(job.status==="complete"){
       clearInterval(work.sunoTimer);work.sunoTimer=null;
       message("Suno completed generation. Importing the finished audio into Blossom…");
       try{
         await api("studio/projects/"+projectId+"/suno/import",{});
         await refresh();
         message("Suno music generated and the audio is now linked to your project.");
       }catch(error){
         await refresh();
         message("Suno finished, but automatic audio import failed: "+error.message+
           ". Use Import finished Suno audio or import an MP3 manually.",true);
       }
     }else if(["error","failed"].includes(job.status)){
       clearInterval(work.sunoTimer);work.sunoTimer=null;
       await refresh();message("Suno generation failed. Check your Suno Platform account.",true);
     }else if(attempts>=90){
       clearInterval(work.sunoTimer);work.sunoTimer=null;
       await refresh();message("Suno generation is still running. Use Check generation status to resume.",true);
     }
   }catch(error){
     // Keep retrying transient polling errors; never resubmit a paid job.
     if(++attempts>=90){
       clearInterval(work.sunoTimer);work.sunoTimer=null;
       message("Could not check Suno status. The original job is retained; use Check generation status.",true);
     }
   }finally{busy=false;}
 },8000);
}
function studioLiveReady(state){
 const p=stateOf(state);
 if(!p)return false;
 const title=document.querySelector("#studio-title")?.value?.trim()||"";
 const artist=document.querySelector("#studio-artist")?.value||"";
 const genre=document.querySelector("#studio-genre")?.value?.trim()||"";
 const instrumental=document.querySelector("#studio-instrumental")?.checked;
 const lyrics=document.querySelector("#studio-lyrics")?.value?.trim()||"";
 return !p.integrity?.briefStale&&!p.integrity?.instructionConflicts?.length&&!!artist&&!!genre&&!!p.result?.concept?.trim()&&
   (instrumental||!!lyrics)&&!!title&&title!=="Untitled project";
}
function updateStudioReadiness(state){
 const button=document.querySelector('[data-action="studio-suno-generate"]');
 if(button)button.disabled=!studioLiveReady(state);
 const ready=document.querySelector("#studio-step-5 .studio-release-status");
 if(ready&&!studioLiveReady(state)&&!stateOf(state)?.sunoJob)
   ready.textContent="Finish the artist, title, brief, style and lyrics before generating.";
}
export async function studioAction(el,state,api,refresh,message){
 const action=el.dataset.action;
 if(work.busy){message("Current studio operation is still running",true);return;}
 work.busy=true;el.disabled=true;
 try{
  if(action==="studio-step"){
    const step=Number(el.dataset.step);
    if(!Number.isInteger(step)||step<1||step>5)return;
    // Save edits so navigating to Release cannot silently use old controls.
    await save(state,api);
    work.activeStep=step;
    await refresh();
    const target=document.getElementById("studio-step-"+step);
    if(target){
      target.scrollIntoView({behavior:"smooth",block:"nearest",inline:"nearest"});
      target.focus({preventScroll:true});
    }
    return;
  }
  if(action==="studio-suno-generate"){
    if(!studioLiveReady(state)){message("Complete artist, title, AI brief, lyrics and genre first.",true);return;}
    let project=await save(state,api);
    const lyrics=document.querySelector("#studio-lyrics").value;
    if(project.result?.lyrics!==lyrics)project=await api("studio/projects/"+project.id+"/lyrics",{lyrics,expectedRevision:project.revision});
    if(state.data.studioStatus?.sunoApiConfigured){
      if(!window.confirm("Submit this song for generation on Suno Platform? This may incur Suno API charges."))return;
      const job=await api("studio/projects/"+project.id+"/suno/generate",{});
      await refresh();work.activeStep=5;
      message("Suno accepted the generation request ("+job.status+"). Audio will be imported when complete.");
      watchSunoProject(project.id,api,refresh,message);
      return;
    }
    // Use the visible, signed-in Suno browser instead of an unverified API.
    if(!window.confirm("Create this song in your signed-in Suno browser? This can spend Suno credits."))return;
    await api("studio/projects/"+project.id+"/suno-browser/open",{});
    const submitted=await api("studio/projects/"+project.id+"/suno-browser/submit",{});
    await refresh();
    message(submitted.note||"Creation submitted on Suno. When the song finishes, select it in Suno and download the MP3 through Blossom.");
    return;
  }
  if(action==="studio-suno-status"){
    const project=stateOf(state);
    if(!project)return;
    const status=await api("studio/projects/"+project.id+"/suno/status");
    await refresh();
    if(status.status==="complete"&&!status.importedAssetId)message("Suno finished. Select Import finished Suno audio.");
    else if(status.status==="complete")message("Suno audio already imported.");
    else{
      message("Suno generation: "+status.status+(status.warning?" · "+status.warning:""));
      if(["submitted","queued","streaming"].includes(status.status))
        watchSunoProject(project.id,api,refresh,message);
    }
    return;
  }
  if(action==="studio-suno-browser-download"){
    const project=stateOf(state);
    if(!project)return;
    const downloaded=await api("studio/projects/"+project.id+"/suno-browser/download",{});
    await refresh();
    message("MP3 imported into Blossom: "+downloaded.asset.id);
    return;
  }
  if(action==="studio-suno-import"){
    const project=stateOf(state);
    if(!project)return;
    const result=await api("studio/projects/"+project.id+"/suno/import",{});
    await refresh();
    message("Generated Suno audio imported and linked to this project: "+result.asset.id);
    return;
  }
  if(action==="studio-create-artist"){
    const existing=stateOf(state),suggested=existing?.result?.artistName||"";
    const name=window.prompt("Enter the fictional artist name to create or link:",suggested)?.trim();
    if(!name)return;
    const found=(state.data.artists||[]).find(a=>a.name.toLocaleLowerCase()===name.toLocaleLowerCase());
    let artistId=found?.id;
    if(!artistId){
      const params=paramsFromDOM();
      const created=await api("artists",{name,genre:params.genre,
        language:params.lyricLanguage==="auto"?"en":params.lyricLanguage,
        countries:[],voice:params.instrumental?"instrumental":
        params.vocalGender==="auto"?"mixed":params.vocalGender,
        dna:(existing?.result?.style||params.genre||"Original fictional artist").slice(0,1000)});
      artistId=created.id;
    }
    const select=document.querySelector("#studio-artist");
    if(!Array.from(select.options).some(option=>option.value===artistId))select.add(new Option(name,artistId));
    select.value=artistId;
    await save(state,api);await refresh();
    message("Artist "+name+" linked to this Studio project");
    return;
  }
  if(action==="studio-bottom-tab"){
    work.bottomTab=el.dataset.tab==="assistant"?"assistant":"tracks";
    for(const tab of document.querySelectorAll(".studio-output-tab")){
      const active=tab.dataset.tab===work.bottomTab;
      tab.setAttribute("aria-selected",String(active));
      tab.tabIndex=active?0:-1;
    }
    for(const pane of document.querySelectorAll(".studio-bottom-pane"))
      pane.hidden=pane.id!=="studio-pane-"+work.bottomTab;
    return;
  }
  if(action==="studio-use-title"){document.querySelector("#studio-title").value=el.dataset.title;await save(state,api);return;}
  if(action==="studio-new"){await studioFlush();work.activeId=null;work.creatingNew=true;work.assistantAnswer="";saveSelection();await refresh();return;}
  if(action==="studio-conflict-local"||action==="studio-conflict-server"){
    const c=controllerFor(state,api);await c.resolve(action==="studio-conflict-local");await refresh();return;
  }
  if(action==="studio-save"){await save(state,api);await refresh();message("Project saved");return;}
  if(action==="studio-use-preset"){
    const id=document.querySelector("#studio-artist").value;
    const preset=state.data.studioArtistPresets?.[id];
    if(!preset){message("No saved defaults for this artist",true);return;}
    await save(state,api,{parameters:preset});await refresh();message("Artist defaults applied");return;
  }
  if(action==="studio-save-preset"){
    const artistId=document.querySelector("#studio-artist").value;
    if(!artistId){message("Choose an artist first",true);return;}
    await api("studio/artists/"+artistId+"/preset",paramsFromDOM());message("Artist defaults saved");return;
  }
  if(action==="studio-import-article"){
    const sourceUrl=document.querySelector("#studio-source").value.trim();
    if(!sourceUrl){message("Vul eerst een artikel-URL in.",true);return;}
    const article=await api("studio/articles/import",{url:sourceUrl});
    document.querySelector("#studio-article").value=article.text;
    document.querySelector("#studio-source").value=article.sourceUrl;
    const title=document.querySelector("#studio-title");
    if(!title.value.trim()||title.value==="Untitled project")title.value=article.title||"Nieuwsartikel";
    await save(state,api);await refresh();
    message("Artikeltekst geïmporteerd. Klaar voor automatische generatie.");
    return;
  }
  if(action==="studio-brief-cover-prompt"||action==="studio-brief-photo-prompt"){
    const result=stateOf(state)?.result||{},cover=action==="studio-brief-cover-prompt";
    const prompt=cover?result.coverPrompt:result.artistPhotoPrompt;
    if(!prompt){message("Generate the song brief with ChatGPT first",true);return;}
    document.querySelector(cover?"#studio-cover-prompt":"#studio-photo-prompt").value=prompt;
    const input=document.querySelector(cover?"#studio-cover-prompt":"#studio-photo-prompt");studioAutoSave({target:input},state,api);await studioFlush();
    message("Song brief prompt applied");return;
  }
  if(action==="studio-select-asset"||action==="studio-delete-asset"){
    const project=stateOf(state);
    if(!project)throw Error("Choose a saved project first");
    if(state.data.studioStatus?.studioVersion!==STUDIO_ASSET_VERSION)throw Error("Restart the updated Blossom server and reload this page first");
    const operation=action==="studio-select-asset"?"select":"delete";
    await api("studio/projects/"+project.id+"/assets/"+el.dataset.assetId+"/"+operation,operation==="select"?{kind:el.dataset.kind}:{});
    await refreshKeepingInputs(refresh);message(operation==="select"?"Selected asset linked to this project":"Asset removed from this project");return;
  }
  if(["studio-cover","studio-photo","studio-generate-all"].includes(action)&&state.data.studioStatus?.studioVersion!==STUDIO_ASSET_VERSION)
    throw Error("Restart the updated Blossom server and reload this page first; ChatGPT image routing is not confirmed");
  const p=await save(state,api);
  if(action==="studio-add-dna"||action==="studio-remove-dna"){
    const previous=(state.data.studioReferences||[]).map(x=>({profileId:x.profileId,weight:x.weight}));
    let updated;
    if(action==="studio-remove-dna")updated=previous.filter(x=>x.profileId!==el.dataset.profileId);
    else {
      const profileId=document.querySelector("#studio-dna-select").value;
      const weight=Number(document.querySelector("#studio-dna-weight").value);
      if(!profileId){message("Choose an analyzed reference first",true);return;}
      if(previous.some(x=>x.profileId===profileId)){message("Reference is already linked",true);return;}
      updated=[...previous,{profileId,weight}];
    }
    await api("studio/projects/"+p.id+"/references",{references:updated});
    await refresh();message("Music DNA references updated");return;
  }
  if(action==="studio-chatgpt"){
    await generateChatGpt(state,api,refresh,message,p);
    return;
  }
  if(action==="studio-extract"){
    await api("studio/projects/"+p.id+"/extract",{});await refresh();message("Original lyrics and styles generated");return;
  }
  if(action==="studio-save-lyrics"){
    const result={...p.result,lyrics:document.querySelector("#studio-lyrics").value};
    if(result.lyrics!==p.result?.lyrics)await api("studio/projects/"+p.id+"/lyrics",{lyrics:result.lyrics,expectedRevision:p.revision});await refresh();message("Lyrics edits saved");return;
  }
  if(action==="studio-suno-open"){
    const canOpenSafari=state.data.browserAccounts?.nativeSafariAvailable &&
      ["localhost","127.0.0.1"].includes(location.hostname);
    if(canOpenSafari){
      await api("browser-accounts/suno/open-safari",{});
      message("Suno opened in the normal Safari application. Sign in with Google there.");
      return;
    }
    if(navigator.webdriver===true){
      message("This Chrome window is automated. Open https://suno.com/create in normal Safari or Chrome instead.",true);
      return;
    }
    // Saving the project is asynchronous. Show a safe ordinary link instead
    // of calling window.open after await, which browsers can block as a popup.
    const recipe=await api("studio/projects/"+p.id+"/recipe");
    const dialog=document.querySelector("#recipe-dialog");
    document.querySelector("#recipe-text").value=JSON.stringify(recipe,null,2);
    dialog.showModal();
    message("Open https://suno.com/create in your normal browser and copy the blueprint.");
    return;
  }
  if(action==="studio-suno-prefill"){
    if(p.result?.concept&&p.result.lyrics!==document.querySelector("#studio-lyrics").value){
      await api("studio/projects/"+p.id+"/lyrics",
        {lyrics:document.querySelector("#studio-lyrics").value,expectedRevision:p.revision});
    }
    const recipe=await api("studio/projects/"+p.id+"/recipe");
    document.querySelector("#recipe-text").value=JSON.stringify(recipe,null,2);
    document.querySelector("#recipe-dialog").showModal();
    message("Copy this blueprint into the regular Suno browser window.");
    return;
  }
  if(action==="studio-recipe"){
    const recipe=await api("studio/projects/"+p.id+"/recipe");
    const dialog=document.querySelector("#recipe-dialog");document.querySelector("#recipe-text").value=JSON.stringify(recipe,null,2);
    dialog.showModal();message("Copy the blueprint into your authorized Suno session");return;
  }
  if(action==="studio-create-track"){
    await api("studio/projects/"+p.id+"/create-track",{});await refresh();message("Production brief created and linked");return;
  }
  if(action==="studio-ask"){
    const q=document.querySelector("#studio-question").value;
    const answer=await api("studio/projects/"+p.id+"/ask",{question:q});
    work.assistantAnswer=answer.answer;await refresh();message("AI assistant responded");return;
  }
  if(action==="studio-cover"||action==="studio-photo"){
    const kind=action==="studio-cover"?"cover":"artist-photo";
    const prompt=document.querySelector(kind==="cover"?"#studio-cover-prompt":"#studio-photo-prompt").value;
    message("ChatGPT is generating the image in Safari…");
    await api("studio/projects/"+p.id+"/generate-art",{kind,prompt});
    await refresh();message("ChatGPT image imported. The first image is shown automatically; choose another version below.");return;
  }
  if(action==="studio-generate-all"){
    message("ChatGPT is preparing the song brief and both images…");
    const result=await api("studio/projects/"+p.id+"/chatgpt-lyrics",{});
    await refresh();
    if(!result.trackId&&result.artistId)await api("studio/projects/"+p.id+"/create-track",{});
    for(const [kind,prompt] of [["cover",result.result.coverPrompt],["artist-photo",result.result.artistPhotoPrompt]]) {
      if(prompt)await api("studio/projects/"+p.id+"/generate-art",{kind,prompt});
      await refresh();
    }
    await refresh();message("ChatGPT brief and images saved. Select the images you want to use below.");return;
  }
 }catch(error){message(error.message,true)}
 finally{work.busy=false;el.disabled=false}
}
export async function studioAudio(file,state,refresh,message){
 if(!file)return;
 const p=stateOf(state);if(!p){message("Save a project before importing audio",true);return;}
 const url="/api/studio/projects/"+p.id+"/upload-audio";
 const type=file.type==="audio/wav"||file.name.toLowerCase().endsWith(".wav")?"audio/wav":"audio/mpeg";
 if(file.size>40*1024*1024){message("Audio must be at most 40MB",true);return;}
 try{
 const response=await fetch(url,{method:"POST",headers:{"x-blossom-request":"ui","content-type":type},body:file});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||"Upload failed");
 await refresh();work.activeStep=5;message("Suno audio imported and linked to project");
 }catch(error){message(error.message,true)}
}
export function studioInput(event,state,refresh){
 const target=event.target;
 if(["studio-title","studio-artist","studio-genre","studio-lyrics","studio-instrumental"].includes(target.id))
   updateStudioReadiness(state);
 if(target.id==="studio-project-picker"){
   const select=()=>{if(target.value==="new"){work.activeId=null;work.creatingNew=true;}else{work.activeId=target.value;work.creatingNew=false;}work.assistantAnswer="";saveSelection();return refresh();};
   if([...new Set(controllers.values())].some(c=>c.dirty||c.running))return studioFlush().then(select).catch(error=>{target.value=work.activeId||"new";persistenceContext?.message(error.message,true);});
   return select();
 }
 if(target.id==="studio-duration-preset"){
   const profiles=state.data.studioPresets||{};
   const selected=profiles[target.value];
   if(selected){
     const slider=document.querySelector("#studio-duration");slider.min=selected.min;slider.max=selected.max;slider.value=selected.seconds;
     document.querySelector("#studio-duration-value").textContent=formatTime(selected.seconds);
   }
 }
 if(target.id==="studio-duration")document.querySelector("#studio-duration-value").textContent=formatTime(Number(target.value));
 if(["studio-weirdness","studio-styleInfluence","studio-variety"].includes(target.id))
   document.querySelector("#out-"+target.id.replace("studio-","")).textContent=target.value+"%";
}

export function studioSelectedId(){return work.activeId||"";}
export function studioActiveId(state){return stateOf(state)?.id||"";}
