const esc = value => String(value ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const barStatus = { not_analyzed:"Awaiting audio analysis",
  source_inferred:"Source-based interpretation",
  audio_observed:"Audio observation" };
function barLine(title, text) {
  return text ? '<div class="dna-bar-field"><strong>'+esc(title)+'</strong> '+esc(text)+'</div>' : "";
}
function barBlockMarkup(block) {
  const name="Bars "+block.startBar+"–"+block.endBar;
  const instruments=(block.instruments||[]).map(part=>{
    const detail=[part.activity,part.role,part.technique,part.rhythm,
      part.articulation,part.pitchRegister,part.timbre,
      ...(part.effects||[])].filter(Boolean).join(" · ");
    return barLine(part.name,detail);
  }).join("");
  const vocals=(block.vocals||[]).map(vocal=>{
    const detail=[vocal.activity,vocal.delivery,vocal.phrasing,vocal.articulation,
      vocal.register,vocal.dynamics,vocal.harmonies,
      ...(vocal.effects||[])].filter(Boolean).join(" · ");
    return barLine("Voice "+(vocal.singer||vocal.layer||""),detail);
  }).join("");
  const rhythmic=block.rhythm?Object.entries(block.rhythm).filter(([,value])=>value)
    .map(([name,value])=>barLine(name,value)).join(""):"";
  const harmony=block.harmony?
    barLine("Harmony",[...(block.harmony.chords||[]),block.harmony.movement].filter(Boolean).join(" · ")):"";
  const production=block.production?
    barLine("Production",[block.production.dynamics,block.production.spatial,
      block.production.transitions,...(block.production.processing||[])].filter(Boolean).join(" · ")):"";
  const detail=instruments+vocals+rhythmic+harmony+production+barLine("Notes",block.notes);
  return '<details class="dna-bar-block"><summary><span>'+esc(name)+'</span><span>'+
    esc(block.section||"Section unresolved")+'</span><small>'+
    esc(barStatus[block.status]||block.status)+'</small></summary><div>'+
    (detail||'<p>No per-bar instrumental or vocal observations verified yet. Audio is required.</p>')+
    '</div></details>';
}
function barBlocksMarkup(analysis) {
  const blocks=analysis?.barBlocks||[];
  if(!blocks.length)return "";
  const observed=blocks.filter(b=>b.status==="audio_observed").length;
  const source=blocks.filter(b=>b.status==="source_inferred").length;
  return '<section class="dna-bar-blocks"><h4>Bar-by-bar Music DNA</h4><p>'+
    observed+' audio-observed · '+source+' source-inferred · '+
    (blocks.length-observed-source)+' awaiting analysis. Bar positions are not audio-aligned unless explicit timestamps are present.</p>'+
    blocks.map(barBlockMarkup).join("")+'</section>';
}
let spotifyLikedImport = { running:false, offset:0, imported:0, duplicates:0, received:0,
  total:0, finished:false, status:"" };
let currentQuery = "";
let selected = null;
function summary(profile) {
  const a = profile.analysis;
  if (!a) return "Metadata only · not analyzed";
  const instruments = a.instruments?.map(i => i.name).join(", ") || "Instruments not classified";
  return [a.bpm ? a.bpm + " BPM" : "BPM unknown",
    ...(a.genres || []).slice(0, 3), instruments,
    ...(a.barBlocks?.length ? [a.barBlocks.length+" bar blocks"] : [])].join(" · ");
}
export function musicDnaView(state) {
  const profiles = state.data.musicDnaProfiles || [];
  const jobs = state.data.musicDnaJobs || [];
  return '<div class="music-dna-library">' +
    '<header class="studio-toolbar"><div class="studio-title"><div class="studio-square-icon">♫</div>' +
    '<div><h1>Music DNA Library</h1><p>Existing music, analyzed as reusable musical traits for original compositions.</p></div></div></header>' +
    '<div class="music-dna-grid"><section class="studio-panel"><div class="studio-panel-head"><h2>Register a recording</h2></div>' +
    '<form id="dna-reference-form" class="music-dna-form">' +
    '<label>Artist / group<input name="artist" maxlength="180" required placeholder="Reference artist"></label>' +
    '<label>Recording title<input name="title" maxlength="180" required placeholder="Song title"></label>' +
    '<label>Year (optional)<input name="releaseYear" type="number" min="1850" max="2200"></label>' +
    '<label>Source URL (metadata only)<input name="sourceUrl" type="url" placeholder="https://..."></label>' +
    '<label>Source notes<input name="sourceNote" maxlength="800" placeholder="Album version, release details..."></label>' +
    '<button type="submit" class="primary">Add to library</button></form>' +
    '<p class="studio-hint">A reference with only a title or link is not yet analyzed. To extract real signal metrics, upload a permitted MP3/WAV. For instruments, vocals and playing techniques, add a verified detailed DNA analysis.</p></section>' +
    '<section class="studio-panel"><div class="studio-panel-head"><h2>Analysis queue</h2><span class="studio-mini-tag">LOCAL WORKER</span></div>' +
    '<p class="studio-hint">Audio jobs are processed locally with FFmpeg when the DNA worker is running. Metadata-only jobs wait for actual audio or an analyst.</p>' +
    '<div class="music-dna-jobs">' +
    (jobs.length ? jobs.slice(0, 12).map(j => '<div><span>' + esc(j.profileId.slice(0, 8)) +
      '</span><strong>' + esc(j.status) + '</strong>' +
      (j.error ? '<small>' + esc(j.error) + '</small>' : "") + '</div>').join("") :
      '<p>No analysis jobs yet.</p>') +
    '</div><button class="secondary" data-action="dna-refresh">Refresh queue</button></section></div>' +
    '<section class="studio-panel dna-spotify-liked"><div class="studio-panel-head"><h2>Spotify · Liked Songs</h2><span class="studio-mini-tag">PRIVATE LIBRARY</span></div>' +
    '<p class="studio-hint">Import all of your Spotify Liked Songs to Music DNA without copying any list. Spotify account permission must include user-library-read. The import stores references and queues verification; it does not claim to have heard the recordings.</p>' +
    (state.data.connections?.spotifyClientId ?
      '<a class="secondary dna-spotify-consent" href="/auth/spotify/start?choose=1">Connect / reauthorize Spotify Library ↗</a>' :
      '<p class="studio-hint">First enter your Spotify developer Client ID in Connections → Spotify Web API. A website login alone cannot grant library API access.</p>') +
    '<button type="button" class="primary" data-action="dna-spotify-import" '+(spotifyLikedImport.running ? "disabled" : "")+'>Import all Liked Songs into Music DNA</button>' +
    '<p class="dna-spotify-progress" aria-live="polite">'+
      esc(spotifyLikedImport.status || "No sync started yet.")+'</p></section>' +
    '<section class="studio-panel"><div class="studio-panel-head"><h2>Reference recordings</h2>' +
    '<span class="studio-mini-tag">' + profiles.length + ' SHOWN</span></div>' +
    '<div class="music-dna-search"><input id="dna-query" placeholder="Search instruments, techniques, moods, song titles..." value="' + esc(currentQuery) + '">' +
    '<button class="secondary" data-action="dna-search">Search</button>' +
    '<button class="secondary" data-action="dna-reset">Clear</button></div>' +
    '<div class="music-dna-results">' +
    (profiles.length ? profiles.map(p => '<article class="music-dna-result"><div><strong>' +
      esc(p.artist) + ' · ' + esc(p.title) + '</strong><p>' + esc(summary(p)) + '</p>' +
      '<small>' + (p.analysisVersion ? 'DNA analysis v' + p.analysisVersion : 'Awaiting analysis') +
      '</small></div><div class="music-dna-actions">' +
      '<button class="secondary mini" data-action="dna-details" data-id="' + esc(p.id) + '">Details</button>' +
      '<label class="secondary mini music-dna-upload">Upload MP3/WAV<input type="file" hidden accept=".mp3,.wav,audio/mpeg,audio/wav" data-dna-upload="' +
      esc(p.id) + '"></label></div></article>').join("") :
      '<p class="studio-hint">No matching recordings.</p>') + '</div>' +
    (selected ? '<div class="music-dna-details"><h3>DNA profile: ' + esc(selected.artist) + ' · ' +
      esc(selected.title) + '</h3>' + barBlocksMarkup(selected.analysis) +
      '<details><summary>Raw DNA JSON</summary><pre>' + esc(JSON.stringify(selected.analysis || {
        status: "No verified analysis saved" }, null, 2)) + '</pre></details></div>' : '') +
    '</section></div>';
}
export async function musicDnaAction(el, state, api, refresh, message) {
  const action = el.dataset.action;
  if (action === "dna-details") {
    selected = await api("music-dna/profiles/" + el.dataset.id);
    await refresh();
  }
  if (action === "dna-search") {
    currentQuery = document.querySelector("#dna-query")?.value.trim() || "";
    const result = await api("music-dna/search?q=" + encodeURIComponent(currentQuery) + "&limit=100");
    state.data.musicDnaProfiles = result.results;
    selected = null;
    return "render";
  }
  if (action === "dna-reset") {
    currentQuery = ""; selected = null; await refresh();
  }

  if (action === "dna-spotify-import") {
    if (spotifyLikedImport.running) return;
    if (!state.data.connections?.spotifyClientId) {
      message("Configure your Spotify developer Client ID in Connections first",true);
      return;
    }
    spotifyLikedImport.running=true;
    const button=document.querySelector('[data-action="dna-spotify-import"]');
    if(button)button.disabled=true;
    let completed=false;
    try {
      // Bounded pagination and resumable in this browser session. Each API
      // batch saves at most 50 source records and deduplicates on Spotify ID.
      for(let pages=0;pages<200;pages++) {
        const page=await api("music-dna/spotify-liked/import",
          {offset:spotifyLikedImport.offset,limit:50});
        spotifyLikedImport.imported+=page.imported;
        spotifyLikedImport.duplicates+=page.duplicates;
        spotifyLikedImport.received+=page.received;
        spotifyLikedImport.total=page.total;
        if(page.nextOffset!==null && page.nextOffset<=spotifyLikedImport.offset)
          throw new Error("Spotify returned a repeated page; import paused");
        spotifyLikedImport.offset=page.nextOffset===null?0:page.nextOffset;
        completed=page.nextOffset===null;
        spotifyLikedImport.finished=completed;
        spotifyLikedImport.status=page.total+" liked songs · "+spotifyLikedImport.received+
          " checked · "+spotifyLikedImport.imported+" new · "+
          spotifyLikedImport.duplicates+" already in Blossom"+
          (completed?" · complete":" · continuing");
        const progress=document.querySelector(".dna-spotify-progress");
        if(progress)progress.textContent=spotifyLikedImport.status;
        if(completed)break;
      }
      message(completed ?
        "Spotify Liked Songs imported. Audio analysis remains pending for metadata-only entries." :
        "Imported 10,000 entries in this pass; click again to resume.");
    } catch(error) {
      spotifyLikedImport.status=(error.message||"Spotify import failed")+
        ". Existing imports have been preserved; click again to resume.";
      message(spotifyLikedImport.status,true);
    } finally {
      spotifyLikedImport.running=false;
      await refresh();
    }
    return;
  }
  if (action === "dna-refresh") { await refresh(); message("Analysis jobs refreshed"); }
}
export async function musicDnaCreate(form, api, refresh, message) {
  const input = Object.fromEntries(new FormData(form).entries());
  const payload = { artist: input.artist, title: input.title,
    sourceKind: "metadata", sourceUrl: input.sourceUrl || "",
    sourceNote: input.sourceNote || "" };
  if (input.releaseYear) payload.releaseYear = Number(input.releaseYear);
  const result = await api("music-dna/profiles", payload);
  selected = result;
  await refresh();
  message(result.duplicate ? "Reference already exists" : "Reference added to Music DNA");
}
export async function musicDnaUpload(input, refresh, message) {
  const file = input.files?.[0];
  const profileId = input.dataset.dnaUpload;
  if (!file || !profileId) return;
  if (file.size > 40 * 1024 * 1024) { message("Audio must be smaller than 40MB", true); return; }
  if (!confirm("Confirm you have the necessary permission to process this recording locally. The file remains on your Mac and is not published.")) return;
  const mime = file.type === "audio/wav" || file.name.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  const response = await fetch("/api/music-dna/profiles/" + profileId + "/upload-audio", {
    method: "POST", headers: {
      "x-blossom-request": "ui", "x-blossom-audio-rights": "confirmed", "content-type": mime
    }, body: file
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Audio upload failed");
  await refresh();
  message(data.duplicate ? "Audio already registered" : "Reference audio attached and analysis job queued");
}
