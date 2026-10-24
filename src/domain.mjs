import { randomUUID } from "node:crypto";
import { COUNTRY_CODES } from "./countries.mjs";

export const TRACK_STAGES = ["idea", "brief", "generated", "review", "approved", "rejected"];
export const RELEASE_STAGES = ["draft", "validated", "approved", "submitting", "submitted", "needs_reconciliation"];
const TRACK_NEXT = {
  idea: ["brief", "rejected"], brief: ["generated", "rejected"],
  generated: ["review", "rejected"], review: ["approved", "rejected"],
  approved: [], rejected: ["brief"]
};
export const RIGHTS_FIELDS = ["commercialRights", "provenanceRecorded", "humanReviewed", "originalityReviewed", "disclosureReviewed"];
export const RELEASE_CHECKS = ["audioUploaded", "artworkUploaded", "creditsVerified", "codesVerified", "aiDisclosuresDone", "distributorRightsConfirmed"];

export class DomainError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
function requiredString(value, name, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new DomainError(name + " must be 1–" + max + " characters");
  return value.trim();
}
export function artistInput(input) {
  const o = input ?? {};
  const name = requiredString(o.name, "Artist name", 80);
  const genre = requiredString(o.genre, "Genre", 100);
  const language = requiredString(o.language || "instrumental", "Language", 40);
  const countries = Array.isArray(o.countries) ? o.countries : [];
  if (countries.length > 12 || countries.some(x => typeof x !== "string" || !COUNTRY_CODES.has(x)))
    throw new DomainError("Choose up to twelve countries from the country list");
  const voice = ["male", "female", "mixed", "instrumental"].includes(o.voice) ? o.voice : "instrumental";
  const dna = requiredString(o.dna, "Artist DNA", 3000);
  return { name, genre, language, countries, voice, dna, identityVerified: o.identityVerified === true };
}
export function trackInput(input) {
  const o = input ?? {};
  const artistId = requiredString(o.artistId, "Artist ID", 80);
  const title = requiredString(o.title, "Title", 140);
  const mode = o.mode === "vocal" ? "vocal" : o.mode === "instrumental" ? "instrumental" : null;
  if (!mode) throw new DomainError("Mode must be vocal or instrumental");
  const concept = requiredString(o.concept, "Concept", 2000);
  const lyrics = typeof o.lyrics === "string" ? o.lyrics.slice(0, 12000) : "";
  return { artistId, title, mode, concept, lyrics, stage: "idea", rights: {} };
}
export function advanceTrack(track, target, rights = {}, audioRef = "") {
  if (!TRACK_NEXT[track.stage]?.includes(target)) throw new DomainError("Invalid track transition: " + track.stage + " → " + target, 409);
  if (target === "approved") {
    const missing = RIGHTS_FIELDS.filter(k => rights[k] !== true);
    if (missing.length) throw new DomainError("Rights checklist incomplete: " + missing.join(", "), 409);
    if (typeof audioRef !== "string" || !/^https:\/\//.test(audioRef) || audioRef.length > 2000)
      throw new DomainError("Approved tracks require a secure audio asset reference", 409);
  }
  return { ...track, stage: target, rights: target === "approved" ? rights : track.rights, audioRef: target === "approved" ? audioRef : track.audioRef };
}
export function releaseInput(input, track) {
  if (!track || track.stage !== "approved") throw new DomainError("Track must be approved before a release can be drafted", 409);
  const o = input ?? {};
  const externalReleaseId = requiredString(o.externalReleaseId, "Distributor release ID", 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(externalReleaseId)) throw new DomainError("Invalid distributor release ID");
  return { trackId: track.id, externalReleaseId, status: "draft", checks: Object.fromEntries(RELEASE_CHECKS.map(k => [k, false])) };
}
export function ensureReleaseReady(release, track, complianceHoldCount = 0) {
  if (!track || track.stage !== "approved") throw new DomainError("Track is not approved", 409);
  const missing = RELEASE_CHECKS.filter(k => release.checks?.[k] !== true);
  if (missing.length) throw new DomainError("Release checklist incomplete: " + missing.join(", "), 409);
  if (complianceHoldCount > 0) throw new DomainError("Compliance watch has unresolved changes; delivery blocked", 409);
}
export function sunoBlueprint(artist, track) {
  if (!artist || !track || artist.id !== track.artistId) throw new DomainError("Artist/track mismatch");
  const instrumental = track.mode === "instrumental";
  return {
    provider: "suno",
    integration: "manual-until-authorized-api-confirmed",
    title: track.title,
    styles: [artist.genre, artist.dna, track.concept, "original composition; coherent arrangement; clean mix"].join(", "),
    lyrics: instrumental ? "" : track.lyrics,
    instrumental,
    vocalGender: instrumental ? null : artist.voice,
    weirdness: 35, styleInfluence: 75, variety: 20,
    exclusions: "unlicensed samples, imitation of identifiable artists, celebrity voices",
    note: "These are Blossom production parameters, NOT an undocumented Suno API request. Confirm model capabilities and commercial rights."
  };
}
