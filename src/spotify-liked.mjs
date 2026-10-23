import { DomainError } from "./domain.mjs";

const SPOTIFY_ID=/^[A-Za-z0-9]{22}$/;
const trim = (value,max) => typeof value==="string" ? value.replace(/[\u0000-\u001f]/g," ").trim().slice(0,max) : "";
/**
 * Translate private saved-track metadata into a source-linked Blossom reference.
 * No Spotify Web API metadata is evidence of measured audio, tempo, playing
 * technique or vocal activity. A YouTube/Spotify URL isn't a decoded waveform.
 */
export function spotifyLikedReference(saved) {
  const track=saved?.track;
  if(!track||track.is_local||!SPOTIFY_ID.test(track.id||""))return null;
  const artist=trim(track.artists?.[0]?.name,180);
  const title=trim(track.name,180);
  if(!artist||!title)return null;
  const sourceUrl="https://open.spotify.com/track/"+track.id;
  const year=Number(String(track.album?.release_date||"").slice(0,4));
  const releaseYear=Number.isInteger(year)&&year>=1850&&year<=2200?year:undefined;
  const album=trim(track.album?.name,180);
  const isrc=trim(track.external_ids?.isrc,32);
  const savedAt=typeof saved.added_at==="string"&&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(saved.added_at)
      ? saved.added_at.slice(0,10):"";
  const sourceNote=[
    "Imported from Spotify Liked Songs; metadata only, no audio analyzed.",
    album?"Album: "+album+".":"",
    savedAt?"Liked: "+savedAt+".":"",
    isrc?"ISRC: "+isrc+".":"",
    "Spotify ID: "+track.id+"."
  ].filter(Boolean).join(" ").slice(0,800);
  return {artist,title,releaseYear,sourceKind:"metadata",sourceUrl,sourceNote};
}

export class SpotifyLikedImporter {
  constructor(spotify,dna) {
    this.spotify=spotify;
    this.dna=dna;
  }
  async page(options={}) {
    const page=await this.spotify.likedTracksPage(options);
    const tracks=page.items.map(spotifyLikedReference).filter(Boolean);
    return {offset:page.offset,total:page.total,nextOffset:page.nextOffset,
      received:page.items.length,tracks,skipped:page.items.length-tracks.length,
      source:"Spotify Liked Songs",analysisStatus:"metadata_only"};
  }
  async importPage(options={}) {
    const page=await this.page(options);
    if(!page.received)return {...page,imported:0,duplicates:0,queued:0,profileIds:[]};
    if(!page.tracks.length)return {...page,imported:0,duplicates:0,queued:0,profileIds:[]};
    // MusicDNA.importBatch is idempotent by Spotify track URL; a retry after a
    // failed network response must not silently create duplicate profiles.
    const imported=this.dna.importBatch(page.tracks);
    if(imported.length!==page.tracks.length)
      throw new DomainError("Spotify liked import returned an unexpected count",500);
    return {...page,imported:imported.filter(i=>!i.duplicate).length,
      duplicates:imported.filter(i=>i.duplicate).length,
      queued:imported.filter(i=>!!i.jobId).length,
      profileIds:imported.map(i=>i.profileId),
      analysisStatus:"queued_for_verified_audio_or_review",
      note:"Spotify does not supply full audio; no measure-level or vocal/instrument analysis has been asserted."};
  }
}
