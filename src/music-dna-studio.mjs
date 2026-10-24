import { DomainError } from "./domain.mjs";

const UUID = /^[0-9a-f-]{36}$/i;
function requiredProject(studio, projectId) {
  if (typeof projectId !== "string" || !UUID.test(projectId)) throw new DomainError("Invalid project ID");
  return studio.require(projectId);
}
function asList(items, max = 3) {
  if (!Array.isArray(items) || items.length > max)
    throw new DomainError("Choose at most " + max + " reference profiles");
  const seen = new Set();
  return items.map(item => {
    if (!item || typeof item !== "object" || !UUID.test(item.profileId || ""))
      throw new DomainError("Invalid reference profile");
    const weight = item.weight === undefined ? 50 : item.weight;
    if (!Number.isInteger(weight) || weight < 1 || weight > 100)
      throw new DomainError("Reference weight must be 1–100");
    if (seen.has(item.profileId)) throw new DomainError("Duplicate reference");
    seen.add(item.profileId);
    return { profileId: item.profileId, weight };
  });
}
const trimmed = (text, length = 180) =>
  typeof text === "string" ? text.trim().slice(0, length) : "";
export function referenceTraits(profile) {
  const a = profile.analysis;
  if (!a) return null;
  return {
    referenceId: profile.id,
    analysisVersion: profile.analysisVersion,
    genres: a.genres.slice(0, 12),
    moods: a.moods.slice(0, 12),
    bpm: a.bpm,
    musicalKey: a.musicalKey,
    instruments: a.instruments.slice(0, 16).map(x => ({
      name: trimmed(x.name, 100), technique: trimmed(x.technique),
      timbre: trimmed(x.timbre), role: trimmed(x.role)
    })),
    vocals: a.vocals,
    production: a.production,
    structure: a.sections.slice(0, 24).map(s => ({
      label: trimmed(s.label, 60), techniques: s.techniques.slice(0, 10),
      instruments: s.instruments.slice(0, 10)
    }))
    // No source artist names, lyrics, recordings or copied melodies in generation prompts.
  };
}
export const EXTRACTION_DIRECTION =
  "When artistDna or artistMusicDna is present, the style, vocal direction, tempo, instruments, arrangement and exclusions must follow that artist DNA. When referenceDna is present, apply those selected Music DNA inspirations at their weights. Transfer genre, instruments, tone and phrasing only. Do not copy lyrics, melodies, hooks, or put a source artist name in the song.";

export function artistMusicTraits(profiles) {
  return (profiles || []).map(referenceTraits).filter(Boolean).slice(0, 3);
}

export function artistMusicStyle(traits) {
  return (traits || []).map(referenceStyle).filter(Boolean).join(", ").slice(0, 1200);
}

export function referenceStyle(traits) {
  const parts = [];
  if (traits.genres.length) parts.push(traits.genres.join(", "));
  if (traits.moods.length) parts.push(traits.moods.map(x => x + " mood").join(", "));
  if (traits.bpm) parts.push("approximately " + traits.bpm + " BPM");
  for (const i of traits.instruments.slice(0, 8)) {
    parts.push([i.timbre, i.name, i.technique, i.role].filter(Boolean).join(" "));
  }
  if (traits.vocals?.timbre) parts.push(traits.vocals.timbre + " vocals");
  if (traits.vocals?.delivery) parts.push(traits.vocals.delivery + " phrasing");
  if (traits.production?.texture) parts.push(traits.production.texture + " production");
  if (traits.production?.dynamics) parts.push(traits.production.dynamics);
  return parts.join(", ").slice(0, 1800);
}
export class StudioReferences {
  constructor(store, studio, dna) {
    this.store = store; this.studio = studio; this.dna = dna; this.db = store.db;
    this.db.exec("CREATE TABLE IF NOT EXISTS studio_music_dna_refs (" +
      "project_id TEXT NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE," +
      "profile_id TEXT NOT NULL REFERENCES music_dna_profiles(id) ON DELETE RESTRICT," +
      "weight INTEGER NOT NULL CHECK(weight BETWEEN 1 AND 100)," +
      "ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 2)," +
      "PRIMARY KEY(project_id,profile_id), UNIQUE(project_id,ordinal));");
  }
  list(projectId) {
    requiredProject(this.studio, projectId);
    return this.db.prepare("SELECT profile_id,weight FROM studio_music_dna_refs WHERE project_id=? ORDER BY ordinal")
      .all(projectId).map(row => ({
        profileId: row.profile_id, weight: row.weight, profile: this.dna.get(row.profile_id)
      }));
  }
  set(projectId, items) {
    requiredProject(this.studio, projectId);
    const normalized = asList(items);
    for (const item of normalized) {
      const profile = this.dna.get(item.profileId);
      if (!profile.analysisVersion) throw new DomainError("Analyze the reference before linking it", 409);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM studio_music_dna_refs WHERE project_id=?").run(projectId);
      const insert = this.db.prepare("INSERT INTO studio_music_dna_refs VALUES(?,?,?,?)");
      normalized.forEach((item, ordinal) => insert.run(projectId, item.profileId, item.weight, ordinal));
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.store.audit("references_changed", "studio_project", projectId, { count: normalized.length });
    return this.list(projectId);
  }
  generationContext(projectId) {
    return this.list(projectId).map(item => ({
      weight: item.weight, ...referenceTraits(item.profile)
    }));
  }
  recipeStyle(projectId) {
    return this.generationContext(projectId).map(item => {
      const style = referenceStyle(item);
      return style ? style + " (inspiration weight " + item.weight + "/100)" : "";
    }).filter(Boolean).join(", ").slice(0, 3500);
  }
}
