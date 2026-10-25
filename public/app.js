import { musicDnaView, musicDnaAction, musicDnaCreate, musicDnaUpload, musicDnaRequest, musicDnaChrome, bindMusicDna, paintDnaActivity, musicDnaJobsChanged, reloadMusicDna } from "./music-dna.js";
import { pageFromHash, routeFromClick } from "./route.js";
import { discographyView,discographyRefresh,discographyAction,bindDiscography } from "./discography.js";
import { studioView,studioAction,studioInput,studioAudio,studioActiveId,studioSelectedId,studioConfigurePersistence,studioAutoSave,studioFlush,studioResumePersistence,studioPaste,pasteStartsLyrics } from "./studio.js?v=studio-partial-v1";
import { focusFromDrag,objectPosition,savedFocus,applyPhotoFocus } from "./artist-focus.js";
const e = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const view=document.querySelector("#view"),nav=document.querySelector("#nav"),toast=document.querySelector("#toast");
const state={tab:pageFromHash(location.hash),data:{summary:{},artists:[],tracks:[],releases:[],events:[],watches:{records:[]},integrations:{},connections:{},browserAccounts:{},genres:{},studioProjects:[],studioStatus:{},studioPresets:{},studioArtistPresets:{},artistBanners:{},artistImages:{},studioAssets:[],studioReferences:[],musicDnaProfiles:[],musicDnaJobs:[]}};
const nextStage={idea:"brief",brief:"generated",generated:"review",review:"approved",rejected:"brief"};
const releaseChecks={audioUploaded:"Audio at distributor",artworkUploaded:"Cover art at distributor",creditsVerified:"Credits verified",codesVerified:"ISRC/UPC verified",aiDisclosuresDone:"AI disclosure completed",distributorRightsConfirmed:"Rights and distribution terms verified"};
const capitals=s=>s.replaceAll("_"," ").replace(/\b\w/g,x=>x.toUpperCase());
const niceDate=d=>d?new Date(d).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
function message(text,error=false){
  toast.textContent=text;toast.className=error?"error":"";toast.style.display="block";
  clearTimeout(message.timer);message.timer=setTimeout(()=>toast.style.display="none",4500);
}
async function api(path,data,options={}){
  const opts={headers:{Accept:"application/json"}};
  if(data!==undefined){opts.method=options.method||"POST";opts.headers["Content-Type"]="application/json";opts.headers["X-Blossom-Request"]="ui";opts.body=JSON.stringify(data);}
  const res=await fetch("/api/"+path,opts);
  const body=await res.json().catch(()=>({error:"Unexpected server response"}));
  if(res.status===401){window.location.assign("/login");throw Error("Session expired");}
  if(!res.ok){
    const error=Error(body.error||"Request failed");
    error.code=body.code||"";
    error.status=res.status;
    throw error;
  }
  return body;
}
async function refresh(){
  await studioFlush();
  const dnaRequest=musicDnaRequest(state);
  const names=["summary","artists","tracks","releases","events","watches","integrations","connections","browser-accounts","genres","studio/projects","studio/status","studio/presets","studio/artists/presets","studio/artists/banners","studio/artists/images"];
  const results=await Promise.all(names.map(apiName=>api(apiName==="studio/projects"?"studio/projects/page?limit=150"+(state.projectQuery?"&q="+encodeURIComponent(state.projectQuery):""):apiName)));
  const page=results[names.indexOf("studio/projects")];results[names.indexOf("studio/projects")]=page.results;
  state.data=Object.fromEntries(names.map((name,i)=>[name.replaceAll("/","").replace("studioprojects","studioProjects").replace("studiostatus","studioStatus").replace("studiopresets","studioPresets").replace("studioartistspresets","studioArtistPresets").replace("studioartistsbanners","artistBanners").replace("studioartistsimages","artistImages").replace("browser-accounts","browserAccounts"),results[i]]));
  state.data.studioProjectPage={total:page.total,nextCursor:page.nextCursor};
  const selected=studioSelectedId();
  if(selected&&!state.data.studioProjects.some(p=>p.id===selected))state.data.studioProjects.push(await api("studio/projects/"+selected));
  const id=studioActiveId(state);
  const [assets,dnaPage,dnaJobs,dnaReferences]=await Promise.all([
    id?api("studio/projects/"+id+"/assets"):Promise.resolve([]),
    api(dnaRequest.path),api("music-dna/jobs"),
    id?api("studio/projects/"+id+"/references"):Promise.resolve({references:[]})
  ]);
  state.data.studioAssets=assets;
  state.data.musicDnaProfiles=dnaPage.results||[];
  state.data.musicDnaTotal=Number.isInteger(dnaPage.total)?dnaPage.total:state.data.musicDnaProfiles.length;
  state.data.musicDnaOffset=dnaRequest.offset;
  state.data.musicDnaJobs=dnaJobs.jobs;
  state.data.musicDnaJobCounts=dnaJobs.counts||null;
  state.data.studioReferences=dnaReferences.references;
  if(state.tab==="music-dna") await loadOpenJobs(false);
  await discographyRefresh(state,api);
  render();studioResumePersistence();
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
 const catalog=discographyView(state);if(catalog)return catalog;
 const createDialog='<dialog id="artist-create-dialog" aria-labelledby="artist-create-title">'+
  '<div class="dialog-header"><strong id="artist-create-title">Create artist</strong><button type="button" class="icon-button" data-action="artist-create-close" aria-label="Close">×</button></div>'+
  '<p class="small">Define the artist identity before adding tracks.</p><form id="artist-form" class="fields">'+
 '<div class="field"><label for="artist-name">Artist name</label><input id="artist-name" name="name" required maxlength="80" placeholder="e.g. Mira Solenne"></div>'+
 '<div class="field"><label for="artist-genre">Primary genre</label><input list="genre-options" id="artist-genre" name="genre" required maxlength="100" placeholder="Select or type, e.g. Country Pop"><datalist id="genre-options">'+Object.values(state.data.genres).flat().map(g=>'<option value="'+e(g)+'"></option>').join("")+'</datalist></div>'+
  '<div class="field"><label for="artist-language">Language</label><input id="artist-language" name="language" value="en" required placeholder="en"></div>'+
  '<div class="field"><label for="artist-countries">Target countries (ISO codes)</label><input id="artist-countries" name="countries" placeholder="GB, US, NL"></div>'+
  '<div class="field"><label for="artist-voice">Voice</label><select id="artist-voice" name="voice"><option value="instrumental">Instrumental</option><option value="female">Female</option><option value="male">Male</option><option value="mixed">Mixed</option></select></div>'+
  '<div class="field full"><label for="artist-dna">Artist DNA</label><textarea id="artist-dna" name="dna" rows="4" required placeholder="Signature instruments, arrangement, sound, lyrical topics and things to avoid"></textarea></div>'+
  '<div class="field full actions"><button class="primary">Create artist</button><button type="button" class="secondary" data-action="artist-create-close">Cancel</button></div></form></dialog>';
 const photosDialog='<dialog id="artist-photos-dialog" aria-labelledby="artist-photos-title"><div class="dialog-header"><strong id="artist-photos-title">Artist photos</strong><button type="button" class="icon-button" data-action="artist-photos-close" aria-label="Close">×</button></div><div id="artist-photos-body"></div></dialog>';
 const focusDialog='<dialog id="artist-focus-dialog" aria-labelledby="artist-focus-title"><div class="dialog-header"><strong id="artist-focus-title">Set header focus</strong><button type="button" class="icon-button" data-action="artist-focus-cancel" aria-label="Close">×</button></div><p class="small">Drag the image to keep faces and the subject inside the wide artist header.</p><div class="artist-focus-frame"><img alt="Artist header crop preview" draggable="false"></div><div class="actions artist-focus-actions"><button type="button" class="secondary" data-action="artist-focus-auto">Use automatic crop</button><button type="button" class="primary" data-action="artist-focus-save">Save focus</button><button type="button" class="secondary" data-action="artist-focus-cancel">Cancel</button></div></dialog>';
 const roster=state.data.artists.length?'<div class="artist-grid artist-banner-grid">'+state.data.artists.map(a=>{
   const banner=state.data.artistBanners?.[a.id];
   const focus=savedFocus(banner);
   const searchable=[a.name,a.genre,a.language,a.dna,...(a.countries||[])].join(" ").toLowerCase();
   return '<article class="artist-card artist-banner-card" data-artist-id="'+e(a.id)+'" data-search="'+e(searchable)+'">'+
     '<div class="artist-hero">'+
       (banner?'<img class="artist-hero-image" src="'+e(banner.url)+'" alt="Artist banner for '+e(a.name)+'" data-photo-focus data-focus-x="'+focus.focusX+'" data-focus-y="'+focus.focusY+'" loading="lazy">':
        '<div class="artist-hero-placeholder" aria-hidden="true">'+e(a.name.slice(0,1))+'</div>')+
       '<div class="artist-hero-shade" aria-hidden="true"></div>'+
       '<div class="artist-hero-content"><h3>'+e(a.name)+'</h3><span class="artist-hero-genre">'+e(a.genre)+'</span></div>'+
     '</div><p class="artist-tile-dna" title="'+e(a.dna)+'">'+e(a.dna)+'</p>'+
     '<div class="artist-tile-actions">'+
       '<button type="button" class="primary" data-action="catalog-artist-open" data-artist-id="'+e(a.id)+'">Open discography</button>'+
       '<button type="button" class="secondary" data-action="artist-image-generate" data-artist-id="'+e(a.id)+'">Generate banner</button>'+
       '<button type="button" class="secondary" data-action="artist-photos-open" data-artist-id="'+e(a.id)+'" aria-haspopup="dialog">Manage photos</button>'+
     '</div></article>';
 }).join("")+'</div>':'<div class="empty">No artists yet. Create your first artist to start the roster.</div>';
 return header("Artists","Every artist has separate creative DNA, a style, language and target territories.",'<button type="button" class="primary" data-action="artist-create-open" aria-haspopup="dialog">＋ New artist</button>')+
 createDialog+photosDialog+focusDialog+'<div class="artist-roster-heading"><h2>Roster <span class="small">('+state.data.artists.length+')</span></h2><input id="artist-search" type="search" aria-label="Search artists" placeholder="Search artists" autocomplete="off"></div>'+roster+'<p id="artist-search-empty" class="empty" hidden>No artists match your search.</p>';
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
 return '<tr><td><strong>'+e(t.title)+'</strong><div class="small">'+e(t.concept.slice(0,90))+'</div></td><td>'+e(a?.name||"Unknown")+'</td><td>'+e(t.mode)+'</td><td>'+badge(t.stage)+'</td><td><div class="actions"><button class="secondary" data-action="blueprint" data-id="'+e(t.id)+'">Blueprint</button><button type="button" class="secondary" data-action="catalog-add-track" data-id="'+e(t.id)+'">Add to album</button>'+(next?'<button class="primary" data-action="advance" data-id="'+e(t.id)+'" data-target="'+e(next)+'">'+e(next==="approved"?"Rights review ✓":"Move to "+capitals(next))+'</button>':"")+'</div></td></tr>';
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
function browserAccountCard({ provider, title, login, usage, hint }) {
 const session = state.data.browserAccounts?.[provider] || {};
 const handoff=session.handoff||{state:"not_started"};
 const stateLabel=handoff.state==="user_confirmed"?"Door jou bevestigd":
   handoff.state==="awaiting_confirmation"?"Wacht op bevestiging":
   handoff.state==="not_confirmed"?"Niet bevestigd":"Niet gekoppeld";
 const nativeSafari = state.data.browserAccounts?.nativeSafariAvailable &&
   ["localhost","127.0.0.1"].includes(location.hostname);
 const webdriver = navigator.webdriver===true;
 return '<section class="panel browser-account-card"><div class="panel-header"><h2>'+e(title)+'</h2>'+
   badge(stateLabel)+'</div>'+
   '<p class="browser-account-identity">'+e(login)+'</p>'+
   '<p class="hint">'+e(usage)+'</p>'+
   '<div class="browser-account-actions">'+
   (nativeSafari?'<button type="button" class="primary" data-action="browser-safari" data-provider="'+e(provider)+'">'+
      (provider==="spotify"?(handoff.state==="user_confirmed"?"Open Spotify in Safari ↗":"Inloggen via Spotify / Facebook ↗"):"Open in Safari (Mac) ↗")+'</button>':"")+
   (provider==="spotify"&&handoff.state==="user_confirmed"&&nativeSafari?
      '<button type="button" class="secondary" data-action="browser-spotify-login">Opnieuw aanmelden via Facebook</button>':"")+
   (!webdriver?'<button type="button" class="'+(nativeSafari?"secondary":"primary")+'" data-action="browser-connect" data-provider="'+e(provider)+'">'+
      (provider==="spotify"?(handoff.state==="user_confirmed"?"Spotify Web Player ↗":"Spotify-login in browser ↗"):"Open in this browser ↗")+'</button>':
      '<span class="small browser-blocked">Automated Chrome detected; use Safari or copy the site address into your normal browser.</span>')+
   '</div>'+
   (handoff.state==="awaiting_confirmation"?
      '<div class="browser-account-confirm" role="group" aria-label="Aanmelding bevestigen"><p class="small">Terug uit de browser? Geef aan of inloggen gelukt is.</p>'+
        '<button type="button" class="primary" data-action="browser-confirm" data-provider="'+e(provider)+'">Ik ben ingelogd</button>'+
        '<button type="button" class="secondary" data-action="browser-not-confirmed" data-provider="'+e(provider)+'">Nog niet gelukt</button></div>':
    handoff.state==="user_confirmed"?
      '<div class="browser-account-confirm"><p class="small">Handmatig bevestigd'+
      (handoff.confirmedAt?" · "+e(niceDate(handoff.confirmedAt)):"")+
      '. Dit is geen controle bij '+e(title)+'.</p>'+
      '<button type="button" class="secondary" data-action="browser-not-confirmed" data-provider="'+e(provider)+'">Bevestiging intrekken</button></div>':"")+
   '<p class="small">'+e(hint)+'</p></section>';
}
function connections(){
 const c=state.data.connections||{};
 const hasSpotifyApp=!!c.spotifyClientId;
 return '<div class="browser-connections-layout">'+
 header("Account connections","Sign in through your regular browser. Existing cookies and sessions are managed by that browser, not by Playwright.")+
 (navigator.webdriver===true?'<div class="browser-browser-warning" role="alert"><strong>Automated browser detected</strong><span>This Blossom window is being controlled by automation. Google can refuse sign-in here. Open Suno in Safari on this Mac, or reopen Blossom in a normal browser.</span></div>':"")+
 '<div class="browser-accounts-grid">'+
 browserAccountCard({provider:"suno",title:"Suno · Google",login:"Continue with Google",
   usage:"Open Suno in your ordinary browser and sign in with Google. Your existing browser session can be reused.",
   hint:"Copy your Suno blueprint from News to Song. Google sign-in cannot run inside Playwright, and website login does not grant Blossom API access."})+
 browserAccountCard({provider:"spotify",title:"Spotify · Facebook",login:"Continue with Facebook",
   usage:"Meld je aan via de officiële Spotify-pagina. Kies Verdergaan met Facebook als je bestaande account dat ondersteunt.",
   hint:"Na je bevestiging opent Spotify voortaan de Web Player met dezelfde Safari-sessie. Geen Client ID nodig voor websitegebruik. Spotify Web API blijft apart."})+
 browserAccountCard({provider:"chatgpt",title:"ChatGPT · OpenAI",login:"Sign in to ChatGPT",
   usage:"Open ChatGPT in your regular browser. If already signed in, that browser may reuse your session.",
   hint:"A ChatGPT session is not an OpenAI API key for automatic lyrics generation."})+
 '</div>'+
 '<details class="panel browser-advanced"><summary><strong>Blossom MCP-koppeling met ChatGPT controleren</strong><span class="small">OAuth-diagnose</span></summary>'+
 '<div><p class="small">Een goedgekeurde OAuth-aanvraag betekent nog niet dat de plugin in ChatGPT is aangemaakt. Rond daar de toolscan en Create as a plugin af.</p>'+
 '<button type="button" class="secondary" data-action="oauth-diagnose">Controleer laatste verbindingsstap</button>'+
 '<p class="small" id="oauth-diagnostic-result" role="status">Geen diagnose uitgevoerd.</p></div></details>'+
 '<details class="panel browser-advanced"><summary><strong>Advanced · API integrations and developer credentials</strong><span class="small">Only needed for direct API features</span></summary>'+
 '<div class="browser-advanced-grid">'+
 '<section><h3>Suno developer API (optional)</h3><p class="hint">Open Suno · Continue with Google at <a href="https://suno.com/" target="_blank" rel="noopener noreferrer">suno.com</a>. The Suno Platform is separate; no platform account is required for browser use.</p>'+
 '<form id="suno-connection-form" class="stack"><div class="field"><label for="suno-email">Account email (optional label)</label><input id="suno-email" type="email" name="email" autocomplete="email" value="'+e(c.sunoEmail||"")+'"></div>'+
 '<div class="field"><label for="suno-token">Official Suno API key, if provided</label><input id="suno-token" type="password" name="apiKey" autocomplete="off" placeholder="Do not paste a Google token or browser cookie"></div>'+
 '<button type="submit" class="secondary" '+(!c.vaultReady?"disabled":"")+'>Save API credentials</button>'+
 (c.suno_api_key?.configured?'<button type="button" class="danger" data-action="remove-suno">Remove Suno API key</button>':"")+
 '</form></section>'+
 '<section><h3>Spotify Web API (optional)</h3><p class="hint">Official OAuth requires a Spotify developer app Client ID. To browse Spotify with Facebook, use the browser sign-in above.</p>'+
 '<form id="spotify-connection-form" class="stack"><div class="field"><label for="spotify-client-id">Spotify developer Client ID</label><input id="spotify-client-id" type="text" name="clientId" value="'+e(c.spotifyClientId||"")+'" maxlength="32" placeholder="Only for Spotify Web API"></div>'+
 '<button type="submit" class="secondary">Save Client ID</button></form>'+
 (hasSpotifyApp?'<a class="secondary" href="/auth/spotify/start?choose=1">Connect Spotify · Choose Facebook (API authorization) ↗</a>':"")+
 (c.spotify_refresh_token?.configured?'<p class="small">OAuth authorized: '+e(c.spotify_refresh_token.label)+'</p><button type="button" class="secondary" data-action="verify-spotify">Verify Spotify API</button><button type="button" class="danger" data-action="remove-spotify">Revoke stored Spotify token</button>':"")+
 '<p class="small">Spotify Redirect URI: <code>'+e(c.spotifyRedirectUri||location.origin+"/auth/spotify/callback")+'</code>. Register this exact HTTPS URI in the Spotify Developer Dashboard.</p></section>'+
 '<section><h3>OpenAI API (optional)</h3><p class="hint">Your ChatGPT subscription and cookies do not authorize automated OpenAI API calls. API access needs its own key and billing.</p>'+
 '<form id="openai-connection-form" class="stack"><div class="field"><label for="openai-key">OpenAI API key</label><input id="openai-key" name="apiKey" type="password" autocomplete="off" placeholder="Only for automatic Blossom AI generation" required></div>'+
 '<button class="secondary" type="submit" '+(!c.vaultReady?"disabled":"")+'>Save encrypted key</button></form>'+
 (c.openai_api_key?.configured?'<button class="danger" type="button" data-action="remove-openai">Remove API key</button>':"")+
 '</section></div>'+
 '</details>'+
 '<p class="browser-security-note">These links use your ordinary browser, with its existing cookies. Blossom does not copy session tokens, read passwords, bypass Google security checks or claim a website login is API authorization.</p>'+
 '</div>';
}
function showBrowserLogin(provider) {
 const details={
   suno: {title:"Suno",instruction:"Suno opens in your regular browser. Sign in with Google there, or continue your existing session. Google blocks automated Playwright sign-in."},
   spotify:{title:"Spotify",instruction:"Spotify opent in Safari. Kies Verdergaan met Facebook als die inlogmethode nog actief is. Daarna kun je de Web Player gebruiken met dezelfde browsersessie."},
   chatgpt:{title:"ChatGPT",instruction:"ChatGPT opens in your regular browser and can reuse its existing login. Website login is not OpenAI API access."}
 };
 const selected=details[provider];
 if(!selected)throw Error("Unsupported browser provider");
 const dialog=document.querySelector("#account-login-dialog");
 dialog.dataset.provider=provider;
 document.querySelector("#account-login-title").textContent="Connect "+selected.title;
 document.querySelector("#account-login-instructions").textContent=selected.instruction;
 document.querySelector("#account-login-status").textContent="Opening your regular browser...";
 dialog.showModal();
}

function render(){
 document.body.dataset.view=state.tab;
 nav.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===state.tab));
 document.querySelector("#crumb").textContent=state.tab.toUpperCase();
 view.innerHTML=({studio:()=>studioView(state),"music-dna":()=>musicDnaView(state),overview,artists,tracks,releases,intelligence,compliance,genres,connections})[state.tab]();
 applyPhotoFocus(view);
 musicDnaChrome(state);
 watchOpenJobs();
}
function showStudioReport(title,text){
 document.getElementById("studio-report-title").textContent=title;
 document.getElementById("studio-report-text").value=text;
 document.getElementById("studio-report-dialog").showModal();
}
function openArtistPhotos(artistId){
 const artist=state.data.artists.find(item=>item.id===artistId);
 if(!artist)return;
 const images=state.data.artistImages?.[artistId]||[];
 const body=document.getElementById("artist-photos-body"),dialog=document.getElementById("artist-photos-dialog");
 if(!body||!dialog)return;
 document.getElementById("artist-photos-title").textContent="Photos — "+artist.name;
 body.innerHTML='<p class="small">Generate and choose a wide photo for '+e(artist.name)+'.</p>'+
  '<div class="artist-photo-generate"><button class="primary" type="button" data-action="artist-image-generate" data-artist-id="'+e(artistId)+'">✦ Generate artist banner</button><label class="artist-photo-prompt-label" for="artist-photo-prompt-'+e(artistId)+'">Custom photo prompt <span class="small">(optional)</span></label><textarea id="artist-photo-prompt-'+e(artistId)+'" rows="2" placeholder="Describe the location, clothing, light and artistic direction"></textarea></div>'+
  (images.length?'<div class="artist-media-library"><div class="artist-media-heading"><strong>Artist photos</strong><span>'+images.length+' images · choose the background</span></div><div class="artist-media-list">'+images.map(image=>{
    const focus=savedFocus(image);
    return '<div class="artist-image-option-wrap"><button type="button" class="artist-media-option'+(image.selected?' is-active':'')+'"'+
    ' data-action="artist-image-select" data-artist-id="'+e(artistId)+'" data-image-id="'+e(image.id)+'"'+
    ' title="'+e(image.selected?'Active artist background':'Use as artist background')+'" aria-pressed="'+(image.selected?'true':'false')+'" '+(image.selected?'disabled':'')+'>'+
    '<img src="'+e(image.url)+'" alt="Artist background option for '+e(artist.name)+'" data-photo-focus data-focus-x="'+focus.focusX+'" data-focus-y="'+focus.focusY+'" loading="lazy"><span>'+e(image.selected?'Current background':'Use background')+'</span></button>'+
    '<div class="artist-photo-option-actions"><button type="button" class="secondary mini" data-action="artist-focus-open" data-artist-id="'+e(artistId)+'" data-image-id="'+e(image.id)+'" data-image-url="'+e(image.url)+'" data-focus-x="'+focus.focusX+'" data-focus-y="'+focus.focusY+'" data-focus-source="'+e(image.focusSource||'auto')+'">Set focus point</button>'+
    '<button type="button" class="secondary mini artist-image-remove" data-action="artist-image-delete" data-artist-id="'+e(artistId)+'" data-image-id="'+e(image.id)+'" aria-label="Remove photo from '+e(artist.name)+'">Remove</button></div><span class="artist-focus-state">'+(image.focusSource==='manual'?'Manually adjusted':'Automatic safe crop')+' · '+focus.focusX+'% / '+focus.focusY+'%</span></div>';
   }).join("")+'</div></div>':
    '<p class="artist-banner-hint">No photos yet. Generate one here or create an artist photo in News to Song with this artist selected.</p>');
 applyPhotoFocus(body);
 dialog.showModal();
 dialog.querySelector('[data-action="artist-photos-close"]')?.focus();
}
function bindArtistFocusDrag(dialog){
 const frame=dialog.querySelector(".artist-focus-frame"),img=frame?.querySelector("img");
 if(!frame||!img||frame.dataset.dragBound)return;
 frame.dataset.dragBound="1";
 let drag=null;
 const geometry=()=>({containerWidth:frame.clientWidth,containerHeight:frame.clientHeight,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight});
 frame.addEventListener("pointerdown",event=>{
  if(event.button!==undefined&&event.button!==0)return;
  if(!img.naturalWidth)return;
  event.preventDefault();
  drag={x:event.clientX,y:event.clientY,focusX:Number(dialog.dataset.focusX),focusY:Number(dialog.dataset.focusY),pointerId:event.pointerId};
  frame.classList.add("is-dragging");
  try{frame.setPointerCapture(event.pointerId)}catch{/* pointer capture may already be gone */}
 });
 frame.addEventListener("pointermove",event=>{
  if(!drag||event.pointerId!==drag.pointerId)return;
  event.preventDefault();
  const next=focusFromDrag({...geometry(),focusX:drag.focusX,focusY:drag.focusY,dx:event.clientX-drag.x,dy:event.clientY-drag.y,round:false});
  img.style.objectPosition=objectPosition(next.focusX,next.focusY);
 });
 const finish=event=>{
  if(!drag||event.pointerId!==drag.pointerId)return;
  if(event.type==="pointerup"){
   const next=focusFromDrag({...geometry(),focusX:drag.focusX,focusY:drag.focusY,dx:event.clientX-drag.x,dy:event.clientY-drag.y});
   dialog.dataset.focusX=String(next.focusX);dialog.dataset.focusY=String(next.focusY);dialog.dataset.focusSource="manual";
   img.style.objectPosition=objectPosition(next.focusX,next.focusY);
  }else img.style.objectPosition=objectPosition(drag.focusX,drag.focusY);
  frame.classList.remove("is-dragging");drag=null;
 };
 frame.addEventListener("pointerup",finish);frame.addEventListener("pointercancel",finish);
}
function openArtistFocus(button){
 const dialog=document.getElementById("artist-focus-dialog");
 if(!dialog)return;
 const focus=savedFocus({focusX:Number(button.dataset.focusX),focusY:Number(button.dataset.focusY)});
 dialog.dataset.artistId=button.dataset.artistId;dialog.dataset.imageId=button.dataset.imageId;
 dialog.dataset.focusX=String(focus.focusX);dialog.dataset.focusY=String(focus.focusY);
 dialog.dataset.focusSource=button.dataset.focusSource||"auto";
 const img=dialog.querySelector(".artist-focus-frame img");
 img.style.objectPosition=objectPosition(focus.focusX,focus.focusY);img.src=button.dataset.imageUrl;
 dialog.showModal();bindArtistFocusDrag(dialog);
 dialog.querySelector('[data-action="artist-focus-cancel"]')?.focus();
}
async function action(el){
 const act=el.dataset.action,id=el.dataset.id,update=async(p,d)=>{await api(p,d);await refresh()};
 if(act?.startsWith('catalog-')){await studioFlush();return discographyAction(el,state,api,refresh,message,render);}
 if(act==="artist-create-open"){
   const dialog=document.getElementById("artist-create-dialog");
   document.getElementById("artist-form")?.reset();
   dialog?.showModal();
   dialog?.querySelector("input")?.focus();
   return;
 }
 if(act==="artist-create-close"){document.getElementById("artist-create-dialog")?.close();return;}
 if(act==="artist-photos-open"){openArtistPhotos(el.dataset.artistId);return;}
 if(act==="artist-photos-close"){document.getElementById("artist-photos-dialog")?.close();return;}
 if(act==="artist-focus-open"){openArtistFocus(el);return;}
 if(act==="artist-focus-cancel"){document.getElementById("artist-focus-dialog")?.close();return;}
 if(act==="artist-focus-auto"){
  const dialog=document.getElementById("artist-focus-dialog"),img=dialog?.querySelector(".artist-focus-frame img");
  if(dialog){dialog.dataset.focusX="50";dialog.dataset.focusY="0";dialog.dataset.focusSource="auto";if(img)img.style.objectPosition=objectPosition(50,0);}
  return;
 }
 if(act==="artist-focus-save"){
  const dialog=document.getElementById("artist-focus-dialog");
  const artistId=dialog.dataset.artistId;
  await api("studio/artists/"+artistId+"/images/"+dialog.dataset.imageId+"/focus",{
   focusX:Number(dialog.dataset.focusX),focusY:Number(dialog.dataset.focusY),source:dialog.dataset.focusSource||"manual"
  });
  dialog.close();await refresh();openArtistPhotos(artistId);message("Artist header focus saved");return;
 }
 if(act==="studio-project-more"){
   const cursor=state.data.studioProjectPage?.nextCursor;if(!cursor)return;
   const page=await api("studio/projects/page?limit=150&cursor="+encodeURIComponent(cursor)+(state.projectQuery?"&q="+encodeURIComponent(state.projectQuery):""));
   const ids=new Set(state.data.studioProjects.map(p=>p.id));state.data.studioProjects.push(...page.results.filter(p=>!ids.has(p.id)));
   state.data.studioProjectPage={total:page.total,nextCursor:page.nextCursor};render();return;
 }
 if(act==="studio-project-search"){state.projectQuery=document.getElementById("studio-project-search").value.trim();await refresh();return;}
 if(act==="studio-inventory"){
   const data=await api("studio/inventory"),c=data.counts;
   showStudioReport("Library check",[c.artists+" artists",c.projects+" projects",c.briefs+" song briefs",c.tracks+" production tracks",c.audioAssets+" imported audio files","",...data.artists.map(a=>a.name+" — "+a.projectCount+" projects"),"",data.duplicateCandidates.length+" groups with matching content (review before merging)",data.orphans.length+" missing relationships",data.findings.length+" projects with earlier or differing settings"].join("\n"));return;
 }
 if(act==="studio-history"){
   const id=studioActiveId(state);if(!id)return;const data=await api("studio/projects/"+id+"/history");
   showStudioReport("Project history",data.map(v=>"Version "+v.revision+" · "+niceDate(v.createdAt)+"\n"+v.snapshot.title+"\n"+(v.snapshot.result?.concept||"No brief yet")+"\n\n"+(v.snapshot.result?.lyrics||"Instrumental or no lyrics")).join("\n\n────────\n\n"));return;
 }
 if(act==="copy-studio-report"){await navigator.clipboard.writeText(document.getElementById("studio-report-text").value);message("Report copied");return;}
 if(act==="artist-image-generate"){
   const artistId=el.dataset.artistId;
   const prompt=document.getElementById("artist-photo-prompt-"+artistId)?.value?.trim()||"";
   message("Generating the artist's wide photo. This may take a few minutes.");
   const image=await api("studio/artists/"+artistId+"/generate-photo",{prompt});
   await refresh();
   openArtistPhotos(artistId);
   const promptField=document.getElementById("artist-photo-prompt-"+artistId);if(promptField)promptField.value=prompt;
   message(image.selected?"New artist background linked":"New photo added. Select it from the artist's gallery.");
   return;
 }
 if(act==="artist-image-delete"){
   if(!window.confirm("Remove this photo from the artist's gallery? It will remain in any Studio projects."))return;
   const artistId=el.dataset.artistId;
   await api("studio/artists/"+artistId+"/images/"+el.dataset.imageId+"/delete",{});
   await refresh();
   openArtistPhotos(artistId);
   message("Photo removed from artist gallery");
   return;
 }
 if(act==="artist-image-select"){
   const artistId=el.dataset.artistId, imageId=el.dataset.imageId;
   await api("studio/artists/"+artistId+"/images/"+imageId+"/select",{});
   await refresh();
   openArtistPhotos(artistId);
   message("Artist background updated");
   return;
 }
 if(act?.startsWith("studio-"))return studioAction(el,state,api,refresh,message);
 if(act?.startsWith("dna-")){
   const next=await musicDnaAction(el,state,api,refresh,message);
   if(next==="render")render();
   return;
 }
 if(act==="browser-safari"||act==="browser-spotify-login"){
   const provider=act==="browser-spotify-login"?"spotify":el.dataset.provider;
   showBrowserLogin(provider);
   try{
     const result=await api("browser-accounts/"+provider+"/"+(act==="browser-spotify-login"?"login-safari":"open-safari"),{});
     state.data.browserAccounts=await api("browser-accounts");
     render();
     document.querySelector("#account-login-status").textContent=
       provider==="spotify" && result.url.includes("accounts.spotify.com")?
       "Spotify-login geopend in Safari. Kies 'Verdergaan met Facebook' als die methode nog actief is. Bevestig na terugkomst in Blossom.":
       "Safari is geopend. Als je nog niet eerder ingelogd bent, meld je aan en bevestig daarna in Blossom.";
   }catch(error){
     document.querySelector("#account-login-status").textContent=error.message;
     throw error;
   }
   return;
 }
 if(act==="browser-connect"||act==="browser-reopen"){
   const provider=act==="browser-connect"?el.dataset.provider:
     document.querySelector("#account-login-dialog").dataset.provider;
   const spotifyConfirmed=state.data.browserAccounts?.spotify?.handoff?.state==="user_confirmed";
   const url={suno:"https://suno.com/create",
     spotify:spotifyConfirmed?"https://open.spotify.com/":"https://accounts.spotify.com/nl/login",
     chatgpt:"https://chatgpt.com/"}[provider];
   if(!url)throw Error("Unknown browser provider");
   // A new tab inherits this browser process. Never use it for Google login
   // from a Playwright-controlled page: it would still be flagged as automated.
   if(navigator.webdriver===true){
     throw Error("This Chrome window is automated. Open in Safari on your Mac, or open the URL in your normal browser.");
   }
   if(act==="browser-connect")showBrowserLogin(provider);
   window.open(url,"_blank","noopener,noreferrer");
   // Recording after the click avoids popup blockers. No credentials or cookies.
   await api("browser-accounts/"+provider+"/open",{});
   state.data.browserAccounts=await api("browser-accounts");
   render();
   document.querySelector("#account-login-status").textContent=
     "Browser geopend. Kom na het inloggen terug en bevestig de aanmelding.";
   return;
 }
 if(act==="browser-confirm"||act==="browser-not-confirmed"){
   const provider=el.dataset.provider||
     document.querySelector("#account-login-dialog").dataset.provider;
   const operation=act==="browser-confirm"?"confirm":"not-confirmed";
   await api("browser-accounts/"+provider+"/"+operation,{});
   state.data.browserAccounts=await api("browser-accounts");
   render();
   const dialog=document.querySelector("#account-login-dialog");
   if(dialog.open)dialog.close();
   message(operation==="confirm"?"Aanmelding door jou bevestigd (niet automatisch geverifieerd).":
     "Aanmelding niet bevestigd. Je kunt opnieuw inloggen.");
   return;
 }
 if(act==="oauth-diagnose"){
   const result=await api("oauth/diagnostics");
   const names={none:"Geen OAuth-koppeling gezien",
     client_registered:"ChatGPT heeft een OAuth-client geregistreerd",
     consent_shown:"Toestemmingspagina is geopend",
     consent_login_failed:"Blossom-aanmelding is mislukt",
     consent_redirected:"Blossom heeft teruggestuurd naar ChatGPT, maar tokenuitwisseling is nog niet bevestigd",
     consent_denied:"Toestemming geweigerd",
     consent_repeated:"Toestemming was al verwerkt",
     token_rejected:"Tokenuitwisseling is mislukt",
     token_issued:"ChatGPT heeft een OAuth-token opgehaald",
     mcp_connected:"ChatGPT heeft de MCP-server bereikt",
     tools_listed:"ChatGPT heeft de MCP-tools opgehaald"};
   const details=result.events||[];
   const successful=details.find(x=>x.stage==="token_issued");
   const scanned=details.find(x=>x.stage==="tools_listed");
   const scope=successful?.scope||"";
   const interpretation=scanned?
     "Tools opgehaald. Ga terug naar ChatGPT en voltooi Create as a plugin.":
     successful?"Token opgehaald, maar nog geen geslaagde toolscan geregistreerd.":
     "Nog geen tokenuitwisseling bevestigd. Controleer het OAuth-venster en voltooi de koppeling vanuit ChatGPT.";
   const permission=successful&&!scope.includes("blossom:write")?
     " De huidige toestemming is alleen lezen. Voor songresultaten opslaan is schrijfautorisatie nodig.":"";
   const el=document.querySelector("#oauth-diagnostic-result");
   if(el)el.textContent=(names[result.latestStage]||result.latestStage)+". "+interpretation+permission;
   return;
 }
 if(act==="browser-finished"){
   document.querySelector("#account-login-dialog").close();
   state.data.browserAccounts=await api("browser-accounts");render();
   return;
 }
 if(act==="remove-openai"){if(confirm("Delete stored OpenAI API key?")){await api("studio/openai-key/remove",{});await refresh();message("OpenAI key removed");}return;}
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
// Refresh the handoff when the user returns from Safari or another tab.
// No website session is inspected; explicit user confirmation is still required.
let browserReturnRefreshing=false;
async function updateBrowserStatusOnReturn(){
 if(state.tab!=="connections" || document.visibilityState==="hidden" || browserReturnRefreshing)return;
 browserReturnRefreshing=true;
 try{
   state.data.browserAccounts=await api("browser-accounts");
   render();
   const dialog=document.querySelector("#account-login-dialog");
   if(dialog.open){
     const provider=dialog.dataset.provider;
     if(state.data.browserAccounts?.[provider]?.handoff?.state==="awaiting_confirmation"){
       document.querySelector("#account-login-status").textContent=
         "Terug uit Safari? Klik op 'Ik ben ingelogd' wanneer het gelukt is. Blossom kan Safari's inlogstatus niet controleren.";
     }
   }
 }catch(error){message("Browserstatus verversen mislukt: "+error.message,true);}
 finally{browserReturnRefreshing=false;}
}
document.addEventListener("visibilitychange",()=>{
 if(document.visibilityState!=="visible")return;
 void updateBrowserStatusOnReturn();
 if(state.tab==="music-dna")void loadOpenJobs(true);
});
window.addEventListener("focus",()=>{void updateBrowserStatusOnReturn();});
window.addEventListener("hashchange",async()=>{
 const page=pageFromHash(location.hash);
 if(page===state.tab)return;
 try{await studioFlush();}catch(error){message(error.message,true);return;}
 state.tab=page;
 render();
});
document.addEventListener("click",async event=>{
 if(event.target instanceof HTMLDialogElement && event.target.open){
  const bounds=event.target.getBoundingClientRect();
  if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom){event.target.close();return;}
 }
 const tab=event.target.closest("[data-tab]");
 const route=routeFromClick({tab:tab?.dataset.tab,action:tab?.dataset.action});
 if(route){
  try{await studioFlush();}catch(error){message(error.message,true);return;}
  state.tab=route.page;
  if(location.hash!==route.hash)history.pushState(null,"",route.hash);
  render();
  return;
 }
 const btn=event.target.closest("[data-action]");
 if(btn){btn.disabled=true;try{await action(btn)}catch(error){message(error.message,true)}finally{btn.disabled=false}}
});
document.addEventListener("input",e=>{
 if(e.target.id==="artist-search"){
  const query=e.target.value.trim().toLowerCase();let visible=0;
  document.querySelectorAll(".artist-banner-card").forEach(card=>{const matches=card.dataset.search.includes(query);card.hidden=!matches;if(matches)visible++;});
  const empty=document.getElementById("artist-search-empty");if(empty)empty.hidden=visible!==0||!query;
 }
 if(e.target.id?.startsWith("studio-")&&e.target.id!=="studio-project-picker"){studioInput(e,state,refresh);studioAutoSave(e,state,api);}
});
document.addEventListener("paste",event=>{
 const field=event.target?.id==="studio-source"?"url":event.target?.id==="studio-article"?"article":"";
 if(!field)return;
 const text=event.clipboardData?.getData("text")??"";
 if(!pasteStartsLyrics(field,text))return;
 setTimeout(()=>{void studioPaste(field,state,api,refresh,message).catch(error=>message(error.message,true));},0);
});
document.addEventListener("change",async e=>{
 if(e.target.id==="studio-project-picker")try{await studioInput(e,state,refresh);}catch(error){message(error.message,true);}
 else if(e.target.id?.startsWith("studio-"))studioAutoSave(e,state,api);
 if(e.target.id==="studio-audio-file")await studioAudio(e.target.files[0],state,refresh,message);
 if(e.target.matches("[data-dna-upload]")){
   try{await musicDnaUpload(e.target,refresh,message);}catch(error){message(error.message,true);}
 }
});
document.addEventListener("submit",async event=>{
 if(!["artist-form","track-form","release-form","suno-connection-form","spotify-connection-form","openai-connection-form","dna-reference-form"].includes(event.target.id))return;
 event.preventDefault();const button=event.target.querySelector("button[type=submit],button:not([type])");
 if(button)button.disabled=true;
 try{
  const data=Object.fromEntries(new FormData(event.target).entries());
  if(event.target.id==="dna-reference-form"){await musicDnaCreate(event.target,api,refresh,message);return;}
  if(event.target.id==="artist-form"){
   data.countries=data.countries.split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
   await api("artists",data);
  } else if(event.target.id==="track-form") await api("tracks",data);
  else if(event.target.id==="suno-connection-form"){await api("connections/suno",data);event.target.elements.apiKey.value="";}
  else if(event.target.id==="spotify-connection-form")await api("connections/spotify",data);
  else if(event.target.id==="openai-connection-form"){await api("studio/openai-key",data);event.target.elements.apiKey.value="";}
  else await api("releases",data);
  message("Saved");await refresh();
 }catch(error){message(error.message,true)}
 finally{if(button)button.disabled=false}
});
let openJobPoll=0;
async function loadOpenJobs(paint){
 if(state.tab!=="music-dna"||document.visibilityState==="hidden")return;
 try{
  const [queued,running]=await Promise.all([
   api("music-dna/jobs?status=queued&limit=200"),
   api("music-dna/jobs?status=running&limit=200")
  ]);
  const open=[...(running.jobs||[]),...(queued.jobs||[])];
  const changed=musicDnaJobsChanged(state.data.musicDnaOpenJobs, open);
  state.data.musicDnaOpenJobs=open;
  if(changed) await reloadMusicDna(state, api);
  if(paint && state.tab==="music-dna"){
    if(changed) render();
    else paintDnaActivity(state);
  }
  musicDnaChrome(state);
 }catch{/* keep the last statuses */}
}
function watchOpenJobs(){
 if(state.tab==="music-dna"){
  if(openJobPoll)return;
  void loadOpenJobs(true);
  openJobPoll=setInterval(()=>{void loadOpenJobs(true);},1000);
  return;
 }
 clearInterval(openJobPoll);
 openJobPoll=0;
}
if(new URLSearchParams(location.search).get("spotify")==="connected"){
 state.tab="connections";history.replaceState(null,"","/");}
studioConfigurePersistence(state,api,message);
bindMusicDna(state,api,render,message);
bindDiscography(state,api,refresh,message);
refresh().catch(error=>{view.innerHTML='<div class="warning-banner">Could not load Blossom: '+e(error.message)+'. Check the server and credentials.</div>'});
