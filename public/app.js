const e = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const view=document.querySelector("#view"),nav=document.querySelector("#nav"),toast=document.querySelector("#toast");
const state={tab:"overview",data:{summary:{},artists:[],tracks:[],releases:[],events:[],watches:{records:[]},integrations:{},connections:{},genres:{}}};
const nextStage={idea:"brief",brief:"generated",generated:"review",review:"approved",rejected:"brief"};
const releaseChecks={audioUploaded:"Audio at distributor",artworkUploaded:"Cover art at distributor",creditsVerified:"Credits verified",codesVerified:"ISRC/UPC verified",aiDisclosuresDone:"AI disclosure completed",distributorRightsConfirmed:"Rights and distribution terms verified"};
const capitals=s=>s.replaceAll("_"," ").replace(/\b\w/g,x=>x.toUpperCase());
const niceDate=d=>d?new Date(d).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
function message(text,error=false){
  toast.textContent=text;toast.className=error?"error":"";toast.style.display="block";
  clearTimeout(message.timer);message.timer=setTimeout(()=>toast.style.display="none",4500);
}
async function api(path,data){
  const opts={headers:{Accept:"application/json"}};
  if(data!==undefined){opts.method="POST";opts.headers["Content-Type"]="application/json";opts.headers["X-Blossom-Request"]="ui";opts.body=JSON.stringify(data);}
  const res=await fetch("/api/"+path,opts);
  const body=await res.json().catch(()=>({error:"Unexpected server response"}));
  if(res.status===401){window.location.assign("/login");throw Error("Session expired");}
  if(!res.ok)throw Error(body.error||"Request failed");
  return body;
}
async function refresh(){
  const names=["summary","artists","tracks","releases","events","watches","integrations","connections","genres"];
  const results=await Promise.all(names.map(apiName=>api(apiName)));
  state.data=Object.fromEntries(names.map((name,i)=>[name,results[i]]));render();
}
function badge(value){return '<span class="pill '+(["needs_reconciliation","rejected"].includes(value)?"warning":value==="draft"?"neutral":"")+'">'+e(capitals(value))+"</span>";}
function header(title,subtitle,action=""){
  return '<div class="headrow"><div><div class="eyebrow">BLOSSOM / '+e(state.tab)+'</div><h1>'+e(title)+'</h1><p class="subtitle">'+e(subtitle)+'</p></div>'+action+'</div>';
}
function metrics(){
 const s=state.data.summary;
 return '<div class="metric-grid">'+[["ARTISTS",s.artists,"Distinct label identities"],["TRACKS",s.tracks,"Original music pipeline"],["APPROVED",s.approvedTracks,"Rights reviewed"],["RELEASES",s.submittedReleases,"Submitted to distribution"]].map(x=>'<div class="metric"><div class="metric-label">'+e(x[0])+'</div><div class="metric-value">'+(x[1]||0)+'</div><div class="metric-foot">'+e(x[2])+'</div></div>').join("")+"</div>";
}
function activity(){
 const events=state.data.events;
 return events.length?'<div class="activity">'+events.slice(0,7).map(x=>'<div class="activity-item"><span class="activity-dot"></span><div><div class="activity-type">'+e(capitals(x.type))+' · '+e(x.entity)+'</div><div class="small">'+e(niceDate(x.createdAt))+' · '+e(x.detail?.title||x.detail?.name||x.entityId.slice(0,8))+'</div></div></div>').join("")+"</div>":'<div class="empty">Events will appear here when you start creating artists and tracks.</div>';
}
function overview(){
 const d=state.data;
 return header("A label that grows.","Manage independent artists, build original songs and publish only when compliance is clear.",badge("local pilot"))+
 metrics()+'<div class="kicker"><div><h2>Make music with a plan.</h2><p>Define each artist’s DNA, create a track brief, then generate a reproducible production blueprint.</p></div><button class="primary" data-tab="tracks">Open production →</button></div>'+
 '<div class="grid2" style="margin-top:18px"><section class="panel"><div class="panel-header"><h2>Latest activity</h2><span class="small">AUDIT TRAIL</span></div>'+activity()+'</section><section class="panel"><div class="panel-header"><h2>System readiness</h2></div>'+
 '<div class="stack"><div><div class="metric-label">Music generation</div><strong>Manual Suno blueprint</strong></div><div><div class="metric-label">LabelGrid</div><strong>'+e(d.integrations.labelgrid)+'</strong></div><div><div class="metric-label">Live delivery</div><strong>'+e(d.integrations.liveDistributionEnabled?"Enabled with final confirmation":"Disabled by default")+'</strong></div><div><div class="metric-label">Legal watch holds</div><strong>'+e(d.summary.unresolvedChanges||0)+'</strong></div></div></section></div>';
}
function artists(){
 return header("Artists","Every artist has separate creative DNA, a style, language and target territories.")+
 '<div class="panel"><div class="panel-header"><h2>Create artist</h2><span class="small">Identity verification required before publishing</span></div><form id="artist-form" class="fields">'+
 '<div class="field"><label for="artist-name">Artist name</label><input id="artist-name" name="name" required maxlength="80" placeholder="e.g. Mira Solenne"></div>'+
 '<div class="field"><label for="artist-genre">Primary genre</label><input list="genre-options" id="artist-genre" name="genre" required maxlength="100" placeholder="Select or type, e.g. Country Pop"><datalist id="genre-options">'+Object.values(state.data.genres).flat().map(g=>'<option value="'+e(g)+'"></option>').join("")+'</datalist></div>'+
 '<div class="field"><label for="artist-language">Language</label><input id="artist-language" name="language" value="en" required placeholder="en"></div>'+
 '<div class="field"><label for="artist-countries">Target countries (ISO codes)</label><input id="artist-countries" name="countries" placeholder="GB, US, NL"></div>'+
 '<div class="field"><label for="artist-voice">Voice</label><select id="artist-voice" name="voice"><option value="instrumental">Instrumental</option><option value="female">Female</option><option value="male">Male</option><option value="mixed">Mixed</option></select></div>'+
 '<div class="field full"><label for="artist-dna">Artist DNA</label><textarea id="artist-dna" name="dna" rows="3" required placeholder="Signature instruments, arrangement, sound, lyrical topics and things to avoid"></textarea></div>'+
 '<div class="field full"><button class="primary">Create artist</button></div></form></div>'+
 '<h2>Roster <span class="small">('+state.data.artists.length+')</span></h2>'+
 (state.data.artists.length?'<div class="artist-grid">'+state.data.artists.map(a=>'<article class="artist-card"><div class="artist-avatar">'+e(a.name[0])+'</div><h3>'+e(a.name)+'</h3><div class="small">'+e(a.genre)+' · '+e(a.language)+' · '+e(a.voice)+'</div><p>'+e(a.dna)+'</p><div class="tagrow">'+a.countries.map(c=>'<span class="tag">'+e(c)+'</span>').join("")+'<span class="tag">Name unverified</span></div></article>').join("")+'</div>':'<div class="empty">No artists yet. Create one above or run npm run seed for eight proposed identities.</div>');
}
function tracks(){
 const artists=state.data.artists,tracks=state.data.tracks;
 return header("Music production","Plan songs, track approvals, and produce a Suno-ready blueprint. Generations are not sent automatically yet.")+
 '<div class="panel"><div class="panel-header"><h2>New track brief</h2></div><form id="track-form" class="fields">'+
 '<div class="field"><label for="track-artist">Artist</label><select id="track-artist" name="artistId" required><option value="">Select an artist</option>'+artists.map(a=>'<option value="'+e(a.id)+'">'+e(a.name)+'</option>').join("")+'</select></div>'+
 '<div class="field"><label for="track-title">Title</label><input id="track-title" name="title" required maxlength="140" placeholder="Working title"></div>'+
 '<div class="field"><label for="track-mode">Production type</label><select id="track-mode" name="mode"><option value="instrumental">Instrumental</option><option value="vocal">Vocal</option></select></div>'+
 '<div class="field full"><label for="track-concept">Musical concept</label><textarea id="track-concept" name="concept" required rows="2" placeholder="Sound, emotion, structure, target listener"></textarea></div>'+
 '<div class="field full"><label for="track-lyrics">Original lyrics (optional)</label><textarea id="track-lyrics" name="lyrics" rows="3"></textarea></div>'+
 '<div class="field full"><button class="primary" '+(artists.length?"":"disabled")+'>Add to pipeline</button></div></form></div>'+
 '<section class="panel"><div class="panel-header"><h2>Track pipeline</h2><span class="small">'+tracks.length+' entries</span></div>'+
 (tracks.length?'<div class="tablewrap"><table><thead><tr><th>Track</th><th>Artist</th><th>Mode</th><th>Stage</th><th>Actions</th></tr></thead><tbody>'+tracks.map(t=>{
 const a=artists.find(a=>a.id===t.artistId),next=nextStage[t.stage];
 return '<tr><td><strong>'+e(t.title)+'</strong><div class="small">'+e(t.concept.slice(0,90))+'</div></td><td>'+e(a?.name||"Unknown")+'</td><td>'+e(t.mode)+'</td><td>'+badge(t.stage)+'</td><td><div class="actions"><button class="secondary" data-action="blueprint" data-id="'+e(t.id)+'">Blueprint</button>'+(next?'<button class="primary" data-action="advance" data-id="'+e(t.id)+'" data-target="'+e(next)+'">'+e(next==="approved"?"Rights review ✓":"Move to "+capitals(next))+'</button>':"")+'</div></td></tr>';
 }).join("")+'</tbody></table></div>':'<div class="empty">No tracks yet.</div>')+'</section>';
}
function releases(){
 const list=state.data.releases,tracks=state.data.tracks,approved=tracks.filter(t=>t.stage==="approved");
 return header("Distribution","Prepare releases already created and populated at LabelGrid. Validation precedes explicit delivery approval.")+
 '<div class="warning-banner">This MVP does not upload audio or create LabelGrid releases. First prepare the release and assets in your distributor account, then enter its real release ID below. Live submissions are disabled by default.</div>'+
 '<section class="panel"><div class="panel-header"><h2>Attach distributor release</h2></div><form id="release-form" class="fields">'+
 '<div class="field"><label for="release-track">Approved track</label><select id="release-track" name="trackId" required><option value="">Select approved track</option>'+approved.map(t=>'<option value="'+e(t.id)+'">'+e(t.title)+'</option>').join("")+'</select></div>'+
 '<div class="field"><label for="external-id">Existing LabelGrid release ID</label><input id="external-id" name="externalReleaseId" required placeholder="Numeric / slug ID"></div><div class="field full"><button class="primary" '+(approved.length?"":"disabled")+'>Attach release</button></div></form></section>'+
 '<section class="panel"><div class="panel-header"><h2>Release approvals</h2><span class="small">'+list.length+' releases</span></div>'+
 (list.length?list.map(r=>{
 const t=tracks.find(t=>t.id===r.trackId);
 const checklist=r.status==="draft"?'<div class="checks">'+Object.entries(releaseChecks).map(([key,label])=>'<label><input type="checkbox" data-check="'+e(key)+'" data-release="'+e(r.id)+'" '+(r.checks[key]?"checked":"")+'>'+e(label)+'</label>').join("")+'</div>':"";
 const action=r.status==="draft"?'<button class="primary" data-action="validate" data-id="'+e(r.id)+'">Validate with LabelGrid</button>':r.status==="validated"?'<button class="primary" data-action="approve" data-id="'+e(r.id)+'">Approve release</button>':r.status==="approved"?'<button class="danger" data-action="distribute" data-id="'+e(r.id)+'">Publish to DSPs</button>':r.status==="submitted"?'<button class="secondary" data-action="delivery-status" data-id="'+e(r.id)+'">Delivery status</button>':"";
 return '<article class="panel" style="background:#17231c"><div class="panel-header"><div><strong>'+e(t?.title||r.trackId)+'</strong><div class="small">LabelGrid ID: '+e(r.externalReleaseId)+'</div></div>'+badge(r.status)+'</div>'+checklist+
 '<div class="actions">'+(r.status==="draft"?'<button class="secondary" data-action="save-checks" data-id="'+e(r.id)+'">Save checklist</button>':"")+action+'</div>'+(r.lastError?'<p class="warning-banner">'+e(r.lastError)+'</p>':"")+'</article>';
 }).join(""):'<div class="empty">No distributor releases yet. Complete a track rights review first.</div>')+'</section>';
}
function intelligence(){
 const countries=[["CH","Switzerland","High-price hypothesis"],["DK","Denmark","High-price hypothesis"],["GB","United Kingdom","High-price hypothesis"],["NL","Netherlands","High-price hypothesis"],["NO","Norway","High-price hypothesis"],["DE","Germany","Large market hypothesis"],["US","United States","Large audience hypothesis"],["AU","Australia","English-speaking hypothesis"]];
 return header("Market intelligence","A research queue, not fake live charts. Revenue decisions require licensed market and royalty datasets.")+
 '<div class="panel"><div class="panel-header"><h2>Initial market hypotheses</h2><span class="pill neutral">Not live data</span></div><div class="market-grid">'+countries.map(([code,name,reason])=>'<div class="market"><div class="eyebrow">'+e(code)+'</div><strong>'+e(name)+'</strong><span>'+e(reason)+'</span></div>').join("")+'</div></div>'+
 '<div class="panel"><h2>Proposed research workflow</h2><p class="muted">Collect sourced subscription prices, country-level royalties, playlist availability, public chart trends and marketing acquisition costs. Require timestamped source records and never infer payout from subscription price alone.</p><div class="tagrow"><span class="tag">Market evidence required</span><span class="tag">No invented trends</span><span class="tag">Rights-first</span></div></div>';
}
function compliance(){
 const {watches,integrations,summary}=state.data;
 return header("Compliance & contracts","Detect changes in approved contract sources, hold distribution, and record decisions.",'<button class="secondary" data-action="watch-check">Check official sources</button>')+
 (summary.unresolvedChanges?'<div class="warning-banner">'+e(summary.unresolvedChanges)+' unresolved document changes. Distributor publication is blocked.</div>':"")+
 '<div class="grid2"><section class="panel"><div class="panel-header"><h2>Contract watches</h2><span class="small">Opt-in background polling</span></div>'+
 (watches.records.length?watches.records.map(w=>'<div class="activity-item"><span class="activity-dot"></span><div style="min-width:0;overflow-wrap:anywhere"><strong>'+e(w.url)+'</strong><div class="small">'+e(w.state)+' · '+e(niceDate(w.checked_at))+'</div>'+(w.state==="changed"?'<button class="secondary" data-action="ack-watch" data-id="'+e(w.id)+'">Mark reviewed</button>':"")+'</div></div>').join(""):'<div class="empty">No snapshots yet. Run a first check to establish a baseline.</div>')+
 '<p class="hint">An HTML change indicates a document needs human review. It is not an automated legal interpretation.</p></section>'+
 '<section class="panel"><h2>Integration settings</h2><div class="stack"><div><div class="metric-label">Suno generation</div><strong>'+e(integrations.suno)+'</strong></div><div><div class="metric-label">LabelGrid token</div><strong>'+e(integrations.labelgrid)+'</strong></div><div><div class="metric-label">Live distribution</div><strong>'+e(integrations.liveDistributionEnabled?"Enabled":"Disabled")+'</strong></div><div><div class="metric-label">Automatic legal monitoring</div><strong>'+e(integrations.monitorEnabled?"Enabled while running":"Disabled")+'</strong></div></div><p class="hint">Credentials and irreversible release settings are configured server-side through environment variables only.</p></section></div>';
}
function genres(){
 const items=Object.entries(state.data.genres);
 return header("Music genres","Explore an editorial catalogue of styles, including extensive Country & Americana subgenres. Any style may also be typed into an artist profile.")+
 '<div class="market-grid" style="margin-bottom:18px">'+items.map(([category,subgenres])=>'<section class="panel" style="margin:0"><div class="eyebrow">'+e(category)+'</div><div class="tagrow">'+subgenres.map(g=>'<span class="tag">'+e(g)+'</span>').join("")+'</div><div class="hint">'+subgenres.length+' subgenres</div></section>').join("")+'</div>'+
 '<div class="panel"><h2>Genre strategy</h2><p class="muted">Choose a primary genre for each artist, then define the actual arrangement, vocal style and production in Artist DNA. Genre names are editorial categories, not real-time market-performance claims.</p><button data-tab="artists" class="primary">Create an artist →</button></div>';
}
function connections(){
 const c=state.data.connections||{};
 return header("Account connections","Link Suno and Spotify securely without sharing website passwords with Blossom.")+
 (!c.vaultReady?'<div class="warning-banner">The encrypted vault is locked. Set BLOSSOM_VAULT_KEY on the server before saving credentials or connecting Spotify.</div>':"")+
 '<div class="grid2"><section class="panel"><div class="panel-header"><h2>Suno</h2>'+badge(c.suno_api_key?.configured?"configured":"not connected")+'</div>'+
 '<p class="hint">Store your Suno account email and, if Suno has granted API access, its official API key. The key is AES-256-GCM encrypted. Your account password is not requested or stored. Generation remains manual until API capabilities are verified.</p>'+
 '<form id="suno-connection-form" class="stack"><div class="field"><label for="suno-email">Account email</label><input id="suno-email" type="email" name="email" autocomplete="email" value="'+e(c.sunoEmail||"")+'" placeholder="you@example.com"></div>'+
 '<div class="field"><label for="suno-token">Suno API key (optional)</label><input id="suno-token" type="password" name="apiKey" autocomplete="off" placeholder="'+(c.suno_api_key?.configured?"Saved key is hidden · enter to replace":"Paste official Suno Platform API key")+'"></div>'+
 '<div class="actions"><button class="primary" '+(!c.vaultReady?"disabled":"")+' type="submit">Save Suno connection</button>'+(c.suno_api_key?.configured?'<button type="button" data-action="remove-suno" class="danger">Remove key</button>':"")+'</div></form>'+
 '<p class="small">Official developer portal: <a href="https://platform.suno.com" target="_blank" rel="noopener noreferrer">platform.suno.com</a></p></section>'+
 '<section class="panel"><div class="panel-header"><h2>Spotify</h2>'+badge(c.spotify_refresh_token?.configured?"connected":"not connected")+'</div>'+
 '<p class="hint">Register a Spotify Web API app, save its Client ID, then authorize via Spotify. Blossom receives an encrypted refresh token. Your Spotify password stays with Spotify. This connection supports account data, not direct audio distribution.</p>'+
 '<form id="spotify-connection-form" class="stack"><div class="field"><label for="spotify-client-id">Spotify developer Client ID</label><input id="spotify-client-id" type="text" name="clientId" spellcheck="false" autocomplete="off" value="'+e(c.spotifyClientId||"")+'" placeholder="32-character developer Client ID" maxlength="32"></div>'+
 '<button type="submit" class="secondary">Save Client ID</button></form>'+
 '<div class="actions" style="margin-top:14px"><a class="primary" style="text-decoration:none" href="/auth/spotify/start">Connect with Spotify ↗</a>'+(c.spotify_refresh_token?.configured?'<button data-action="remove-spotify" class="danger">Disconnect Spotify</button>':"")+'</div>'+
 (c.spotify_refresh_token?.configured?'<p class="small">Authorized account: '+e(c.spotify_refresh_token.label)+'</p><button data-action="verify-spotify" class="secondary" type="button">Verify Spotify connection</button><p class="hint">Spotify requires reauthorization after six months.</p>':"")+
 '<p class="small">Set the Spotify developer redirect URL exactly to <code>'+e(location.origin)+'/auth/spotify/callback</code></p></section></div>'+
 '<div class="panel"><h2>Connection security</h2><p class="muted">Secrets are encrypted at rest. Blossom never returns a saved API key or OAuth refresh token to the browser. Your credentials remain tied to this local server and its separately stored encryption key. Back up both safely; losing the key makes the secrets unrecoverable.</p></div>';
}

function render(){
 nav.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===state.tab));
 document.querySelector("#crumb").textContent=state.tab.toUpperCase();
 view.innerHTML=({overview,artists,tracks,releases,intelligence,compliance,genres,connections})[state.tab]();
}
async function action(el){
 const act=el.dataset.action,id=el.dataset.id,update=async(p,d)=>{await api(p,d);await refresh()};
 if(act==="verify-spotify"){const p=await api("connections/spotify/profile");message("Spotify connection verified: "+p.displayName);return;}
 if(act==="logout"){await fetch("/auth/logout",{method:"POST",headers:{"Content-Type":"application/json","X-Blossom-Request":"ui"},body:"{}"});window.location.assign("/login");return;}
 if(act==="remove-suno"||act==="remove-spotify"){if(confirm("Remove stored authorization for this service?")){await update("connections/"+(act==="remove-suno"?"suno":"spotify")+"/remove",{});message("Saved authorization removed");}return;}
 if(act==="close-dialog"){document.querySelector("#recipe-dialog").close();return}
 if(act==="copy-recipe"){const field=document.querySelector("#recipe-text");try{await navigator.clipboard.writeText(field.value);message("Blueprint copied")}catch{field.select();message("Select and copy the highlighted text")}return}
 if(act==="blueprint"){
  const blueprint=await api("tracks/"+id+"/blueprint");
  document.querySelector("#recipe-text").value=JSON.stringify(blueprint,null,2);
  document.querySelector("#recipe-dialog").showModal();return;
 }
 if(act==="advance"){
  const target=el.dataset.target;
  if(target==="approved"){
    const audioRef=prompt("Enter the HTTPS reference for the final, original audio master:");
    if(!audioRef)return;
    if(!confirm("Confirm you have verified commercial rights, source provenance, originality, human review and AI disclosures for this exact track."))return;
    await update("tracks/"+id+"/advance",{target,rights:{commercialRights:true,provenanceRecorded:true,humanReviewed:true,originalityReviewed:true,disclosureReviewed:true},audioRef});
  } else await update("tracks/"+id+"/advance",{target});
  message("Track updated");return;
 }
 if(act==="save-checks"){
  const checks=Object.fromEntries(Object.keys(releaseChecks).map(k=>[k,!!document.querySelector('input[data-check="'+k+'"][data-release="'+id+'"]')?.checked]));
  await update("releases/"+id+"/checks",checks);message("Checklist saved");return;
 }
 if(["validate","approve","distribute"].includes(act)){
  if(act==="distribute"&&!confirm("This will submit the approved release to your real distributor, possibly publishing on Spotify and other DSPs. Proceed?"))return;
  await update("releases/"+id+"/"+act,act==="distribute"?{confirmation:"PUBLISH"}:{});
  message(act==="distribute"?"Distributor submission sent":capitals(act)+" complete");return;
 }
 if(act==="delivery-status"){const data=await api("releases/"+id+"/delivery-status");alert(JSON.stringify(data,null,2));return;}
 if(act==="watch-check"){const r=await api("watches/check",{});message("Checked "+r.length+" sources. Review holds and failures.");await refresh();return;}
 if(act==="ack-watch"){
   if(!confirm("Have you independently reviewed this changed document and assessed its business impact?"))return;
   await update("watches/"+id+"/ack",{});message("Review acknowledged");return;
 }
}
document.addEventListener("click",async event=>{
 const tab=event.target.closest("[data-tab]");
 if(tab){state.tab=tab.dataset.tab;render();return;}
 const btn=event.target.closest("[data-action]");
 if(btn){btn.disabled=true;try{await action(btn)}catch(error){message(error.message,true)}finally{btn.disabled=false}}
});
document.addEventListener("submit",async event=>{
 if(!["artist-form","track-form","release-form","suno-connection-form","spotify-connection-form"].includes(event.target.id))return;
 event.preventDefault();const button=event.target.querySelector("button[type=submit],button:not([type])");
 if(button)button.disabled=true;
 try{
  const data=Object.fromEntries(new FormData(event.target).entries());
  if(event.target.id==="artist-form"){
   data.countries=data.countries.split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
   await api("artists",data);
  } else if(event.target.id==="track-form") await api("tracks",data);
  else if(event.target.id==="suno-connection-form"){await api("connections/suno",data);event.target.elements.apiKey.value="";}
  else if(event.target.id==="spotify-connection-form")await api("connections/spotify",data);
  else await api("releases",data);
  message("Saved");await refresh();
 }catch(error){message(error.message,true)}
 finally{if(button)button.disabled=false}
});
if(new URLSearchParams(location.search).get("spotify")==="connected"){
 state.tab="connections";history.replaceState(null,"","/");}
refresh().catch(error=>{view.innerHTML='<div class="warning-banner">Could not load Blossom: '+e(error.message)+'. Check the server and credentials.</div>'});
