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
let spotifyCatalogQuery = "";
let spotifyCatalogStatus = "";
let spotifyCatalogResults = null;
let spotifyCatalogRunning = false;

export const DNA_ROW_HEIGHT = 30;
export const DNA_MAX_SPAN = 800_000;
const DNA_OVERSCAN = 4;

export function dnaHue(id) {
  let hash = 0;
  for (const char of String(id || "")) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function dnaWindow({ total, scrollTop, viewportHeight, rowHeight = DNA_ROW_HEIGHT }) {
  const totalSafe = Math.max(0, Math.floor(Number(total) || 0));
  const viewport = Math.max(rowHeight, Math.floor(Number(viewportHeight) || rowHeight));
  const visible = Math.max(1, Math.ceil(viewport / rowHeight));
  const maxStart = Math.max(0, totalSafe - visible);
  const natural = Math.max(totalSafe, 1) * rowHeight;
  const span = Math.min(DNA_MAX_SPAN, natural);
  const proportional = span < natural;
  const maxScroll = Math.max(0, span - viewport);
  const top = Math.min(Math.max(0, Number(scrollTop) || 0), maxScroll);
  const start = proportional
    ? Math.min(maxStart, Math.round((maxScroll === 0 ? 0 : top / maxScroll) * maxStart))
    : Math.min(maxStart, Math.floor(top / rowHeight));
  const end = Math.min(totalSafe, start + visible + DNA_OVERSCAN);
  return { start, end, span, maxScroll, top, y: proportional ? top : start * rowHeight };
}

export function dnaFetchRange(start, end) {
  const need = Math.max(0, end - start);
  return { offset: start, limit: Math.min(100, Math.max(need, 40)) };
}

let currentQuery = "";
let catalogScroll = 0;
let catalogViewport = 720;
let selected = null;
let ignoreScroll = false;

function catalog(state) {
  const data = state?.data || {};
  return {
    query: data.musicDnaQuery ?? currentQuery,
    scroll: data.musicDnaScroll ?? catalogScroll,
    total: data.musicDnaTotal ?? (data.musicDnaProfiles || []).length,
    offset: data.musicDnaOffset ?? 0,
    profiles: data.musicDnaProfiles || [],
    selected: Object.hasOwn(data, "musicDnaSelected") ? data.musicDnaSelected : selected,
    viewport: data.musicDnaViewport ?? catalogViewport,
    jobs: data.musicDnaJobs || []
  };
}

export function musicDnaRequest(state) {
  const cat = catalog(state);
  const window = dnaWindow({ total: cat.total, scrollTop: cat.scroll, viewportHeight: cat.viewport });
  const range = cat.total ? dnaFetchRange(window.start, window.end) : { offset: 0, limit: 80 };
  const params = new URLSearchParams({ limit: String(range.limit), offset: String(range.offset) });
  if (cat.query) params.set("q", cat.query);
  return { path: "music-dna/search?" + params.toString(), offset: range.offset, limit: range.limit };
}

export function musicDnaSearchPath(state) {
  return musicDnaRequest(state).path;
}

function chip(kind, label) {
  return '<span class="dna-chip ' + kind + '">' + esc(label) + "</span>";
}

function analyzed(profile) {
  return Boolean(profile?.analysisVersion || profile?.analysis);
}
function focusVersion(profile) {
  if (analyzed(profile)) return "DNA v" + profile.analysisVersion;
  if (profile?.jobStatus === "failed") return "Analysis failed";
  return "Awaiting analysis";
}
function rowTraits(profile) {
  if (profile.analysis?.genres?.length) return profile.analysis.genres.slice(0, 2).join(", ");
  if (profile.analysis) return "Analyzed";
  if (profile.jobStatus === "failed") return "Analysis failed";
  return "Awaiting analysis";
}
function rowVersion(profile) {
  if (profile.analysisVersion) return "v" + profile.analysisVersion;
  if (profile.jobStatus === "failed") return "failed";
  return "—";
}
function focusMarkup(profile) {
  if (!profile) return '<p class="dna-focus dna-focus-empty">Select a recording to inspect its DNA.</p>';
  const analysis = profile.analysis;
  const chips = [];
  if (analysis?.bpm) chips.push(chip("bpm", analysis.bpm + " BPM"));
  if (analysis?.musicalKey) chips.push(chip("key", analysis.musicalKey));
  for (const genre of (analysis?.genres || []).slice(0, 4)) chips.push(chip("genre", genre));
  for (const mood of (analysis?.moods || []).slice(0, 3)) chips.push(chip("mood", mood));
  for (const instrument of (analysis?.instruments || []).slice(0, 6)) {
    if (instrument?.name) chips.push(chip("instrument", instrument.name));
  }
  if (analysis?.vocals?.type) chips.push(chip("vocal", analysis.vocals.type + " vocal"));
  const version = focusVersion(profile);
  const waiting = chips.length ? "" : profile.jobStatus === "failed"
    ? chip("failed", "Analysis failed") : chip("awaiting", "Metadata only");
  return '<section class="dna-focus" style="--dna-hue:' + dnaHue(profile.id) + '">' +
    '<div class="dna-focus-main"><strong>' + esc(profile.artist) + " · " + esc(profile.title) +
    "</strong><span>" + esc(version) + "</span></div>" +
    '<div class="dna-chips">' + (chips.join("") || waiting) + "</div>" +
    '<div class="dna-focus-actions"><label class="secondary mini music-dna-upload">Upload MP3/WAV<input type="file" hidden accept=".mp3,.wav,audio/mpeg,audio/wav" data-dna-upload="' +
    esc(profile.id) + '"></label></div>' + barBlocksMarkup(analysis) +
    '<details class="dna-raw"><summary>Raw DNA JSON</summary><pre>' +
    esc(JSON.stringify(analysis || { status: "No verified analysis saved" }, null, 2)) + "</pre></details></section>";
}

function rowMarkup(profile, focus) {
  if (!profile) return '<div class="dna-row dna-row-pending" aria-hidden="true"><span></span><span></span><span></span><span></span></div>';
  const active = focus && focus.id === profile.id;
  const version = rowVersion(profile);
  const traits = rowTraits(profile);
  return '<button type="button" class="dna-row' + (active ? " is-selected" : "") + '"' +
    (active ? ' style="--dna-hue:' + dnaHue(profile.id) + '"' : "") +
    ' data-action="dna-details" data-id="' + esc(profile.id) + '"><span class="dna-row-title">' +
    esc(profile.artist) + " · " + esc(profile.title) + '</span><span class="dna-row-bpm">' +
    esc(profile.analysis?.bpm ?? "") + '</span><span class="dna-row-traits">' + esc(traits) +
    '</span><span class="dna-row-version">' + esc(version) + "</span></button>";
}

function recordingLabel(total) {
  return total.toLocaleString("en-US") + (total === 1 ? " recording" : " recordings");
}

function countLabel(count, singular) {
  const n = Number(count) || 0;
  return n + " " + singular + (n === 1 ? "" : "s");
}

export function spotifySearchMarkup(results) {
  const tracks = results?.tracks || [];
  const albums = results?.albums || [];
  if (!tracks.length && !albums.length) return "";
  const trackRows = tracks.map(item =>
    '<div class="dna-spotify-hit"><span>' + esc(item.artist) + " — " + esc(item.title) +
    (item.album ? " · " + esc(item.album) : "") + "</span>" +
    '<button type="button" data-action="dna-spotify-add-track" data-spotify-id="' +
    esc(item.id) + '">Add</button></div>').join("");
  const albumRows = albums.map(item =>
    '<div class="dna-spotify-hit"><span>' + esc(item.artist) + " — " + esc(item.title) +
    " · " + countLabel(item.trackCount, "track") + "</span>" +
    '<button type="button" data-action="dna-spotify-add-album" data-spotify-id="' +
    esc(item.id) + '">Add album</button></div>').join("");
  return '<div class="dna-spotify-results">' + trackRows + albumRows + "</div>";
}

function spotifyAddedLabel(page) {
  const imported = Number(page?.imported) || 0;
  const duplicates = Number(page?.duplicates) || 0;
  if (imported === 0 && duplicates > 0) return "Already in the library.";
  const noun = imported === 1 ? "recording" : "recordings";
  if (duplicates > 0)
    return "Added " + imported + " " + noun + ". " + duplicates + " were already in the library.";
  return "Added " + imported + " " + noun + ".";
}

export function musicDnaView(state) {
  const cat = catalog(state);
  const window = dnaWindow({ total: cat.total, scrollTop: cat.scroll, viewportHeight: cat.viewport });
  const rows = [];
  for (let index = window.start; index < window.end; index += 1) {
    const profile = index >= cat.offset && index < cat.offset + cat.profiles.length
      ? cat.profiles[index - cat.offset] : null;
    rows.push(rowMarkup(profile, cat.selected));
  }
  const spotify = state.data.connections?.spotifyClientId
    ? '<a class="secondary dna-spotify-consent" href="/auth/spotify/start?choose=1">Connect Spotify Library ↗</a>'
    : '<span class="dna-spotify-hint">Add a Spotify Client ID in Connections before importing Liked Songs.</span>';
  return '<div class="music-dna-library"><div class="dna-toolbar">' +
    '<input id="dna-query" placeholder="Search instruments, techniques, moods, song titles..." value="' + esc(cat.query) + '">' +
    '<button type="button" class="secondary" data-action="dna-search">Search</button>' +
    '<button type="button" class="secondary" data-action="dna-reset">Clear</button>' +
    '<span class="dna-count">' + recordingLabel(cat.total) + "</span>" +
    '<button type="button" class="primary" data-action="dna-register">Register</button></div>' +
    musicDnaActivityMarkup(activityJobs(state), activitySpotify(state)) +
    '<section class="dna-spotify-liked">' + spotify +
    '<button type="button" class="primary" data-action="dna-spotify-import" ' + (spotifyLikedImport.running ? "disabled" : "") + '>Import Liked Songs</button>' +
    '<p class="dna-spotify-progress" aria-live="polite">' + esc(spotifyLikedImport.status || "No sync started yet.") + "</p>" +
    '<input id="dna-spotify-query" placeholder="Search Spotify tracks and albums" value="' +
    esc(spotifyCatalogQuery) + '"' + (state.data.connections?.spotifyClientId ? "" : " disabled") + ">" +
    '<button type="button" class="secondary" data-action="dna-spotify-search"' +
    (state.data.connections?.spotifyClientId && !spotifyCatalogRunning ? "" : " disabled") +
    ">Search Spotify</button>" +
    '<p class="dna-spotify-search-status" aria-live="polite">' + esc(spotifyCatalogStatus) + "</p>" +
    spotifySearchMarkup(spotifyCatalogResults) + "</section>" +
    focusMarkup(cat.selected) +
    '<div class="dna-cols"><span>Recording</span><span>BPM</span><span>DNA</span><span></span></div>' +
    '<div class="dna-catalog"><div class="dna-scroll"><div class="dna-span" style="height:' + window.span + 'px">' +
    '<div class="dna-window" data-start="' + window.start + '" data-end="' + window.end +
    '" style="transform:translateY(' + window.y + 'px)">' +
    (rows.length ? rows.join("") : '<p class="dna-empty">No matching recordings.</p>') +
    "</div></div></div></div></div>";}

function recordingName(job) {
  const name = [job?.artist, job?.title].filter(Boolean).join(" \u2014 ");
  return name || String(job?.profileId || "").slice(0, 8) || "Recording";
}
function spotifyInProgress(spotify) {
  if (!spotify || typeof spotify !== "object" || spotify.finished) return false;
  if (spotify.running) return true;
  return typeof spotify.status === "string" && spotify.status.trim() !== "";
}
function activityPercent(spotify) {
  const total = Number(spotify.total);
  const received = Number(spotify.received);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(received)) return null;
  return Math.min(100, Math.max(0, Math.round((received / total) * 100)));
}
function jobPercent(job) {
  const value = Number(job?.progress);
  if (!Number.isInteger(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
function jobActivity(job) {
  return {
    status: job?.status === "running" ? "Running" : "Queued",
    percent: jobPercent(job)
  };
}
export function musicDnaActivityItems(jobs, spotify = spotifyLikedImport) {
  const items = [];
  if (spotifyInProgress(spotify)) items.push({
    kind: "spotify", label: "Spotify Liked Songs",
    status: spotify.running ? "Importing" : "Paused", percent: activityPercent(spotify)
  });
  const open = (jobs || []).filter(job => job?.status === "queued" || job?.status === "running");
  open.sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1));
  for (const job of open) {
    const activity = jobActivity(job);
    items.push({
      kind: "job", label: recordingName(job), profileId: job.profileId || "",
      status: activity.status, percent: activity.percent
    });
  }
  return items;
}
function activitySummary(items) {
  const counts = {};
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  return ["Importing", "Paused", "Running", "Queued"]
    .filter(name => counts[name])
    .map(name => counts[name] + " " + name.toLowerCase())
    .join(" · ");
}
export function musicDnaActivityMarkup(jobs, spotify = spotifyLikedImport) {
  const items = musicDnaActivityItems(jobs, spotify);
  const start = items.some(item => item.kind === "job" && item.status === "Queued")
    ? '<button type="button" class="secondary mini" data-action="dna-start-analysis">Start analysis</button>'
    : "";
  const body = items.length
    ? '<p class="dna-activity-summary">' + esc(activitySummary(items)) + start + '</p><ul class="dna-activity-list">' + items.map(item =>
      '<li data-kind="' + item.kind + '"><span class="dna-activity-label">' + esc(item.label) +
      "</span><strong>" + esc(item.status) + "</strong>" +
      (item.percent == null ? "" : '<span class="dna-activity-percent">' + item.percent + "%</span>") +
      "</li>").join("") + "</ul>"
    : '<p class="dna-activity-empty">Nothing in progress.</p>';
  return '<section id="dna-activity" class="dna-activity" aria-live="polite"><h2>In progress</h2>' + body + "</section>";
}
function activityJobs(state) {
  const data = state?.data || {};
  return data.musicDnaOpenJobs || data.musicDnaJobs || [];
}
function activitySpotify(state) {
  const data = state?.data || {};
  return Object.hasOwn(data, "musicDnaSpotify") ? data.musicDnaSpotify : spotifyLikedImport;
}
export function paintDnaActivity(state) {
  if (typeof document === "undefined") return;
  const node = document.querySelector("#dna-activity");
  if (!node) return;
  node.outerHTML = musicDnaActivityMarkup(activityJobs(state), activitySpotify(state));
}
export function musicDnaQueueMarkup(jobs) {
  if (!jobs?.length) return "<p>No analysis jobs yet.</p>";
  return '<div class="dna-queue-list">' + jobs.map(job => {
    const open = job.status === "queued" || job.status === "running";
    const percent = open ? '<span class="dna-activity-percent">' + jobPercent(job) + "%</span>" : "";
    return "<div><span>" + esc(recordingName(job)) + "</span><strong>" + esc(job.status) +
      "</strong>" + percent + (job.error ? "<small>" + esc(job.error) + "</small>" : "") + "</div>";
  }).join("") + "</div>";
}

export function musicDnaChrome(state) {
  if (typeof document === "undefined") return;
  const jobs = state?.data?.musicDnaJobs || [];
  const openJobs = state?.data?.musicDnaOpenJobs
    || jobs.filter(job => job.status === "queued" || job.status === "running");
  const open = openJobs.length;
  const badge = document.querySelector("#dna-queue-count");
  if (badge) badge.textContent = String(open);
  const body = document.querySelector("#dna-queue-body");
  if (body) body.innerHTML = musicDnaQueueMarkup(jobs);
  const scroller = document.querySelector(".dna-scroll");
  const top = catalog(state).scroll;
  if (scroller && Math.abs(scroller.scrollTop - top) > 1) {
    const previous = ignoreScroll;
    ignoreScroll = true;
    scroller.scrollTop = top;
    ignoreScroll = previous;
  }
  if (scroller?.clientHeight && !state?.data?.musicDnaViewport) catalogViewport = scroller.clientHeight;
}

let bound = false;
export function bindMusicDna(state, api, render, message) {
  if (bound || typeof document === "undefined") return;
  bound = true;
  let timer = 0;
  let token = 0;
  let paintedStart = -1;
  document.addEventListener("scroll", event => {
    const el = event.target;
    if (ignoreScroll || !el?.classList?.contains("dna-scroll")) return;
    catalogScroll = el.scrollTop;
    if (state?.data) state.data.musicDnaScroll = catalogScroll;
    if (el.clientHeight) catalogViewport = el.clientHeight;
    const cat = catalog(state);
    const window = dnaWindow({ total: cat.total, scrollTop: catalogScroll, viewportHeight: catalogViewport });
    const loadedEnd = cat.offset + cat.profiles.length;
    const covered = cat.profiles.length > 0 && cat.offset <= window.start && loadedEnd >= window.end;
    if (window.start === paintedStart && covered) return;
    paintedStart = window.start;
    ignoreScroll = true;
    render();
    ignoreScroll = false;
    if (covered) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const request = musicDnaRequest(state);
      const mine = ++token;
      try {
        const page = await api(request.path);
        if (mine !== token) return;
        state.data.musicDnaProfiles = page.results || [];
        state.data.musicDnaTotal = Number.isInteger(page.total) ? page.total : state.data.musicDnaTotal;
        state.data.musicDnaOffset = request.offset;
        ignoreScroll = true;
        render();
        ignoreScroll = false;
      } catch (error) { message?.(error.message, true); }
    }, 80);
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.repeat || event.isComposing ||
      event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    const name = musicDnaKeyAction(event.target?.id, event.key);
    if (!name) return;
    const button = document.querySelector('[data-action="' + name + '"]');
    if (!button || button.disabled) return;
    event.preventDefault();
    button.click();
  });
}

export function musicDnaKeyAction(targetId, key) {
  if (key !== "Enter") return "";
  if (targetId === "dna-query") return "dna-search";
  if (targetId === "dna-spotify-query") return "dna-spotify-search";
  return "";
}

export function musicDnaJobsChanged(previous, next) {
  if (!Array.isArray(previous)) return false;
  const ids = jobs => (jobs || []).map(job => String(job?.id || "")).sort().join("\n");
  return ids(previous) !== ids(next);
}

async function loadCatalog(state, api) {
  const request = musicDnaRequest(state);
  const result = await api(request.path);
  state.data.musicDnaProfiles = result.results || [];
  state.data.musicDnaTotal = Number.isInteger(result.total) ? result.total : state.data.musicDnaProfiles.length;
  state.data.musicDnaOffset = request.offset;
}

export async function reloadMusicDna(state, api) {
  await loadCatalog(state, api);
  const openId = selected?.id || state?.data?.musicDnaSelected?.id;
  if (!openId) return;
  try {
    selected = await api("music-dna/profiles/" + openId);
    if (state?.data) delete state.data.musicDnaSelected;
  } catch { /* keep the recording that is already open */ }
}

export async function musicDnaAction(el, state, api, refresh, message) {
  const action = el.dataset.action;
  if (action === "dna-details") {
    const profileId = el.dataset.id;
    if (!profileId) return;
    selected = await api("music-dna/profiles/" + profileId);
    delete state.data.musicDnaSelected;
    await refresh();
    return;
  }
  if (action === "dna-start-analysis") {
    try {
      const result = await api("music-dna/jobs/start", {});
      message(result?.started
        ? "Analysis started. The percentage updates while ChatGPT works in the background."
        : "Analysis is already running.");
    } catch (error) {
      message(error.message || "Could not start analysis", true);
    }
    await refresh();
    return;
  }
  if (action === "dna-search") {
    currentQuery = document.querySelector("#dna-query")?.value.trim() || "";
    catalogScroll = 0;
    state.data.musicDnaQuery = currentQuery;
    state.data.musicDnaScroll = 0;
    const openId = catalog(state).selected?.id;
    ignoreScroll = true;
    try {
      await loadCatalog(state, api);
      if (openId) {
        selected = await api("music-dna/profiles/" + openId);
        delete state.data.musicDnaSelected;
      }
    } finally {
      ignoreScroll = false;
    }
    return "render";
  }
  if (action === "dna-reset") {
    currentQuery = "";
    catalogScroll = 0;
    state.data.musicDnaQuery = "";
    state.data.musicDnaScroll = 0;
    selected = null;
    delete state.data.musicDnaSelected;
    await refresh();
  }

  if (action === "dna-spotify-import") {
    if (spotifyLikedImport.running) return;
    if (spotifyLikedImport.finished) spotifyLikedImport={
      running:false,offset:0,imported:0,duplicates:0,received:0,total:0,finished:false,status:""
    };
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
        paintDnaActivity(state);
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
  if (action === "dna-spotify-search") {
    if (!state.data.connections?.spotifyClientId) {
      message("Configure your Spotify developer Client ID in Connections first", true);
      return;
    }
    if (spotifyCatalogRunning) return;
    spotifyCatalogQuery = document.querySelector("#dna-spotify-query")?.value.trim() || "";
    spotifyCatalogRunning = true;
    try {
      spotifyCatalogResults = await api(
        "music-dna/spotify/search?q=" + encodeURIComponent(spotifyCatalogQuery));
      const tracks = spotifyCatalogResults.tracks?.length || 0;
      const albums = spotifyCatalogResults.albums?.length || 0;
      spotifyCatalogStatus = countLabel(tracks, "track") + " · " + countLabel(albums, "album");
    } catch (error) {
      spotifyCatalogResults = null;
      spotifyCatalogStatus = error.message || "Spotify search failed";
      message(spotifyCatalogStatus, true);
    } finally {
      spotifyCatalogRunning = false;
      await refresh();
    }
    return;
  }
  if (action === "dna-spotify-add-track" || action === "dna-spotify-add-album") {
    if (spotifyCatalogRunning) return;
    const id = el.dataset.spotifyId || "";
    const path = action === "dna-spotify-add-track"
      ? "music-dna/spotify/tracks" : "music-dna/spotify/albums";
    spotifyCatalogRunning = true;
    try {
      const page = await api(path, { id });
      spotifyCatalogStatus = spotifyAddedLabel(page);
      message(spotifyCatalogStatus);
      await loadCatalog(state, api);
    } catch (error) {
      spotifyCatalogStatus = error.message || "Spotify import failed";
      message(spotifyCatalogStatus, true);
    } finally {
      spotifyCatalogRunning = false;
      await refresh();
    }
    return;
  }
  if (action === "dna-refresh") { await refresh(); message("Analysis jobs refreshed"); }
  if (action === "dna-queue") document.querySelector("#dna-queue-dialog")?.showModal();
  if (action === "dna-register") document.querySelector("#dna-register-dialog")?.showModal();
  if (action === "dna-close-queue") document.querySelector("#dna-queue-dialog")?.close();
  if (action === "dna-close-register") document.querySelector("#dna-register-dialog")?.close();
}

export async function musicDnaCreate(form, api, refresh, message) {
  const input = Object.fromEntries(new FormData(form).entries());
  const payload = { artist: input.artist, title: input.title,
    sourceKind: "metadata", sourceUrl: input.sourceUrl || "",
    sourceNote: input.sourceNote || "" };
  if (input.releaseYear) payload.releaseYear = Number(input.releaseYear);
  const result = await api("music-dna/profiles", payload);
  selected = result;
  catalogScroll = 0;
  form.reset();
  document.querySelector("#dna-register-dialog")?.close();
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
