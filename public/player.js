import { playerRoute } from "./route.js";
import { createPlayback, formatClock, loadSpotifySdk, playbackState, safeArt } from "./player-playback.js";

const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

function art(url, alt, className) {
  const safe = safeArt(url);
  if (!safe) return `<span class="${className} sp-art-empty" aria-hidden="true"></span>`;
  return `<img class="${className}" alt="${esc(alt)}" src="${esc(safe)}">`;
}

function playButton(kind, id, label) {
  if (!id) return "";
  return `<button type="button" class="sp-play" data-player-action="play" data-kind="${esc(kind)}" data-id="${esc(id)}" aria-label="${esc(label)}">Play</button>`;
}

function card(title, subtitle, image, href, kind, id) {
  const link = href ? `<a href="${esc(href)}">${art(image, title, "sp-card-art")}<strong>${esc(title)}</strong><span>${esc(subtitle)}</span></a>`
    : `<button type="button" data-player-action="play" data-kind="${esc(kind)}" data-id="${esc(id)}">${art(image, title, "sp-card-art")}<strong>${esc(title)}</strong><span>${esc(subtitle)}</span></button>`;
  const canPlayContext = kind === "album" || kind === "playlist";
  return `<article class="sp-card">${link}${href && canPlayContext ? playButton(kind, id, "Play " + title) : ""}</article>`;
}

function linkCard(title, subtitle, image, href) {
  return `<article class="sp-card"><a href="${esc(href)}">${art(image, title, "sp-card-art")}<strong>${esc(title)}</strong><span>${esc(subtitle)}</span></a></article>`;
}

function localAudio(value) {
  return typeof value === "string" && /^\/api\/albums\/[0-9a-f-]{36}\/entries\/[0-9a-f-]{36}\/audio$/i.test(value)
    ? value : "";
}

function blossomSong(item) {
  const audio = localAudio(item.audioUrl);
  return `<article class="sp-card">${art(item.imageUrl, item.title, "sp-card-art")}<div><strong>${esc(item.title)}</strong><span>${esc(item.artist || "")}</span>${audio ? `<audio controls preload="none" src="${esc(audio)}"></audio>` : ""}</div></article>`;
}

function section(title, body) {
  return `<section class="sp-section"><h2>${esc(title)}</h2><div class="sp-grid">${body}</div></section>`;
}

export function trackTable(tracks, offset = 0) {
  if (!tracks.length) return `<p class="sp-empty">No tracks.</p>`;
  return `<div class="sp-table">${tracks.map((track, index) => `<div class="sp-row">
    <span>${offset + index + 1}</span>
    ${art(track.imageUrl, track.title, "sp-row-art")}
    <button type="button" data-player-action="play" data-kind="track" data-id="${esc(track.id)}">${esc(track.title)}</button>
    <span>${esc(track.artist)}</span>
    <span>${esc(track.album || "")}</span>
    <span>${formatClock(track.durationMs)}</span>
  </div>`).join("")}</div>`;
}

function more(href, nextOffset) {
  return nextOffset == null ? "" : `<a class="sp-more" href="${esc(href)}?offset=${nextOffset}">Show more</a>`;
}

function glyph(name, body) {
  return `<svg class="sp-glyph sp-glyph-${name}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${body}</svg>`;
}

const ICON_HOME = glyph("home", `<path fill="currentColor" d="M8 1.4 1.2 7h1.6v7.2h4.2V9.2h2v5h4.2V7h1.6z"/>`);
const ICON_PREV = glyph("prev", `<path fill="currentColor" d="M3 2.2h1.8v11.6H3zm10.2 0L6.2 8l7 5.8z"/>`);
const ICON_NEXT = glyph("next", `<path fill="currentColor" d="M11.2 2.2H13v11.6h-1.8zM2.8 2.2 9.8 8l-7 5.8z"/>`);
const ICON_PLAY = glyph("play", `<path fill="currentColor" d="M4.2 2.4v11.2L13.2 8z"/>`);
const ICON_PAUSE = glyph("pause", `<path fill="currentColor" d="M3.2 2.4h3.2v11.2H3.2zm6.4 0h3.2v11.2H9.6z"/>`);
const ICON_SHUFFLE = glyph("shuffle", `<path fill="currentColor" d="M11.2 3.2H13l-1.6 1.6.1.2h-.7L8.2 8.2l.8.8 2.2-2.6h.2L13 8.2V6.6h-1.8V3.2zM2.4 3.6h2.1l2 2.5-.8.8-1.7-2.1H2.4zm6.6 6.2.8.8 1.4-1.6h.2v1.6H13l-1.6 1.6H9.6v-1.6h-.2zM2.4 12.4h2.2l4.2-5.2-.8-.8z"/>`);
const ICON_REPEAT = glyph("repeat", `<path fill="currentColor" d="M3.2 5.2h7.2V3.4L13.2 6 10.4 8.6V6.8H4.2v2.6H3.2zm9.6 5.6H5.6v1.8L2.8 10l2.8-2.6v1.8h6.2V6.6h1z"/>`);
const ICON_HEART = `<svg class="sp-glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="#fff" d="M8 13.2S3.2 9.8 3.2 6.8C3.2 5 4.6 3.8 6 3.8c.8 0 1.5.4 2 1.1.5-.7 1.2-1.1 2-1.1 1.4 0 2.8 1.2 2.8 3 0 3-4.8 6.4-4.8 6.4z"/></svg>`;

export function playerView() {
  return `<div class="sp">
    <header class="sp-top">
      <strong class="sp-brand">Blossom</strong>
      <a class="sp-home" href="#player" aria-label="Home">${ICON_HOME}</a>
      <form class="sp-search" role="search">
        <input name="q" type="search" maxlength="100" placeholder="What do you want to play?" aria-label="What do you want to play?">
      </form>
      <a class="sp-back" href="#studio">Studio</a>
    </header>
    <aside class="sp-library" aria-label="Library">
      <div class="sp-library-head"><span>Library</span></div>
      <div class="sp-filters" role="group" aria-label="Library filters">
        <button type="button" data-player-action="library" data-kind="playlists" aria-pressed="true">Playlists</button>
        <button type="button" data-player-action="library" data-kind="artists" aria-pressed="false">Artists</button>
        <button type="button" data-player-action="library" data-kind="albums" aria-pressed="false">Albums</button>
      </div>
      <a class="sp-pin" href="#player/collection/tracks"><span class="sp-heart" aria-hidden="true">${ICON_HEART}</span><span>Liked Songs</span></a>
      <div class="sp-library-list"></div>
    </aside>
    <section class="sp-main">
      <p class="sp-notice" role="status" hidden></p>
      <div class="sp-center"></div>
    </section>
    <aside class="sp-now" aria-label="Now playing">
      <img class="sp-now-art" alt="" hidden>
      <p class="sp-now-title">Nothing playing</p>
      <p class="sp-now-artist"></p>
    </aside>
    <footer class="sp-bar" aria-label="Playback">
      <div class="sp-bar-now">
        <img class="sp-bar-art" alt="" hidden>
        <div class="sp-bar-copy">
          <p class="sp-bar-title">Nothing playing</p>
          <p class="sp-bar-artist"></p>
        </div>
      </div>
      <div class="sp-bar-center">
        <div class="sp-transport">
          <button type="button" data-player-action="shuffle" aria-pressed="false" aria-label="Shuffle">${ICON_SHUFFLE}</button>
          <button type="button" data-player-action="previous" aria-label="Previous">${ICON_PREV}</button>
          <button type="button" class="sp-play" data-player-action="toggle" data-playing="false" aria-label="Play">${ICON_PLAY}${ICON_PAUSE}</button>
          <button type="button" data-player-action="next" aria-label="Next">${ICON_NEXT}</button>
          <button type="button" data-player-action="repeat" data-repeat="off" aria-pressed="false" aria-label="Repeat">${ICON_REPEAT}</button>
        </div>
        <div class="sp-progress">
          <span class="sp-time" data-role="position">0:00</span>
          <input class="sp-seek" data-player-action="seek" type="range" min="0" max="0" value="0" aria-label="Seek">
          <span class="sp-time" data-role="duration">0:00</span>
        </div>
      </div>
      <div class="sp-extra">
        <input class="sp-volume" data-player-action="volume" type="range" min="0" max="100" value="80" aria-label="Volume">
      </div>
    </footer>
  </div>`;
}

export function playerHome(data) {
  return `<div class="sp-page">
    ${section("Recently played", data.recent.map(item => card(item.title, item.artist, item.imageUrl, "", "track", item.id)).join(""))}
    ${section("Playlists", data.playlists.map(item => card(item.title, item.owner, item.imageUrl, "#player/playlist/" + item.id, "playlist", item.id)).join(""))}
    ${section("Artists", data.artists.map(item => card(item.name, "Artist", item.imageUrl, "#player/artist/" + item.id, "artist", item.id)).join(""))}
    ${section("Albums", data.albums.map(item => card(item.title, item.artist, item.imageUrl, "#player/album/" + item.id, "album", item.id)).join(""))}
  </div>`;
}

export function playerCollection(title, eyebrow, page, hash) {
  return `<div class="sp-page"><header class="sp-hero"><div><p>${esc(eyebrow)}</p><h1>${esc(title)}</h1></div>
    ${playButton(page.tracks[0] ? "track" : "", page.tracks[0]?.id, "Play " + title)}</header>
    ${trackTable(page.tracks, page.offset || 0)}${more(hash, page.nextOffset)}</div>`;
}

export function playerPlaylist(page) {
  return `<div class="sp-page"><header class="sp-hero">${art(page.imageUrl, page.title, "sp-hero-art")}<div><p>Playlist</p><h1>${esc(page.title)}</h1><p>${esc(page.owner)}</p></div>
    ${playButton("playlist", page.id, "Play " + page.title)}</header>
    ${trackTable(page.tracks, page.offset || 0)}${more("#player/playlist/" + page.id, page.nextOffset)}</div>`;
}

export function playerAlbum(page) {
  const eyebrow = page.albumType === "single" ? "Single" : page.albumType === "compilation" ? "Compilation" : "Album";
  return `<div class="sp-page"><header class="sp-hero">${art(page.imageUrl, page.title, "sp-hero-art")}<div><p>${eyebrow}</p><h1>${esc(page.title)}</h1><p>${esc(page.artist)}${page.releaseDate ? " · " + esc(page.releaseDate) : ""}</p></div>
    ${playButton("album", page.id, "Play " + page.title)}</header>
    ${trackTable(page.tracks, page.offset || 0)}${more("#player/album/" + page.id, page.nextOffset)}</div>`;
}

export function playerArtist(artist) {
  return `<div class="sp-page"><header class="sp-hero">${art(artist.imageUrl, artist.name, "sp-hero-art")}<div><p>Artist</p><h1>${esc(artist.name)}</h1></div></header>
    <h2>Popular</h2>${trackTable(artist.topTracks || [])}
    ${section("Albums", (artist.albums || []).map(item => card(item.title, item.artist, item.imageUrl, "#player/album/" + item.id, "album", item.id)).join(""))}
  </div>`;
}

export function playerSearch(data) {
  return `<div class="sp-page"><h1>Results for ${esc(data.query)}</h1>
    ${section("Songs", (data.tracks || []).map(blossomSong).join(""))}
    ${section("Albums", (data.albums || []).map(item => linkCard(item.title, item.artist, item.imageUrl, "#player/catalog/album/" + item.id)).join(""))}
    ${section("Artists", (data.artists || []).map(item => linkCard(item.name, "Artist", item.imageUrl, "#player/catalog/artist/" + item.id)).join(""))}
  </div>`;
}

export function playerCatalogArtist(artist) {
  return `<div class="sp-page"><header class="sp-hero">${art(artist.imageUrl, artist.name, "sp-hero-art")}<div><p>Artist</p><h1>${esc(artist.name)}</h1><p>${esc(artist.genre || "")}</p></div></header>
    ${section("Songs", (artist.topTracks || []).map(blossomSong).join(""))}
    ${section("Albums", (artist.albums || []).map(item => linkCard(item.title, item.artist || artist.name, item.imageUrl, "#player/catalog/album/" + item.id)).join(""))}
  </div>`;
}

export function playerCatalogAlbum(album) {
  const eyebrow = album.albumType === "single" ? "Single" : album.albumType === "compilation" ? "Compilation" : album.albumType === "ep" ? "EP" : "Album";
  return `<div class="sp-page"><header class="sp-hero">${art(album.imageUrl, album.title, "sp-hero-art")}<div><p>${eyebrow}</p><h1>${esc(album.title)}</h1><p>${esc(album.artist || "")}</p></div></header>
    ${section("Songs", (album.tracks || []).map(blossomSong).join(""))}
  </div>`;
}

export function libraryList(data) {
  const items = data.items || [];
  if (!items.length) return `<p class="sp-empty">Nothing saved here.</p>`;
  return items.map(item => {
    if (data.kind === "artists")
      return `<a class="sp-artist" href="#player/artist/${esc(item.id)}">${art(item.imageUrl, item.name, "sp-mini")}<span class="sp-lib-copy"><span>${esc(item.name)}</span></span></a>`;
    if (data.kind === "albums")
      return `<a href="#player/album/${esc(item.id)}">${art(item.imageUrl, item.title, "sp-mini")}<span class="sp-lib-copy"><span>${esc(item.title)}</span><small>${esc(item.artist)}</small></span></a>`;
    return `<a href="#player/playlist/${esc(item.id)}">${art(item.imageUrl, item.title, "sp-mini")}<span class="sp-lib-copy"><span>${esc(item.title)}</span></span></a>`;
  }).join("");
}

export function playerMessage(text, reconnect = false) {
  return `<div class="sp-message" role="status"><p>${esc(text)}</p>${reconnect ? `<a href="#connections">Reconnect Spotify</a>` : ""}</div>`;
}

let playback = null;
let libraryKind = "playlists";
let bound = false;
let timer = 0;
let latest = { paused: true, position: 0, duration: 0 };

export function unmountPlayer() {
  clearInterval(timer);
  timer = 0;
  playback?.disconnect();
  playback = null;
  bound = false;
}

function paintNotice(root, text) {
  const note = root.querySelector(".sp-notice");
  if (!note) return;
  const center = root.querySelector(".sp-center");
  if (text && text.includes("cannot play in Blossom") && center?.textContent.includes("cannot play in Blossom")) return;
  note.textContent = text || "";
  note.hidden = !text;
}

function paintTransport(root, state) {
  if (state.deviceId && !Object.hasOwn(state, "paused")) return;
  const view = state.empty ? playbackState(null) : state;
  latest = view;
  root.querySelector(".sp-now-title").textContent = view.title || "Nothing playing";
  root.querySelector(".sp-now-artist").textContent = view.artist || "";
  const image = root.querySelector(".sp-now-art");
  if (view.imageUrl) { image.src = view.imageUrl; image.hidden = false; image.alt = view.title || ""; }
  else { image.removeAttribute("src"); image.hidden = true; image.alt = ""; }
  const barTitle = root.querySelector(".sp-bar-title");
  const barArtist = root.querySelector(".sp-bar-artist");
  if (barTitle) barTitle.textContent = view.title || "Nothing playing";
  if (barArtist) barArtist.textContent = view.artist || "";
  const barImage = root.querySelector(".sp-bar-art");
  if (barImage) {
    if (view.imageUrl) { barImage.src = view.imageUrl; barImage.hidden = false; barImage.alt = ""; }
    else { barImage.removeAttribute("src"); barImage.hidden = true; barImage.alt = ""; }
  }
  const toggle = root.querySelector("[data-player-action=toggle]");
  const playing = view.paused === false;
  toggle.dataset.playing = playing ? "true" : "false";
  toggle.setAttribute("aria-label", playing ? "Pause" : "Play");
  root.querySelector("[data-role=position]").textContent = formatClock(view.position);
  root.querySelector("[data-role=duration]").textContent = formatClock(view.duration);
  const seek = root.querySelector(".sp-seek");
  if (document.activeElement !== seek) {
    seek.max = String(view.duration || 0);
    seek.value = String(view.position || 0);
  }
  root.querySelector("[data-player-action=shuffle]").setAttribute("aria-pressed", String(!!view.shuffle));
  const repeat = root.querySelector("[data-player-action=repeat]");
  repeat.dataset.repeat = view.repeat || "off";
  repeat.setAttribute("aria-pressed", String(!!view.repeat && view.repeat !== "off"));
  repeat.setAttribute("aria-label", !view.repeat || view.repeat === "off" ? "Repeat" : "Repeat " + view.repeat);
}

function ensureClock(root) {
  if (timer) return;
  timer = setInterval(() => {
    if (latest.paused || !latest.duration) return;
    latest = { ...latest, position: Math.min(latest.duration, (latest.position || 0) + 250) };
    const seek = root.querySelector(".sp-seek");
    if (!seek || document.activeElement === seek) return;
    root.querySelector("[data-role=position]").textContent = formatClock(latest.position);
    seek.value = String(latest.position);
  }, 250);
}

async function loadLibrary(root, api) {
  const data = await api("player/library?kind=" + encodeURIComponent(libraryKind));
  root.querySelector(".sp-library-list").innerHTML = libraryList(data);
  root.querySelectorAll("[data-player-action=library]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.kind === libraryKind));
  });
}

async function showRoute(root, api, hash) {
  const route = playerRoute(hash || location.hash);
  const center = root.querySelector(".sp-center");
  const search = root.querySelector(".sp-search input");
  if (route?.view === "search" && search) search.value = route.q;
  try {
    center.innerHTML = await renderRoute(route, api);
  } catch (error) {
    center.innerHTML = playerMessage(error.message || "Player request failed", error.status === 409);
  }
  if (center.textContent.includes("cannot play in Blossom")) {
    const note = root.querySelector(".sp-notice");
    if (note) { note.textContent = ""; note.hidden = true; }
  }
}

async function renderRoute(route, api) {
  if (!route || route.view === "invalid") return playerMessage("That player link is not valid.");
  if (route.view === "home") return playerHome(await api("player/home"));
  if (route.view === "liked") {
    const page = await api("player/tracks?offset=" + route.offset);
    return playerCollection("Liked Songs", "Playlist", page, "#player/collection/tracks");
  }
  if (route.view === "playlist")
    return playerPlaylist(await api("player/playlists/" + route.id + "?offset=" + route.offset));
  if (route.view === "artist") return playerArtist(await api("player/artists/" + route.id));
  if (route.view === "album")
    return playerAlbum(await api("player/albums/" + route.id + "?offset=" + route.offset));
  if (route.view === "search") {
    if (!route.q) return playerMessage("Enter a search query");
    return playerSearch(await api("player/search?q=" + encodeURIComponent(route.q)));
  }
  if (route.view === "catalog-artist")
    return playerCatalogArtist(await api("player/catalog/artists/" + route.id));
  if (route.view === "catalog-album")
    return playerCatalogAlbum(await api("player/catalog/albums/" + route.id));
  return playerMessage("That player link is not valid.");
}

async function startPlayback(root, api, kind, id) {
  const deviceId = playback?.deviceId();
  if (!deviceId) {
    paintNotice(root, "Blossom Player is not ready yet. Wait a moment and try again.");
    return;
  }
  await api("player/play", { deviceId, kind, id }, { method: "PUT" });
}

async function onClick(event, root, api) {
  const control = event.target.closest("[data-player-action]");
  if (!control || !root.contains(control)) return;
  const action = control.dataset.playerAction;
  if (action === "library") {
    libraryKind = control.dataset.kind;
    await loadLibrary(root, api);
    return;
  }
  if (action === "play") {
    event.preventDefault();
    await startPlayback(root, api, control.dataset.kind, control.dataset.id);
    return;
  }
  if (!playback) return;
  if (action === "toggle") await playback.toggle();
  if (action === "next") await playback.next();
  if (action === "previous") await playback.previous();
  if (action === "shuffle") {
    const next = control.getAttribute("aria-pressed") !== "true";
    await api("player/shuffle", { deviceId: playback.deviceId(), state: next }, { method: "PUT" });
    control.setAttribute("aria-pressed", String(next));
  }
  if (action === "repeat") {
    const order = ["off", "context", "track"];
    const current = control.dataset.repeat || "off";
    const next = order[(order.indexOf(current) + 1) % order.length];
    await api("player/repeat", { deviceId: playback.deviceId(), state: next }, { method: "PUT" });
    control.dataset.repeat = next;
    control.setAttribute("aria-pressed", String(next !== "off"));
    control.textContent = next === "off" ? "Repeat" : "Repeat " + next;
  }
}

function onSearch(event) {
  event.preventDefault();
  const query = String(new FormData(event.target).get("q") || "").trim();
  location.hash = "#player/search?q=" + encodeURIComponent(query);
}

function onInput(event) {
  const action = event.target?.dataset?.playerAction;
  if (action === "volume") playback?.volume(Number(event.target.value) / 100);
  if (action === "seek") playback?.seek(Number(event.target.value));
}

async function ensurePlayback(root, api) {
  if (playback) return;
  try {
    const Spotify = await loadSpotifySdk();
    playback = createPlayback({
      Spotify,
      getToken: async () => (await api("player/token")).accessToken,
      onState: state => paintTransport(root, state),
      onNotice: text => paintNotice(root, text)
    });
    ensureClock(root);
  } catch (error) {
    paintNotice(root, error.message || "Spotify playback could not start in this browser.");
  }
}

export async function updatePlayerHash(hash, api) {
  const root = document.querySelector(".sp");
  if (root) await showRoute(root, api, hash);
}

export async function mountPlayer({ api, hash }) {
  const root = document.querySelector(".sp");
  if (!root) return;
  if (!bound) {
    bound = true;
    root.addEventListener("click", event => {
      onClick(event, root, api).catch(error => paintNotice(root, error.message));
    });
    root.addEventListener("submit", onSearch);
    root.addEventListener("input", onInput);
    loadLibrary(root, api).catch(error => {
      if (error.status === 409) {
        const list = root.querySelector(".sp-library-list");
        if (list) list.innerHTML = `<p class="sp-empty">Reconnect to load your library.</p>`;
        return;
      }
      paintNotice(root, error.message);
    });
    ensurePlayback(root, api);
  }
  await showRoute(root, api, hash);
}
