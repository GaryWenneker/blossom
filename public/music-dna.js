const esc = value => String(value ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function initials(artist) {
  const parts = String(artist || "").trim().split(/\s+/).filter(Boolean);
  const chosen = parts.length > 1 ? parts.slice(0, 2) : parts.slice(0, 1);
  return chosen.map(part => part[0]).join("").toUpperCase() || "?";
}
function statusClass(status) {
  if (status === "audio_observed") return "dna-source-audio";
  if (status === "human_verified") return "dna-source-human";
  if (status === "source_inferred") return "dna-source-inferred";
  return "dna-source-none";
}
function evidenceKind(analysis) {
  if (!analysis) return "not_analyzed";
  if (analysis.analysisMethod === "human_verified") return "human_verified";
  if (analysis.analysisMethod === "chatgpt-catalog" || analysis.measurements == null) return "source_inferred";
  return "audio_observed";
}
function clock(ms) {
  const total = Math.round(Number(ms) / 1000);
  if (!Number.isFinite(total) || total < 0) return "";
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}
function fact(kind, label, value) {
  const shown = value == null || value === "" ? "—" : value;
  return '<div class="dna-fact ' + statusClass(kind) + '"><span>' + esc(label) +
    "</span><strong>" + esc(shown) + "</strong></div>";
}
function joinList(items) {
  return (items || []).filter(Boolean).join(", ");
}
function instrumentLine(item) {
  if (!item?.name) return "";
  return [item.name, item.role, item.technique, item.timbre,
    item.confidence == null ? "" : String(item.confidence)].filter(Boolean).join(" · ");
}
function barStrip(analysis) {
  const blocks = analysis?.barBlocks || [];
  if (!blocks.length) return "";
  return '<div class="dna-bar-strip" aria-label="Bar DNA">' + blocks.map(block =>
    '<i class="dna-bar-cell ' + statusClass(block.status) + '" title="' +
    esc("Bars " + block.startBar + "–" + block.endBar + (block.section ? " " + block.section : "")) +
    '"></i>').join("") + "</div>";
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
function rowTraitMarkup(profile) {
  const genres = profile.analysis?.genres || [];
  if (genres.length) return genres.slice(0, 2).map(genre => chip("genre", genre)).join("");
  if (profile.analysis) return chip("genre", "Analyzed");
  if (profile.jobStatus === "failed") return chip("failed", "Analysis failed");
  return chip("awaiting", "Awaiting analysis");
}
function rowMeta(profile) {
  const bits = [profile.releaseYear, profile.sourceKind].filter(value => value != null && value !== "");
  return bits.length ? "<small>" + esc(bits.join(" · ")) + "</small>" : "";
}
function rowVersion(profile) {
  if (profile.analysisVersion) return "v" + profile.analysisVersion;
  if (profile.jobStatus === "failed") return "failed";
  return "—";
}
function sheetChips(analysis) {
  const chips = [];
  if (analysis?.bpm) chips.push(chip("bpm", analysis.bpm + " BPM"));
  if (analysis?.musicalKey) chips.push(chip("key", analysis.musicalKey));
  for (const genre of (analysis?.genres || []).slice(0, 4)) chips.push(chip("genre", genre));
  for (const mood of (analysis?.moods || []).slice(0, 3)) chips.push(chip("mood", mood));
  for (const instrument of (analysis?.instruments || []).slice(0, 6)) {
    if (instrument?.name) chips.push(chip("instrument", instrument.name));
  }
  if (analysis?.vocals?.type) chips.push(chip("vocal", analysis.vocals.type + " vocal"));
  return chips.join("");
}
function recordingSheet(profile) {
  if (!profile) return "";
  const analysis = profile.analysis;
  const kind = evidenceKind(analysis);
  const vocals = analysis?.vocals || {};
  const production = analysis?.production || {};
  const measurements = analysis?.measurements;
  const measureText = measurements
    ? [measurements.codec, measurements.sampleRate ? measurements.sampleRate + " Hz" : "",
      measurements.channels ? measurements.channels + " ch" : ""].filter(Boolean).join(" · ")
    : (analysis ? "none" : "");
  const sections = (analysis?.sections || []).map(section =>
    [section.label, clock(section.startMs) && clock(section.endMs)
      ? clock(section.startMs) + "–" + clock(section.endMs) : ""].filter(Boolean).join(" ")
  ).join(" · ");
  const vocalText = [vocals.type, vocals.register, vocals.timbre, vocals.delivery, vocals.harmonies]
    .filter(Boolean).join(" · ");
  const productionText = [production.era, production.texture, production.stereo, production.dynamics,
    joinList(production.effects)].filter(Boolean).join(" · ");
  return '<dialog id="dna-recording-sheet" data-profile-id="' + esc(profile.id) +
    '" style="--dna-hue:' + dnaHue(profile.id) + '"><div class="dna-sheet-grid">' +
    '<div class="dna-sheet-side"><div class="dna-sheet-cover" aria-hidden="true">' + esc(initials(profile.artist)) +
    '</div><p class="dna-sheet-lyrics">Lyrics are not stored for reference recordings.</p>' +
    '<p class="dna-sheet-legend"><i class="dna-swatch dna-source-audio"></i> Audio observed ' +
    '<i class="dna-swatch dna-source-human"></i> Human verified ' +
    '<i class="dna-swatch dna-source-inferred"></i> Source inferred ' +
    '<i class="dna-swatch dna-source-none"></i> Not analyzed</p>' +
    '<label class="secondary mini music-dna-upload">Upload MP3/WAV<input type="file" hidden accept=".mp3,.wav,audio/mpeg,audio/wav" data-dna-upload="' +
    esc(profile.id) + '"></label></div><div class="dna-sheet-main"><header class="dna-sheet-head"><h2>' +
    esc(profile.artist) + " · " + esc(profile.title) + "</h2><span>" + esc(focusVersion(profile)) +
    '</span><button type="button" class="secondary mini" data-action="dna-paste-open" data-id="' +
    esc(profile.id) + '">Paste JSON</button><button type="button" class="secondary mini" data-action="dna-close-sheet" data-id="' +
    esc(profile.id) + '">Close</button></header><div class="dna-chips">' + sheetChips(analysis) +
    '</div><div class="dna-sheet-mosaic">' +
    fact(kind, "Release year", profile.releaseYear) +
    fact(kind, "Source", profile.sourceKind) +
    fact(kind, "Job", profile.jobStatus) +
    fact(kind, "BPM", analysis?.bpm) +
    fact(kind, "Key", analysis?.musicalKey) +
    fact(kind, "Time", analysis?.timeSignature) +
    fact(kind, "Duration", analysis?.durationMs == null ? "" : clock(analysis.durationMs)) +
    fact(kind, "Genres", joinList(analysis?.genres)) +
    fact(kind, "Moods", joinList(analysis?.moods)) +
    fact(kind, "Instruments", (analysis?.instruments || []).map(instrumentLine).filter(Boolean).join("; ")) +
    fact(kind, "Vocals", vocalText) +
    fact(kind, "Production", productionText) +
    fact(kind, "Sections", sections) +
    fact(kind, "Summary", analysis?.summary) +
    fact(kind, "Method", analysis?.analysisMethod) +
    fact(kind, "Analyzer", analysis?.analyzer) +
    fact(kind, "Confidence", analysis?.confidence) +
    fact(measurements ? "audio_observed" : kind, "Measurements", measureText) +
    fact(kind, "Source URL", profile.sourceUrl) +
    fact(kind, "Source note", profile.sourceNote) +
    fact(kind, "Recording SHA-256", profile.recordingSha256) +
    fact(kind, "Created", profile.createdAt) +
    fact(kind, "Updated", profile.updatedAt) +
    "</div>" + barStrip(analysis) + "</div></div></dialog>";
}

function canAnalyze(profile) {
  return !!profile && !profile.analysisVersion;
}
function rowMarkup(profile, focus) {
  if (!profile) return '<div class="dna-row dna-row-pending" aria-hidden="true"><span></span><span></span><span></span><span></span></div>';
  const active = focus && focus.id === profile.id;
  const version = rowVersion(profile);
  const analyze = canAnalyze(profile)
    ? '<button type="button" class="secondary mini" data-action="dna-analyze-one" data-id="' +
      esc(profile.id) + '">Analyze</button>'
    : esc(version);
  const paste = '<button type="button" class="secondary mini" data-action="dna-paste-open" data-id="' +
    esc(profile.id) + '">Paste JSON</button>';
  return '<div class="dna-row' + (active ? " is-selected" : "") + '" data-id="' + esc(profile.id) +
    '" style="--dna-hue:' + dnaHue(profile.id) + '">' +
    '<button type="button" class="dna-row-open" data-action="dna-details" data-id="' + esc(profile.id) +
    '"><span class="dna-row-title"><b>' + esc(profile.artist) + " · " + esc(profile.title) +
    "</b>" + rowMeta(profile) + "</span><span class=\"dna-row-bpm\">" + esc(profile.analysis?.bpm ?? "") +
    '</span><span class="dna-row-traits">' + rowTraitMarkup(profile) +
    '</span></button><span class="dna-row-version">' + analyze + paste + "</span></div>";
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
    recordingSheet(cat.selected) +
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
function compareNewest(a, b) {
  const aStamp = String(a?.createdAt || "");
  const bStamp = String(b?.createdAt || "");
  if (!aStamp && !bStamp) return 0;
  return bStamp.localeCompare(aStamp);
}
export function musicDnaActivityItems(jobs, spotify = spotifyLikedImport) {
  const items = [];
  if (spotifyInProgress(spotify)) items.push({
    kind: "spotify", label: "Spotify Liked Songs",
    status: spotify.running ? "Importing" : "Paused", percent: activityPercent(spotify)
  });
  const open = (jobs || []).filter(job => job?.status === "queued" || job?.status === "running");
  open.sort(compareNewest);
  for (const job of open) {
    const activity = jobActivity(job);
    items.push({
      kind: "job", label: recordingName(job), profileId: job.profileId || "",
      jobId: job.id || "", status: activity.status, percent: activity.percent
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
  const queued = items.some(item => item.kind === "job" && item.status === "Queued");
  const start = queued
    ? '<button type="button" class="secondary mini" data-action="dna-start-analysis">Start analysis</button>' +
      '<button type="button" class="secondary mini" data-action="dna-clear-queue">Clear queue</button>'
    : "";
  const body = items.length
    ? '<p class="dna-activity-summary">' + esc(activitySummary(items)) + start + '</p><ul class="dna-activity-list">' + items.map(item => {
      const analyze = item.kind === "job" && item.status === "Queued" && item.profileId
        ? '<button type="button" class="secondary mini" data-action="dna-analyze-one" data-id="' +
          esc(item.profileId) + '">Analyze</button>'
        : "";
      const key = item.kind === "spotify" ? "spotify" : (item.jobId || item.profileId);
      return '<li data-kind="' + item.kind + '"><span class="dna-activity-label" data-key="' + esc(key) + '">' + esc(item.label) +
      "</span><strong>" + esc(item.status) + "</strong>" +
      (item.percent == null ? "" : '<span class="dna-activity-percent">' + item.percent + "%</span>") +
      analyze + "</li>";
    }).join("") + "</ul>"
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
function activityRowKey(row) {
  if (row?.dataset?.key) return row.dataset.key;
  const nested = row?.querySelector?.("[data-key]");
  return nested?.dataset?.key || "";
}
export function captureDnaActivityScroll() {
  if (typeof document === "undefined") return null;
  const list = document.querySelector("#dna-activity .dna-activity-list");
  if (!list) return null;
  const scrollTop = Number(list.scrollTop) || 0;
  if (scrollTop <= 0) return { pinned: "top" };
  const anchor = [...list.children].find(row => row.offsetTop + row.offsetHeight > scrollTop + 1);
  return {
    scrollTop,
    key: activityRowKey(anchor),
    offset: anchor ? anchor.offsetTop - scrollTop : 0
  };
}
export function restoreDnaActivityScroll(anchor) {
  if (!anchor || typeof document === "undefined") return;
  const list = document.querySelector("#dna-activity .dna-activity-list");
  if (!list) return;
  if (anchor.pinned === "top") {
    list.scrollTop = 0;
    return;
  }
  const match = anchor.key
    ? [...list.children].find(row => activityRowKey(row) === anchor.key)
    : null;
  list.scrollTop = match ? Math.max(0, match.offsetTop - anchor.offset) : anchor.scrollTop;
}
export function paintDnaActivity(state) {
  if (typeof document === "undefined") return;
  const node = document.querySelector("#dna-activity");
  if (!node) return;
  const anchor = captureDnaActivityScroll();
  node.outerHTML = musicDnaActivityMarkup(activityJobs(state), activitySpotify(state));
  restoreDnaActivityScroll(anchor);
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
  const dialog = document.querySelector("#dna-recording-sheet");
  if (dialog && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  if (sheetReturnId && typeof document.querySelector === "function") {
    const id = sheetReturnId;
    sheetReturnId = "";
    const safeId = globalThis.CSS?.escape ? CSS.escape(id) : id;
    document.querySelector('.dna-row[data-id="' + safeId + '"] .dna-row-open')?.focus();
  }
}

let bound = false;
let sheetReturnId = "";
let pasteBusy = false;
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
  document.addEventListener("click", event => {
    if (event.target?.id !== "dna-recording-sheet" && event.target?.id !== "dna-paste-dialog") return;
    event.target.close();
  }, true);
  document.addEventListener("close", event => {
    if (event.target?.id !== "dna-recording-sheet") return;
    sheetReturnId = event.target.dataset.profileId || "";
    selected = null;
    if (state?.data) delete state.data.musicDnaSelected;
    render();
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
  if (action === "dna-close-sheet") {
    sheetReturnId = el.dataset.id || "";
    selected = null;
    if (state?.data) delete state.data.musicDnaSelected;
    return "render";
  }
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
  if (action === "dna-clear-queue") {
    if (!globalThis.confirm(
      "Clear every queued recording? A recording that is already running keeps going. The recordings stay in the library."
    )) return;
    try {
      const result = await api("music-dna/jobs/clear", {});
      const cleared = Number(result?.cleared) || 0;
      const running = Number(result?.running) || 0;
      const noun = cleared === 1 ? "recording" : "recordings";
      message(cleared
        ? "Cleared " + cleared + " queued " + noun + "." +
          (running ? " The one already running keeps going." : "")
        : "The queue is already empty.");
    } catch (error) {
      message(error.message || "Could not clear the queue", true);
    }
    await refresh();
    return;
  }
  if (action === "dna-paste-open") {
    const profileId = el.dataset.id || "";
    const dialog = document.querySelector("#dna-paste-dialog");
    if (!dialog || !profileId) return;
    dialog.dataset.profileId = profileId;
    const box = document.querySelector("#dna-paste-json");
    if (box) box.value = "";
    const error = document.querySelector("#dna-paste-error");
    if (error) { error.hidden = true; error.textContent = ""; }
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    return;
  }
  if (action === "dna-paste-cancel") {
    document.querySelector("#dna-paste-dialog")?.close();
    return;
  }
  if (action === "dna-paste-apply") {
    if (pasteBusy) return;
    const dialog = document.querySelector("#dna-paste-dialog");
    const profileId = dialog?.dataset.profileId || "";
    const text = document.querySelector("#dna-paste-json")?.value?.trim() || "";
    const error = document.querySelector("#dna-paste-error");
    const showError = note => {
      if (error) { error.hidden = false; error.textContent = note; }
      message(note, true);
    };
    if (!profileId || !text) {
      showError("Paste the analysis JSON first.");
      return;
    }
    pasteBusy = true;
    try {
      await api("music-dna/profiles/" + profileId + "/paste-analysis", { text });
      dialog?.close();
      const box = document.querySelector("#dna-paste-json");
      if (box) box.value = "";
      await refresh();
      message("Analysis saved from pasted JSON.");
    } catch (err) {
      showError(err.message || "Could not save the pasted analysis");
    } finally { pasteBusy = false; }
    return;
  }
  if (action === "dna-analyze-one") {
    const profileId = el.dataset.id;
    if (!profileId) return;
    try {
      const result = await api("music-dna/profiles/" + profileId + "/analyze", {});
      message(result?.started
        ? "Analysis started for this recording."
        : result?.status === "running"
          ? "This recording is already being analyzed."
          : "This recording is next. Another analysis is still finishing.");
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
