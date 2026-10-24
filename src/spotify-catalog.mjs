import { DomainError } from "./domain.mjs";

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const NOTE = "Spotify does not supply full audio; no measure-level or vocal/instrument analysis has been asserted.";
const trim = (value, max) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";

function releaseYear(date) {
  const year = Number(String(date || "").slice(0, 4));
  return Number.isInteger(year) && year >= 1850 && year <= 2200 ? year : undefined;
}

function artistName(item) {
  return trim(item?.artists?.[0]?.name, 180);
}

export function spotifySearchTrack(track) {
  if (!track || track.is_local || !SPOTIFY_ID.test(track.id || "")) return null;
  const artist = artistName(track);
  const title = trim(track.name, 180);
  if (!artist || !title) return null;
  const album = trim(track.album?.name, 180);
  const year = releaseYear(track.album?.release_date);
  const hit = { id: track.id, artist, title };
  if (album) hit.album = album;
  if (year) hit.releaseYear = year;
  return hit;
}

export function spotifySearchAlbum(album) {
  if (!album || !SPOTIFY_ID.test(album.id || "")) return null;
  const artist = artistName(album);
  const title = trim(album.name, 180);
  const trackCount = album.total_tracks;
  if (!artist || !title || !Number.isInteger(trackCount) || trackCount < 0) return null;
  const year = releaseYear(album.release_date);
  const hit = { id: album.id, artist, title, trackCount };
  if (year) hit.releaseYear = year;
  return hit;
}

function referenceFromTrack(track, { origin, albumName, albumDate }) {
  if (!track || track.is_local || !SPOTIFY_ID.test(track.id || "")) return null;
  const artist = artistName(track);
  const title = trim(track.name, 180);
  if (!artist || !title) return null;
  const year = releaseYear(albumDate || track.album?.release_date);
  const album = trim(albumName || track.album?.name, 180);
  const isrc = origin === "search" ? trim(track.external_ids?.isrc, 32) : "";
  const lead = origin === "album"
    ? "Imported from Spotify album; metadata only, no audio analyzed."
    : "Imported from Spotify search; metadata only, no audio analyzed.";
  const sourceNote = [
    lead,
    album ? "Album: " + album + "." : "",
    isrc ? "ISRC: " + isrc + "." : "",
    "Spotify ID: " + track.id + "."
  ].filter(Boolean).join(" ").slice(0, 800);
  const ref = {
    artist, title, sourceKind: "metadata",
    sourceUrl: "https://open.spotify.com/track/" + track.id, sourceNote
  };
  if (year) ref.releaseYear = year;
  return ref;
}

function summarize(imported, extra = {}) {
  return {
    imported: imported.filter(item => !item.duplicate).length,
    duplicates: imported.filter(item => item.duplicate).length,
    queued: imported.filter(item => !!item.jobId).length,
    profileIds: imported.map(item => item.profileId),
    analysisStatus: "queued_for_verified_audio_or_review",
    note: NOTE,
    skipped: 0,
    ...extra
  };
}

export class SpotifyCatalog {
  constructor(spotify, dna) {
    this.spotify = spotify;
    this.dna = dna;
  }
  async search(query) {
    const found = await this.spotify.searchCatalog(query);
    const trackItems = Array.isArray(found.body?.tracks?.items) ? found.body.tracks.items : [];
    const albumItems = Array.isArray(found.body?.albums?.items) ? found.body.albums.items : [];
    return {
      query: found.query,
      tracks: trackItems.map(spotifySearchTrack).filter(Boolean).slice(0, 8),
      albums: albumItems.map(spotifySearchAlbum).filter(Boolean).slice(0, 8)
    };
  }
  async importTrack(id) {
    const track = await this.spotify.catalogTrack(id);
    const ref = referenceFromTrack(track, { origin: "search" });
    if (!ref) throw new DomainError("Spotify track cannot be imported", 400);
    return summarize(this.dna.importBatch([ref]), { skipped: 0 });
  }
  async importAlbum(id) {
    const album = await this.spotify.catalogAlbum(id);
    const total = album?.total_tracks;
    if (!Number.isInteger(total) || total < 0)
      throw new DomainError("Spotify returned an invalid album", 502);
    if (total > 500)
      throw new DomainError("This album has " + total + " tracks. Import is limited to 500.", 400);
    const raw = [];
    let offset = 0;
    while (offset < total && raw.length < total) {
      const page = await this.spotify.catalogAlbumTracks(id, offset);
      if (!page.items.length) break;
      raw.push(...page.items);
      const next = offset + page.items.length;
      if (next <= offset) break;
      offset = next;
    }
    if (raw.length > total) raw.length = total;
    const refs = [];
    let skipped = 0;
    for (const item of raw) {
      const ref = referenceFromTrack(item, {
        origin: "album", albumName: album.name, albumDate: album.release_date
      });
      if (!ref) { skipped += 1; continue; }
      refs.push(ref);
    }
    const imported = refs.length ? this.dna.importBatch(refs) : [];
    return summarize(imported, { skipped, trackCount: total, truncated: false });
  }
}
