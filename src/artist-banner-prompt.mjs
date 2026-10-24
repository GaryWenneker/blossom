const BINDING = "Picture wardrobe, setting, age presentation, energy and attitude for this production. A club, house, techno or aggressive electronic production must not look soft, sweet, innocent or acoustic. An intimate acoustic, folk or singer-songwriter production must not look like a club or rave. Voice type chooses who may be pictured; it must not override the production look.";
const DNA_MAX = 800;
const MUSIC_MAX = 1000;
const PROMPT_MAX = 4000;
const DEFAULT_OPENING = "Wide cinematic fictional musician publicity photograph";
const NO_SONG = "No finished song yet. Use the artist genre and Artist DNA only. Do not invent a conflicting scene.";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function listed(value) {
  if (Array.isArray(value)) return value.map(item => text(String(item))).filter(Boolean).join(", ");
  return text(value == null ? "" : String(value));
}

function clip(value, max) {
  return value.length <= max ? value : value.slice(0, max);
}

export function bannerSongFromProject(project) {
  return {
    genre: project?.parameters?.genre || "",
    additionalStyles: project?.parameters?.additionalStyles || [],
    style: project?.result?.style || "",
    moods: project?.result?.moods || [],
    suggestedGenre: project?.result?.suggestedGenre || ""
  };
}

export function selectBannerSongs(projects, options = {}) {
  if (options.project) return [bannerSongFromProject(options.project)];
  const owned = (projects || []).filter(item => !options.artistId || item.artistId === options.artistId);
  return owned.slice(0, 3).map(bannerSongFromProject);
}

function songLine(song) {
  const parts = [];
  const genre = listed(song?.genre);
  const extra = listed(song?.additionalStyles);
  const style = listed(song?.style);
  const moods = listed(song?.moods);
  const suggested = listed(song?.suggestedGenre);
  if (genre) parts.push("genre " + genre);
  if (extra) parts.push("additional styles " + extra);
  if (style) parts.push("style " + style);
  if (moods) parts.push("moods " + moods);
  if (suggested) parts.push("suggested genre " + suggested);
  return parts.join("; ");
}

function musicBody(songs, analyzedStyle, projectStyle) {
  const lines = (songs || []).slice(0, 3).map(songLine).filter(Boolean);
  const analyzed = text(analyzedStyle);
  const reference = text(projectStyle);
  if (analyzed) lines.push(analyzed);
  if (reference) lines.push(reference);
  return lines.length ? lines.join("\n") : NO_SONG;
}

function identity(artist, dna) {
  return [
    "Artist identity",
    "Name: " + text(artist?.name),
    "Genre: " + text(artist?.genre),
    "Voice: " + text(artist?.voice),
    "Artist DNA: " + dna
  ].join("\n");
}

function build(caller, artist, dna, music) {
  const parts = [];
  if (caller) parts.push(caller);
  parts.push(identity(artist, dna));
  parts.push("Music being made\n" + music);
  parts.push(BINDING);
  return parts.join("\n\n");
}

export function artistBannerPrompt({ artist, songs = [], analyzedStyle = "", projectStyle = "", userPrompt = "" } = {}) {
  let caller = text(userPrompt) || DEFAULT_OPENING;
  let dna = clip(text(artist?.dna), DNA_MAX);
  let music = clip(musicBody(songs, analyzedStyle, projectStyle), MUSIC_MAX);
  let prompt = build(caller, artist, dna, music);
  if (prompt.length <= PROMPT_MAX) return prompt;

  const withoutCaller = build("", artist, dna, music);
  const callerRoom = PROMPT_MAX - withoutCaller.length - 2;
  caller = callerRoom > 0 ? caller.slice(0, callerRoom) : "";
  return build(caller, artist, dna, music);
}
