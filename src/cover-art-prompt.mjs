const DNA_MAX = 800;
const MUSIC_MAX = 1000;
const PROMPT_MAX = 4000;
const NO_SONG = "No finished song yet. Use the artist genre and Artist DNA only. Do not invent a conflicting scene.";
const DEFAULT_OPENING = "Square original record sleeve with a scene that belongs to this production.";
const ALBUM_SURFACE = "Square album sleeve for the release.";
const TRACK_SURFACE = "Square track sleeve for this one song. The song title carries more weight than a catalog release name.";
const TOP_BAN = "Do not place a small title centered along the top. Typeface, scale, and position follow the direction below. That direction overrides any earlier request to put the title at the top.";
const SCENE = "Color, texture, and scene follow this production. A club, house, techno, or aggressive electronic sleeve must not look soft, sweet, or acoustic. An intimate acoustic, folk, or singer-songwriter sleeve must not look like a club flyer.";

const FAMILIES = [
  {
    id: "club",
    test: /\b(house|techno|trance|edm|rave|club|hardstyle|dnb|drum and bass|electronic)\b/i,
    typeface: "condensed industrial grotesque with tight tracking",
    scale: "song title very large, artist name a short supporting line",
    positions: [
      "lower third, flush left",
      "vertical along the right edge",
      "oversized and cropped through the middle"
    ]
  },
  {
    id: "rap",
    test: /\b(hip-hop|hip hop|rap|trap|grime|drill)\b/i,
    typeface: "heavy condensed sans, words stacked",
    scale: "title huge, artist name small in a corner",
    positions: [
      "bottom edge, words stacked",
      "upper-left corner crop, not centered",
      "diagonal across the lower half"
    ]
  },
  {
    id: "metal",
    test: /\b(metal|hardcore|punk|industrial)\b/i,
    typeface: "sharp display or blackletter, high contrast",
    scale: "title large and aggressive, artist name smaller",
    positions: [
      "bleeding off the left edge",
      "lower right, tilted",
      "split across the center"
    ]
  },
  {
    id: "acoustic",
    test: /\b(folk|acoustic|singer-songwriter|americana|country|ballad)\b/i,
    typeface: "quiet literary serif or thin handwritten",
    scale: "modest, never a billboard",
    positions: [
      "lower left with empty space above",
      "small, beside the subject, not on the top edge",
      "centered in the lower third only"
    ]
  },
  {
    id: "jazz",
    test: /\b(jazz|soul|r&b|blues|bossa)\b/i,
    typeface: "elegant high-contrast serif",
    scale: "medium title, smaller artist name",
    positions: [
      "low and centered",
      "right of center",
      "small in the lower-left"
    ]
  },
  {
    id: "pop",
    test: /\b(pop|k-pop|synth-pop|dance-pop)\b/i,
    typeface: "geometric sans with one accent color",
    scale: "large but not full-bleed",
    positions: [
      "asymmetric lower right",
      "stacked in the left third",
      "one word oversized, the rest small underneath"
    ]
  }
];

const OPEN = {
  id: "open",
  typeface: "display lettering chosen for this production, not a default sans caption",
  scale: "title clearly larger than the artist name",
  positions: [
    "lower left with open space above",
    "stacked in the left third",
    "diagonal across the lower half",
    "small, tucked into the lower-right corner",
    "vertical along the left edge"
  ]
};

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
    "Artist DNA: " + dna
  ].join("\n");
}

function pick(seed, options) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return options[(hash >>> 0) % options.length];
}

export function sleeveDirection(signal, title = "") {
  const source = text(signal);
  const family = FAMILIES.find(item => item.test.test(source)) || OPEN;
  return {
    family: family.id,
    typeface: family.typeface,
    scale: family.scale,
    position: pick(text(title) + "\n" + source, family.positions)
  };
}

function directionText(direction) {
  return [
    "Typography",
    "Typeface: " + direction.typeface,
    "Scale: " + direction.scale,
    "Position: " + direction.position
  ].join("\n");
}

function lettering(title, artist) {
  const song = text(title);
  const name = text(artist?.name);
  const titleLine = song ? `the exact title "${song}"` : "no invented title";
  const nameLine = name ? `the exact artist name "${name}"` : "no invented artist name";
  return `Only text on the sleeve: ${titleLine} and ${nameLine}. No credits, labels, awards, or any other words.`;
}

function build(caller, surfaceLine, words, who, music, direction) {
  const parts = [];
  if (caller) parts.push(caller);
  parts.push(surfaceLine, words, who, "Music being made\n" + music, TOP_BAN, direction, SCENE);
  return parts.join("\n\n");
}

export function coverArtPrompt({
  surface = "album",
  title = "",
  artist,
  songs = [],
  analyzedStyle = "",
  projectStyle = "",
  userPrompt = ""
} = {}) {
  let caller = text(userPrompt) || DEFAULT_OPENING;
  let dna = clip(text(artist?.dna), DNA_MAX);
  let music = clip(musicBody(songs, analyzedStyle, projectStyle), MUSIC_MAX);
  const surfaceLine = surface === "track" ? TRACK_SURFACE : ALBUM_SURFACE;
  const words = lettering(title, artist);
  const who = () => identity(artist, dna);
  const direction = () => directionText(sleeveDirection(
    [text(artist?.genre), dna, music].filter(Boolean).join("\n"),
    title
  ));
  let prompt = build(caller, surfaceLine, words, who(), music, direction());
  if (prompt.length <= PROMPT_MAX) return prompt;

  const roomFor = (nextCaller, nextMusic, nextDna) => {
    dna = nextDna;
    music = nextMusic;
    return build(nextCaller, surfaceLine, words, who(), music, direction());
  };
  const withoutCaller = roomFor("", music, dna);
  const callerRoom = PROMPT_MAX - withoutCaller.length - 2;
  caller = callerRoom > 0 ? caller.slice(0, callerRoom) : "";
  prompt = roomFor(caller, music, dna);
  if (prompt.length <= PROMPT_MAX) return prompt;

  music = "";
  prompt = roomFor(caller, music, dna);
  if (prompt.length <= PROMPT_MAX) return prompt;
  dna = clip(dna, Math.max(0, dna.length - (prompt.length - PROMPT_MAX)));
  prompt = roomFor(caller, music, dna);
  if (prompt.length <= PROMPT_MAX) return prompt;
  return roomFor("", "", "");
}
