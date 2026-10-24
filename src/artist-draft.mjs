import { DomainError } from "./domain.mjs";
import { referenceStyle, referenceTraits } from "./music-dna-studio.mjs";

const DNA_LIMIT = 3000;
const HEADER = "Musical traits for a new fictional artist. Do not copy a source name, lyric, melody, or vocal identity.";

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return (Array.isArray(value) ? value : []).map(text).filter(Boolean);
}

function songLine(project) {
  const parameters = project?.parameters || {};
  const result = project?.result || {};
  const parts = [];
  const genre = text(parameters.genre);
  if (genre) parts.push("genre " + genre);
  const styles = list(parameters.additionalStyles);
  if (styles.length) parts.push("additional styles " + styles.join(", "));
  const style = text(result.style);
  if (style) parts.push("style " + style);
  const moods = list(result.moods);
  if (moods.length) parts.push("moods " + moods.join(", "));
  const suggested = text(result.suggestedGenre);
  if (suggested) parts.push("suggested genre " + suggested);
  return parts.join("; ");
}

function newestSongs(projects, artistId) {
  return projects
    .filter(project => project?.artistId === artistId)
    .slice()
    .sort((left, right) => String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || "")))
    .map(songLine)
    .filter(Boolean)
    .slice(0, 3);
}

function uniqueFold(values) {
  const kept = [];
  for (const value of values) {
    const raw = text(value);
    if (!raw) continue;
    if (kept.some(item => item.toLowerCase() === raw.toLowerCase())) continue;
    kept.push(raw);
  }
  return kept;
}

function recordingLine(profile) {
  const analysis = profile?.analysis;
  if (!analysis || !Array.isArray(analysis.genres) || !Array.isArray(analysis.moods) || !Array.isArray(analysis.instruments))
    throw new DomainError("Recording is not analyzed", 404);
  const traits = referenceTraits({
    id: profile.id,
    analysis: { ...analysis, sections: Array.isArray(analysis.sections) ? analysis.sections : [] }
  });
  if (!traits) throw new DomainError("Recording is not analyzed", 404);
  return referenceStyle(traits);
}

function renderDraft(selected, lines, genre, voice, languages, recordingLines) {
  const head = [HEADER, "", "Genre: " + genre];
  if (selected.length) head.push("Voice: " + voice, "Languages: " + languages.join(", "));
  const blocks = [];
  if (selected.length) {
    blocks.push(selected.map((artist, index) => {
      const songs = lines[index].length
        ? "Songs:\n" + lines[index].map(line => "- " + line).join("\n")
        : "Songs: none";
      return "Traits " + (index + 1) + "\nDNA: " + String(artist.dna ?? "") + "\n" + songs;
    }).join("\n\n"));
  }
  if (recordingLines) {
    blocks.push(recordingLines.length
      ? "Recordings:\n" + recordingLines.map(line => "- " + line).join("\n")
      : "Recordings: none");
  }
  return [...head, "", blocks.join("\n\n")].join("\n");
}

function idList(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new DomainError("Choose one to three artists", 400);
  return value;
}

export function draftArtistFromRoster({ artistIds, artists = [], projects = [], recordingIds, recordings = [] } = {}) {
  const rosterIds = idList(artistIds);
  const recordIds = idList(recordingIds);
  const total = rosterIds.length + recordIds.length;
  if (total < 1 || total > 3)
    throw new DomainError("Choose one to three artists", 400);
  const seen = new Set();
  for (const id of rosterIds) {
    if (seen.has(id)) throw new DomainError("Duplicate artist", 400);
    seen.add(id);
  }
  const seenRecordings = new Set();
  for (const id of recordIds) {
    if (seenRecordings.has(id)) throw new DomainError("Duplicate recording", 400);
    seenRecordings.add(id);
  }
  const selected = rosterIds.map(id => {
    const found = artists.find(artist => artist?.id === id);
    if (!found) throw new DomainError("Artist not found", 404);
    return found;
  });
  const chosen = recordIds.map(id => {
    const found = recordings.find(item => item?.id === id);
    if (!found) throw new DomainError("Recording not found", 404);
    return found;
  });
  const genre = uniqueFold([
    ...selected.map(artist => artist.genre),
    ...chosen.flatMap(profile => profile.analysis?.genres || [])
  ]).join(" / ").slice(0, 100);
  const voices = selected.map(artist => text(artist.voice));
  const voice = voices.every(item => item === voices[0]) ? voices[0] : "mixed";
  const language = selected.length ? text(selected[0].language) : "";
  const languages = uniqueFold(selected.map(artist => artist.language));
  const countries = [];
  let countriesTruncated = false;
  for (const artist of selected) {
    for (const code of artist.countries || []) {
      const value = text(code);
      if (!value || countries.includes(value)) continue;
      if (countries.length >= 12) {
        countriesTruncated = true;
        continue;
      }
      countries.push(value);
    }
  }
  const lines = selected.map(artist => newestSongs(projects, artist.id));
  let recordingLines = chosen.map(recordingLine).filter(Boolean);
  const showRecordings = chosen.length > 0 ? recordingLines : null;
  let dna = renderDraft(selected, lines, genre, voice, languages, showRecordings);
  while (dna.length > DNA_LIMIT && (lines.some(group => group.length) || recordingLines.length)) {
    if (lines.some(group => group.length)) {
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (!lines[index].length) continue;
        lines[index].pop();
        break;
      }
    } else recordingLines.pop();
    dna = renderDraft(selected, lines, genre, voice, languages, chosen.length ? recordingLines : null);
  }
  if (dna.length > DNA_LIMIT) dna = dna.slice(0, DNA_LIMIT - 3) + "...";
  const sources = selected.map((artist, index) => ({ id: artist.id, songCount: lines[index].length }));
  const draft = { genre, sources, dna };
  if (selected.length) {
    draft.voice = voice;
    draft.language = language;
    draft.countries = countries;
    draft.countriesTruncated = countriesTruncated;
  }
  return draft;
}
