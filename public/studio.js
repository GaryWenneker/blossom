const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const presetNames={radio:"Radio edit",streaming:"Streaming",focus:"Focus",ambient:"Ambient",custom:"Custom"};
const defaults={sunoModel:"v6",genre:"Country Pop",additionalStyles:["Americana","Acoustic"],excludeStyles:["Auto-Tune","unlicensed samples"],vocalGender:"male",
 instrumental:false,maxMode:false,weirdness:22,styleInfluence:75,variety:40,personalize:false,
 durationPreset:"radio",targetSeconds:205,customInstructions:"",imagePrompt:"",artistPhotoPrompt:""};
const work={activeId:null,creatingNew:false,busy:false,assistantAnswer:"",uploading:false,bottomTab:"tracks",chatgptPoll:null};
const formatTime=s=>Math.floor(s/60)+":"+String(s%60).padStart(2,"0");
const encode=v=>esc(v);
const stateOf=state=>{if(work.creatingNew)return null;const list=state.data.studioProjects||[];
 return (work.activeId?list.find(p=>p.id===work.activeId):null)||list[0]||null;};
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
   excludeStyles:textList("studio-excludes"),vocalGender:document.querySelector("#studio-gender").value,
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
 const image=assets.find(a=>a.kind==="cover"),photo=assets.find(a=>a.kind==="artist-photo");
 const projectOptions=(state.data.studioProjects||[]).map(x=>'<option value="'+esc(x.id)+'" '+(x.id===p?.id?"selected":"")+'>'+esc(x.title)+'</option>').join("");
 const artPrompt=params.imagePrompt||result.coverPrompt||"",photoPrompt=params.artistPhotoPrompt||result.artistPhotoPrompt||"";
 return '<div class="studio-toolbar">'+
 '<div class="studio-title"><div class="studio-square-icon">♫</div><div><h1>News to Song</h1><p>From story to original music, visual identity and release preparation.</p></div></div>'+
 '<div class="studio-toolbar-actions"><select id="studio-project-picker" aria-label="Select project"><option value="new">+ New project</option>'+projectOptions+'</select>'+
 '<button class="secondary" data-action="studio-save">Save project</button>'+
 '<button class="primary studio-run" data-action="studio-generate-all">✦ Prepare all</button></div></div>'+
 '<div class="studio-stepper"><span class="active"><b>1</b> Article</span><i></i><span><b>2</b> AI Brief</span><i></i><span><b>3</b> Configure</span><i></i><span><b>4</b> Artwork</span><i></i><span><b>5</b> Release</span></div>'+
 '<div class="studio-columns">'+
 '<section class="studio-panel studio-article"><div class="studio-panel-head"><h2>01 <span>News article</span></h2><span class="studio-mini-tag">SOURCE</span></div>'+
 field("Project title",'<input id="studio-title" maxlength="140" placeholder="Still by Hand" value="'+esc(p?.title||"")+'">')+
 field("Artist",'<select id="studio-artist"><option value="">Choose an artist</option>'+artists.map(a=>'<option value="'+esc(a.id)+'" '+(a.id===p?.artistId?"selected":"")+'>'+esc(a.name)+" · "+esc(a.genre)+'</option>').join("")+'</select>')+
 '<div class="studio-tabstrip"><span class="active">Paste article</span><span>URL attribution</span><span>Original concept</span></div>'+
 '<textarea id="studio-article" placeholder="Paste a news story, your own writing, or an original song concept..." spellcheck="true">'+esc(p?.article||"")+'</textarea>'+
 field("Article link (optional, attribution only)",'<input id="studio-source" type="url" placeholder="https://example.org/article" value="'+esc(p?.sourceUrl||"")+'">')+
 '<div class="studio-panel-bottom"><small>Uses your confirmed Safari ChatGPT session; saving back requires the connected Blossom MCP app. No copy/paste or API key.</small><button data-action="studio-chatgpt" class="primary">✦ Extract with ChatGPT</button></div></section>'+
 '<section class="studio-panel studio-results"><div class="studio-panel-head"><h2>02 <span>AI extraction</span></h2><button class="secondary mini" data-action="studio-chatgpt">Regenerate</button></div>'+
 '<div class="studio-label">Song concept</div><div class="studio-concept">'+esc(result.concept||"Add an article or article URL and select Extract with ChatGPT to create an original concept.")+'</div>'+
 '<div class="studio-label">Mood</div><div class="studio-chiprow">'+(tags(result.moods)||'<span class="studio-muted">AI will suggest emotions</span>')+'</div>'+
 '<div class="studio-label">Suggested titles</div><div class="studio-ideas">'+(result.titles?.length?result.titles.map((title,i)=>'<div><span>'+(i+1)+'. '+esc(title)+'</span><button class="secondary mini" data-action="studio-use-title" data-title="'+esc(title)+'">Use</button></div>').join(""):'<div class="studio-muted">Title suggestions appear here</div>')+'</div>'+
 '<div class="studio-label">Generated lyrics <button class="secondary mini" data-action="studio-save-lyrics">Save edits</button></div>'+
 '<textarea id="studio-lyrics" rows="11" placeholder="Original [Verse], [Chorus], [Bridge] sections appear here">'+esc(result.lyrics||"")+'</textarea>'+
 '<div class="studio-label">AI production notes</div><p class="studio-hint">'+esc(result.rationale||"Choose your artist and genre for tailored arrangements.")+'</p></section>'+
 '<section class="studio-panel studio-controls"><div class="studio-panel-head"><h2>03 <span>Generation parameters</span></h2><button class="secondary mini" data-action="studio-use-preset">Artist default</button></div>'+
 field("Suno model",choose("studio-model",[["v6","v6"],["v6-wild","v6 Wild"],["v6-mini","v6 Mini"],["custom","Custom model"]],params.sunoModel||"v6"))+
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
 '<section class="studio-panel studio-art"><div class="studio-panel-head"><h2>04 <span>Asset generation</span></h2><span class="studio-mini-tag">DRAW THINGS</span></div>'+
 '<div class="studio-assetpreview">'+(image?'<img src="'+esc(image.url)+'" alt="Generated album artwork" loading="lazy">':'<div class="studio-empty-art"><div>♫</div><strong>ALBUM ART</strong><small>Local Draw Things output</small></div>')+'</div>'+
 '<div class="studio-arttabs"><span>Album cover</span><span>Artist portrait</span></div>'+
 field("Album artwork prompt",'<textarea id="studio-cover-prompt" rows="3" placeholder="Original cinematic artwork, square format...">'+esc(artPrompt)+'</textarea>')+
 '<button class="primary wide" data-action="studio-cover">Generate album art</button>'+
 field("Spotify artist photo prompt",'<textarea id="studio-photo-prompt" rows="2" placeholder="Photorealistic portrait of a fictional musician...">'+esc(photoPrompt)+'</textarea>')+
 '<button class="secondary wide" data-action="studio-photo">Generate artist photo</button>'+
 (photo?'<div class="studio-photo-thumb"><img src="'+esc(photo.url)+'" alt="Fictional artist portrait"><span>Artist photo linked</span></div>':'<p class="studio-hint">All assets are generated on your Mac, stored privately and linked to this project.</p>')+
 '</section></div>'+
 '<div class="studio-lower studio-output"><div class="studio-output-tabs" role="tablist" aria-label="Studio output">'+
 '<button type="button" class="studio-output-tab" role="tab" data-action="studio-bottom-tab" data-tab="tracks" aria-controls="studio-pane-tracks" aria-selected="'+(work.bottomTab==="tracks"?"true":"false")+'">Generated tracks &amp; assets</button>'+
 '<button type="button" class="studio-output-tab" role="tab" data-action="studio-bottom-tab" data-tab="assistant" aria-controls="studio-pane-assistant" aria-selected="'+(work.bottomTab==="assistant"?"true":"false")+'">AI assistant</button></div>'+
 '<section id="studio-pane-tracks" role="tabpanel" aria-label="Generated tracks and assets" class="studio-panel studio-files studio-bottom-pane" '+(work.bottomTab==="tracks"?"":"hidden")+' tabindex="0"><div class="studio-panel-head"><h2>Generated tracks & linked assets</h2><span class="studio-mini-tag">PROJECT LIBRARY</span></div>'+
 '<div class="studio-tracks">'+(p?.trackId?'<div class="studio-trackline"><div class="studio-note">♫</div><div><strong>'+esc(p.title)+'</strong><small>Track linked · ID '+esc(p.trackId.slice(0,8))+'</small></div><span class="studio-mini-tag">IN PRODUCTION</span></div>':'<div class="studio-empty-row">No track linked yet. Extract an article, then create the production brief.</div>')+
 assets.map(a=>'<div class="studio-trackline">'+(a.kind==="audio"?'<div class="studio-note">▶</div>':'<img src="'+esc(a.url)+'" alt="'+esc(a.kind)+'">')+
 '<div><strong>'+esc(a.kind.replace("-"," "))+'</strong><small>'+esc(a.createdAt.slice(0,16).replace("T"," "))+'</small></div>'+
 (a.kind==="audio"?'<audio controls preload="none" src="'+esc(a.url)+'"></audio>':'<a class="secondary mini" href="'+esc(a.url)+'" target="_blank">Open</a>')+'</div>').join("")+'</div>'+
 '<div class="studio-file-actions"><button class="primary" data-action="studio-create-track">Create linked track</button>'+
 '<label class="secondary studio-upload">Import Suno audio<input id="studio-audio-file" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" hidden></label></div></section>'+
 '<section id="studio-pane-assistant" role="tabpanel" aria-label="AI assistant" class="studio-panel studio-assistant studio-bottom-pane" '+(work.bottomTab==="assistant"?"":"hidden")+' tabindex="0"><div class="studio-panel-head"><h2>AI assistant</h2><span class="studio-mini-tag">OPENAI API</span></div>'+
 '<p class="studio-hint">Ask about the arrangement, lyrics, instrumentation or release preparation, without leaving Blossom.</p>'+
 '<textarea id="studio-question" placeholder="Make these lyrics sound more like 1960s country, with less reverb..." rows="3"></textarea>'+
 '<button class="secondary wide" data-action="studio-ask">Ask AI assistant</button>'+
 '<div class="studio-answer">'+esc(work.assistantAnswer||"AI responses appear here. Requires your own OpenAI API key.")+'</div></section></div>';
};
export function studioView(state){
 const project=stateOf(state),assets=state.data.studioAssets||[];
 const status=state.data.studioStatus||{};
 return '<div class="studio-workspace">'+panels(project,assets,state)+
 '<div class="studio-statusline"><span>● ChatGPT browser: '+(state.data.browserAccounts?.chatgpt?.handoff?.state==="user_confirmed"?"sign-in confirmed":"sign-in not confirmed")+' · Blossom MCP app required</span>'+
 '<span>● Draw Things: '+(status.drawConfigured?"local image generation available":"image generation unavailable")+'</span>'+
 '<span>● Suno: authorized handoff, no browser automation</span></div></div>';
}
function collect(state){
 return {id:stateOf(state)?.id,title:document.querySelector("#studio-title").value,
 article:document.querySelector("#studio-article").value,
 artistId:document.querySelector("#studio-artist").value,
 sourceUrl:document.querySelector("#studio-source").value,parameters:paramsFromDOM()};
}
async function save(state,api){const p=await api("studio/projects",collect(state));work.activeId=p.id;work.creatingNew=false;return p;}
function watchChatGptResult(projectId, previousResult, api, refresh, message) {
  if(work.chatgptPoll)clearInterval(work.chatgptPoll);
  let attempts=0,checking=false;
  work.chatgptPoll=setInterval(async()=>{
    if(checking)return;
    checking=true;
    try {
      const projects=await api("studio/projects");
      const current=projects.find(p=>p.id===projectId);
      if(current && current.result?.concept && JSON.stringify(current.result)!==JSON.stringify(previousResult)) {
        clearInterval(work.chatgptPoll);work.chatgptPoll=null;
        await refresh();
        message("ChatGPT result saved in Blossom. Lyrics and production settings updated.");
        return;
      }
      if(++attempts>=90){
        clearInterval(work.chatgptPoll);work.chatgptPoll=null;
        message("No Blossom MCP result yet. Check the ChatGPT conversation and whether the Blossom app is connected.",true);
      }
    } catch(error) {
      if(++attempts>=90){clearInterval(work.chatgptPoll);work.chatgptPoll=null;message(error.message,true);}
    } finally {checking=false;}
  },3000);
}
export async function studioAction(el,state,api,refresh,message){
 const action=el.dataset.action;
 if(work.busy){message("Current studio operation is still running",true);return;}
 work.busy=true;el.disabled=true;
 try{
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
  if(action==="studio-use-title"){document.querySelector("#studio-title").value=el.dataset.title;return;}
  if(action==="studio-new"){work.activeId=null;work.creatingNew=true;work.assistantAnswer="";await refresh();return;}
  if(action==="studio-save"){await save(state,api);await refresh();message("Project saved");return;}
  if(action==="studio-use-preset"){
    const id=document.querySelector("#studio-artist").value;
    const preset=state.data.studioArtistPresets?.[id];
    if(!preset){message("No saved defaults for this artist",true);return;}
    await api("studio/projects",{...collect(state),parameters:preset});await refresh();message("Artist defaults applied");return;
  }
  if(action==="studio-save-preset"){
    const artistId=document.querySelector("#studio-artist").value;
    if(!artistId){message("Choose an artist first",true);return;}
    await api("studio/artists/"+artistId+"/preset",paramsFromDOM());message("Artist defaults saved");return;
  }
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
    message("Submitting through the ChatGPT session in your regular browser...");
    const submitted=await api("studio/projects/"+p.id+"/chatgpt-extract",{});
    if(!submitted.submitted)throw Error("Safari did not submit the ChatGPT request");
    watchChatGptResult(p.id,p.result,api,refresh,message);
    message("Sent via your browser. Waiting for ChatGPT to save the result through Blossom MCP.");
    return;
  }
  if(action==="studio-extract"){
    await api("studio/projects/"+p.id+"/extract",{});await refresh();message("Original lyrics and styles generated");return;
  }
  if(action==="studio-save-lyrics"){
    const result={...p.result,lyrics:document.querySelector("#studio-lyrics").value};
    await api("studio/projects/"+p.id+"/result",result);await refresh();message("Lyrics edits saved");return;
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
    if(p.result?.concept){
      await api("studio/projects/"+p.id+"/result",
        {...p.result,lyrics:document.querySelector("#studio-lyrics").value});
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
    await api("studio/projects/"+p.id+"/generate-art",{kind,prompt,steps:8,seed:0});
    await refresh();message(kind==="cover"?"Album artwork linked":"Artist photo linked");return;
  }
  if(action==="studio-generate-all"){
    if(!confirm("Prepare this project with AI, create a linked track and generate album art locally if configured? This uses API credits and may take several minutes. Suno music itself still requires an authorized workflow."))return;
    const result=await api("studio/projects/"+p.id+"/extract",{});
    if(!result.trackId&&result.artistId)await api("studio/projects/"+p.id+"/create-track",{});
    const status=state.data.studioStatus;
    if(status?.drawConfigured) {
      const prompt=result.parameters.imagePrompt||result.result.coverPrompt;
      if(prompt)await api("studio/projects/"+p.id+"/generate-art",{kind:"cover",prompt,steps:8,seed:0});
    }
    await refresh();message("Project brief and available assets prepared. Suno handoff remains manual.");return;
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
 await refresh();message("Suno audio imported and linked to project");
 }catch(error){message(error.message,true)}
}
export function studioInput(event,state,refresh){
 const target=event.target;
 if(target.id==="studio-project-picker"){
   if(target.value==="new"){work.activeId=null;work.creatingNew=true;}else{work.activeId=target.value;work.creatingNew=false;}
   work.assistantAnswer="";refresh();return;
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

export function studioActiveId(state){return stateOf(state)?.id||"";}
