import { randomUUID } from "node:crypto";
import { DomainError } from "./domain.mjs";

const timestamp = () => new Date().toISOString();
const toJson = value => JSON.stringify(value);
const fromJson = value => value ? JSON.parse(value) : null;
const UUID = /^[a-f0-9-]{36}$/i;
function text(value, label, max = 300, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string" || (required && !value.trim()) || value.length > max) {
    throw new DomainError(label + " must be text with at most " + max + " characters");
  }
  return value.trim();
}
function list(value, label, max = 32) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new DomainError("Invalid " + label);
  return value.map(v => text(v, label + " item", 120, true));
}
function optionalNumber(value, label, min, max) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new DomainError("Invalid " + label);
  return value;
}
function httpUrl(value) {
  const result = text(value, "Source URL", 2000);
  if (!result) return "";
  let url;
  try { url = new URL(result); } catch { throw new DomainError("Invalid source URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new DomainError("Only public HTTP(S) source URLs are allowed");
  return url.toString();
}
function ensureId(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new DomainError("Invalid ID");
  return value;
}
function latestJobStatus(db, profileId) {
  const row = db.prepare(
    "SELECT status FROM music_dna_jobs WHERE profile_id=? ORDER BY updated_at DESC, rowid DESC LIMIT 1"
  ).get(profileId);
  return row?.status || "";
}
function checkShape(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("Invalid " + label);
  return value;
}
// Bar-level observations can be absent until actual audio is decoded. Keeping
// these slots explicit prevents a source-only analysis from claiming it heard
// instruments or vocal details at exact positions in the recording.
const BAR_STATUS = new Set(["not_analyzed", "source_inferred", "audio_observed"]);
const BAR_EVIDENCE = new Set(["none", "editorial", "audio", "human_verified"]);
function barText(value, label, max = 250) {
  return text(value, label, max);
}
function barEvidence(value) {
  if(value == null)return "none";
  if(typeof value!=="string"||!BAR_EVIDENCE.has(value))
    throw new DomainError("Invalid bar observation evidence");
  return value;
}
function barInstrument(input) {
  checkShape(input,"bar instrument");
  return { name:text(input.name,"Bar instrument",100,true),
    activity:barText(input.activity,"Instrument activity",380),
    role:barText(input.role,"Instrument role",150),
    technique:barText(input.technique,"Instrument technique",250),
    rhythm:barText(input.rhythm,"Instrument rhythm",250),
    articulation:barText(input.articulation,"Instrument articulation",200),
    pitchRegister:barText(input.pitchRegister,"Instrument register",120),
    timbre:barText(input.timbre,"Instrument timbre",200),
    stereo:barText(input.stereo,"Instrument stereo",120),
    effects:list(input.effects,"Instrument effects",12),
    evidence:barEvidence(input.evidence),
    confidence:optionalNumber(input.confidence,"instrument bar confidence",0,1) };
}
function barVocal(input) {
  checkShape(input,"bar vocal event");
  return { singer:barText(input.singer,"Vocal singer",100),
    layer:barText(input.layer,"Vocal layer",100),
    activity:barText(input.activity,"Vocal activity",380),
    delivery:barText(input.delivery,"Vocal delivery",250),
    phrasing:barText(input.phrasing,"Vocal phrasing",250),
    articulation:barText(input.articulation,"Vocal articulation",200),
    register:barText(input.register,"Vocal register",120),
    dynamics:barText(input.dynamics,"Vocal dynamics",200),
    harmonies:barText(input.harmonies,"Vocal harmony",200),
    effects:list(input.effects,"Vocal effects",12),
    evidence:barEvidence(input.evidence),
    confidence:optionalNumber(input.confidence,"vocal bar confidence",0,1) };
}
function barBlocksInput(value, durationMs) {
  if(value==null)return [];
  if(!Array.isArray(value)||value.length>512)throw new DomainError("Invalid barBlocks (max 512)");
  let lastEnd=0,lastTime=-1;
  return value.map(block=>{
    checkShape(block,"bar block");
    const startBar=block.startBar,endBar=block.endBar;
    if(!Number.isInteger(startBar)||!Number.isInteger(endBar)||
       startBar<1||endBar<startBar||endBar-startBar>=64||startBar<=lastEnd||endBar>8192)
      throw new DomainError("Bar blocks must be ordered, non-overlapping and cover at most 64 bars each");
    lastEnd=endBar;
    const startMs=optionalNumber(block.startMs,"bar block start",0,86_400_000);
    const endMs=optionalNumber(block.endMs,"bar block end",1,86_400_000);
    if((startMs==null)!==(endMs==null)||(startMs!=null&&
       (endMs<=startMs||startMs<lastTime||(durationMs!=null&&endMs>durationMs))))
      throw new DomainError("Invalid bar block audio boundaries");
    if(endMs!=null)lastTime=endMs;
    const status=block.status||"not_analyzed";
    if(!BAR_STATUS.has(status))throw new DomainError("Invalid bar block status");
    const instruments=block.instruments==null?[]:block.instruments;
    const vocals=block.vocals==null?[]:block.vocals;
    if(!Array.isArray(instruments)||instruments.length>24||!Array.isArray(vocals)||vocals.length>12)
      throw new DomainError("Too many bar-level instrument or vocal events");
    const rhythm=block.rhythm==null?{}:checkShape(block.rhythm,"bar rhythm");
    const harmony=block.harmony==null?{}:checkShape(block.harmony,"bar harmony");
    const production=block.production==null?{}:checkShape(block.production,"bar production");
    const normalized={
      startBar,endBar,startMs,endMs,status,
      section:barText(block.section,"Bar section",100),
      instruments:instruments.map(barInstrument),
      vocals:vocals.map(barVocal),
      rhythm: {
        kick:barText(rhythm.kick,"Kick pattern",200),
        snare:barText(rhythm.snare,"Snare pattern",200),
        hiHat:barText(rhythm.hiHat,"Hi-hat pattern",200),
        percussion:barText(rhythm.percussion,"Percussion",200),
        groove:barText(rhythm.groove,"Groove",250),
        syncopation:barText(rhythm.syncopation,"Syncopation",200),
        fill:barText(rhythm.fill,"Drum fill",200)
      },
      harmony:{
        chords:list(harmony.chords,"Bar chords",16),
        movement:barText(harmony.movement,"Harmonic movement",250)
      },
      production:{
        dynamics:barText(production.dynamics,"Bar dynamics",250),
        spatial:barText(production.spatial,"Bar spatial production",250),
        transitions:barText(production.transitions,"Bar transitions",250),
        processing:list(production.processing,"Bar processing",16)
      },
      notes:barText(block.notes,"Bar notes",1000),
      confidence:optionalNumber(block.confidence,"bar confidence",0,1)
    };
    // No performance claims may be saved in a deliberately unanalyzed block.
    if(status==="not_analyzed"&&(instruments.length||vocals.length||
       Object.values(normalized.rhythm).some(Boolean)||normalized.harmony.chords.length||
       normalized.harmony.movement||Object.values(normalized.production).some(v=>
         Array.isArray(v)?v.length:Boolean(v))))
      throw new DomainError("A not_analyzed bar block cannot contain performance observations");
    return normalized;
  });
}
function analysisInput(incoming) {
  const data = checkShape(incoming, "DNA analysis");
  const genres = list(data.genres, "genres");
  const moods = list(data.moods, "moods");
  const instruments = Array.isArray(data.instruments) ? data.instruments : [];
  if (instruments.length > 48) throw new DomainError("Too many instruments");
  const normalizedInstruments = instruments.map(instrument => {
    checkShape(instrument, "instrument");
    return { name: text(instrument.name, "Instrument name", 100, true),
      technique: text(instrument.technique, "Playing technique", 200),
      timbre: text(instrument.timbre, "Instrument timbre", 200),
      role: text(instrument.role, "Instrument role", 140),
      confidence: optionalNumber(instrument.confidence, "instrument confidence", 0, 1) };
  });
  const vocals = data.vocals == null ? {} : checkShape(data.vocals, "vocals");
  const production = data.production == null ? {} : checkShape(data.production, "production");
  const sections = Array.isArray(data.sections) ? data.sections : [];
  if (sections.length > 256) throw new DomainError("Too many sections");
  let previousStart = -1;
  const normalizedSections = sections.map(section => {
    checkShape(section, "section");
    const startMs = optionalNumber(section.startMs, "section start", 0, 86_400_000);
    const endMs = optionalNumber(section.endMs, "section end", 1, 86_400_000);
    if (startMs == null || endMs == null || endMs <= startMs || startMs < previousStart)
      throw new DomainError("Sections must have ordered, valid time boundaries");
    previousStart = startMs;
    return { startMs, endMs, label: text(section.label, "Section label", 100, true),
      instruments: list(section.instruments, "section instruments", 48),
      techniques: list(section.techniques, "section techniques", 48),
      notes: text(section.notes, "Section notes", 1200),
      confidence: optionalNumber(section.confidence, "section confidence", 0, 1) };
  });
  const durationMs = optionalNumber(data.durationMs, "duration", 1000, 86_400_000);
  if (durationMs != null && normalizedSections.some(s => s.endMs > durationMs))
    throw new DomainError("Section extends beyond recording duration");
  const barBlocks=barBlocksInput(data.barBlocks,durationMs);
  const normalized = {
    schemaVersion: barBlocks.length ? 2 : 1, bpm: optionalNumber(data.bpm, "BPM", 20, 350),
    musicalKey: text(data.musicalKey, "Musical key", 32),
    timeSignature: text(data.timeSignature, "Time signature", 20),
    durationMs, genres, moods, instruments: normalizedInstruments,
    vocals: {
      type: text(vocals.type, "Vocal type", 80),
      register: text(vocals.register, "Vocal register", 100),
      timbre: text(vocals.timbre, "Vocal timbre", 250),
      delivery: text(vocals.delivery, "Vocal delivery", 250),
      harmonies: text(vocals.harmonies, "Harmonies", 250)
    },
    production: {
      era: text(production.era, "Production era", 100),
      texture: text(production.texture, "Production texture", 400),
      stereo: text(production.stereo, "Stereo image", 300),
      dynamics: text(production.dynamics, "Dynamics", 300),
      effects: list(production.effects, "effects")
    },
    sections: normalizedSections,
    barBlocks,
    summary: text(data.summary, "Summary", 3000),
    analysisMethod: text(data.analysisMethod, "Analysis method", 100, true),
    analyzer: text(data.analyzer, "Analyzer", 160, true),
    confidence: optionalNumber(data.confidence, "confidence", 0, 1),
    analyzedAt: timestamp(),
    measurements: data.measurements == null ? null : (() => {
      const m = checkShape(data.measurements, "audio measurements");
      return {
        sampleRate: optionalNumber(m.sampleRate, "source sample rate", 8000, 384000),
        channels: optionalNumber(m.channels, "channels", 1, 16),
        codec: text(m.codec, "codec", 80),
        analysisSampleRate: optionalNumber(m.analysisSampleRate, "analysis sample rate", 8000, 384000),
        decodedSamples: optionalNumber(m.decodedSamples, "sample count", 1, 2_000_000_000),
        peakDbfs: optionalNumber(m.peakDbfs, "peak level", -120, 0),
        rmsDbfs: optionalNumber(m.rmsDbfs, "RMS level", -120, 0),
        silenceFraction: optionalNumber(m.silenceFraction, "silence fraction", 0, 1)
      };
    })()
  };
  if (toJson(normalized).length > 100_000) throw new DomainError("Analysis exceeds size limit", 413);
  return normalized;
}
function searchable(profile, analysis) {
  return [profile.artist, profile.title, analysis.summary, ...analysis.genres, ...analysis.moods,
    ...analysis.instruments.flatMap(i => [i.name, i.technique, i.timbre, i.role]),
    ...Object.values(analysis.vocals), analysis.production.era, analysis.production.texture,
    analysis.production.stereo, analysis.production.dynamics, ...analysis.production.effects,
    ...analysis.sections.flatMap(s => [s.label, s.notes, ...s.instruments, ...s.techniques]),
    ...(analysis.barBlocks||[]).flatMap(b => [b.section,b.notes,b.harmony.movement,...b.harmony.chords,
      ...Object.values(b.rhythm), ...Object.values(b.production).flat(),
      ...b.instruments.flatMap(i=>[i.name,i.activity,i.role,i.technique,i.rhythm,i.articulation,i.timbre]),
      ...b.vocals.flatMap(v=>[v.singer,v.layer,v.activity,v.delivery,v.phrasing,v.harmonies])])]
    .filter(Boolean).join(" ");
}
function fullTextTerms(value) {
  const words = text(value, "Search query", 180).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return words.slice(0, 12).map(word => '"' + word + '"').join(" AND ");
}
function searchClauses(options) {
  checkShape(options, "search options");
  const clauses = [], bindings = [];
  const term = fullTextTerms(options.q || "");
  if (term) { clauses.push("music_dna_fts MATCH ?"); bindings.push(term); }
  for (const [kind, value] of [["genre", options.genre], ["mood", options.mood],
    ["instrument", options.instrument], ["vocal", options.vocal]]) {
    if (value) {
      clauses.push("EXISTS (SELECT 1 FROM music_dna_features f WHERE f.profile_id=p.id AND f.kind=? AND f.value=?)");
      bindings.push(kind, text(value, kind, 120).toLocaleLowerCase());
    }
  }
  return { clauses, bindings, term };
}

export class MusicDNA {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS music_dna_profiles (" +
        "id TEXT PRIMARY KEY, artist TEXT NOT NULL, title TEXT NOT NULL, release_year INTEGER," +
        "source_url TEXT NOT NULL DEFAULT '', source_kind TEXT NOT NULL," +
        "recording_sha256 TEXT NOT NULL DEFAULT '', source_note TEXT NOT NULL DEFAULT ''," +
        "current_analysis_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);" +
      "CREATE UNIQUE INDEX IF NOT EXISTS music_dna_source_unique ON music_dna_profiles(source_url) WHERE source_url != '';" +
      "CREATE UNIQUE INDEX IF NOT EXISTS music_dna_hash_unique ON music_dna_profiles(recording_sha256) WHERE recording_sha256 != '';" +
      "CREATE INDEX IF NOT EXISTS music_dna_artist_title ON music_dna_profiles(artist COLLATE NOCASE, title COLLATE NOCASE);" +
      "CREATE TABLE IF NOT EXISTS music_dna_analyses (" +
        "id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES music_dna_profiles(id) ON DELETE CASCADE," +
        "version INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(profile_id,version));" +
      "CREATE TABLE IF NOT EXISTS music_dna_sections (" +
        "id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES music_dna_analyses(id) ON DELETE CASCADE," +
        "ordinal INTEGER NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL," +
        "label TEXT NOT NULL, instruments TEXT NOT NULL, techniques TEXT NOT NULL, notes TEXT NOT NULL);" +
      "CREATE INDEX IF NOT EXISTS music_dna_section_timeline ON music_dna_sections(analysis_id,start_ms);" +
      "CREATE TABLE IF NOT EXISTS music_dna_features (" +
        "profile_id TEXT NOT NULL REFERENCES music_dna_profiles(id) ON DELETE CASCADE," +
        "kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(profile_id,kind,value));" +
      "CREATE INDEX IF NOT EXISTS music_dna_feature_lookup ON music_dna_features(kind,value,profile_id);" +
      "CREATE VIRTUAL TABLE IF NOT EXISTS music_dna_fts USING fts5(profile_id UNINDEXED, artist, title, description, tokenize='unicode61');" +
      "CREATE TABLE IF NOT EXISTS music_dna_jobs (" +
        "id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES music_dna_profiles(id)," +
        "status TEXT NOT NULL, worker TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0," +
        "leased_until TEXT, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);" +
      "CREATE INDEX IF NOT EXISTS music_dna_jobs_status ON music_dna_jobs(status,created_at);" +
      "CREATE TABLE IF NOT EXISTS music_dna_audio_assets (" +
        "profile_id TEXT PRIMARY KEY REFERENCES music_dna_profiles(id) ON DELETE CASCADE," +
        "filename TEXT NOT NULL, mime TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE," +
        "byte_size INTEGER NOT NULL, rights_confirmed INTEGER NOT NULL DEFAULT 0," +
        "created_at TEXT NOT NULL);"
    );
    const jobColumns = this.db.prepare("PRAGMA table_info(music_dna_jobs)").all();
    if (!jobColumns.some(column => column.name === "progress"))
      this.db.exec("ALTER TABLE music_dna_jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0");
    // Backfill old metadata-only queue jobs already satisfied by a separate
    // verified source audit submitted through MCP. Authorized local audio jobs
    // remain pending: a source-only audit must NOT stand in for measured audio.
    this.db.prepare(`UPDATE music_dna_jobs SET status='completed',worker='source-audit',
      error='',leased_until=NULL,updated_at=?
      WHERE status='queued' AND EXISTS
        (SELECT 1 FROM music_dna_profiles p
          WHERE p.id=music_dna_jobs.profile_id AND p.current_analysis_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM music_dna_audio_assets a
          WHERE a.profile_id=music_dna_jobs.profile_id)`).run(timestamp());
  }
  create(input = {}) {
    checkShape(input, "reference");
    const artist = text(input.artist, "Artist", 180, true);
    const title = text(input.title, "Title", 180, true);
    const sourceUrl = httpUrl(input.sourceUrl);
    const sourceKind = text(input.sourceKind || "metadata", "Source kind", 50);
    if (!["metadata", "local-audio", "licensed-audio", "manual"].includes(sourceKind))
      throw new DomainError("Invalid source kind");
    const hash = text(input.recordingSha256, "Recording SHA-256", 64);
    if (hash && !/^[0-9a-f]{64}$/i.test(hash)) throw new DomainError("Invalid recording SHA-256");
    const releaseYear = optionalNumber(input.releaseYear, "release year", 1850, 2200);
    if (releaseYear != null && !Number.isInteger(releaseYear)) throw new DomainError("Invalid release year");
    let existing;
    if (hash) existing = this.db.prepare("SELECT id FROM music_dna_profiles WHERE recording_sha256=?").get(hash.toLowerCase());
    if (!existing && sourceUrl) existing = this.db.prepare("SELECT id FROM music_dna_profiles WHERE source_url=?").get(sourceUrl);
    if (existing) return { ...this.get(existing.id), duplicate: true };
    const id = randomUUID(), created = timestamp();
    this.db.prepare(
      "INSERT INTO music_dna_profiles(id,artist,title,release_year,source_url,source_kind,recording_sha256,source_note,created_at,updated_at)" +
      " VALUES(?,?,?,?,?,?,?,?,?,?)"
    ).run(id, artist, title, releaseYear, sourceUrl, sourceKind, hash.toLowerCase(),
      text(input.sourceNote, "Source note", 800), created, created);
    this.db.prepare("INSERT INTO music_dna_fts(profile_id,artist,title,description) VALUES(?,?,?,?)")
      .run(id, artist, title, "");
    this.store.audit("created", "music_dna_reference", id, { artist, title });
    return this.get(id);
  }
  get(id) {
    ensureId(id);
    const p = this.db.prepare("SELECT * FROM music_dna_profiles WHERE id=?").get(id);
    if (!p) throw new DomainError("Music DNA reference not found", 404);
    const analysis = p.current_analysis_id ?
      this.db.prepare("SELECT id,version,payload FROM music_dna_analyses WHERE id=?").get(p.current_analysis_id) : null;
    return { id: p.id, artist: p.artist, title: p.title, releaseYear: p.release_year,
      sourceUrl: p.source_url, sourceKind: p.source_kind, recordingSha256: p.recording_sha256,
      sourceNote: p.source_note, createdAt: p.created_at, updatedAt: p.updated_at,
      analysisVersion: analysis?.version || 0, analysis: analysis ? fromJson(analysis.payload) : null,
      jobStatus: latestJobStatus(this.db, p.id) };
  }
  versions(profileId) {
    this.get(profileId);
    return this.db.prepare("SELECT id,version,created_at FROM music_dna_analyses WHERE profile_id=? ORDER BY version DESC")
      .all(profileId).map(row => ({ id: row.id, version: row.version, createdAt: row.created_at }));
  }
  saveAnalysis(profileId, input) {
    const profile = this.get(profileId), data = analysisInput(input), analysisId = randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const version = (this.db.prepare("SELECT COALESCE(MAX(version),0)+1 AS n FROM music_dna_analyses WHERE profile_id=?")
        .get(profileId).n);
      this.db.prepare("INSERT INTO music_dna_analyses VALUES(?,?,?,?,?)")
        .run(analysisId, profileId, version, toJson(data), timestamp());
      const insert = this.db.prepare("INSERT INTO music_dna_sections VALUES(?,?,?,?,?,?,?,?,?)");
      data.sections.forEach((s, ordinal) => insert.run(randomUUID(), analysisId, ordinal, s.startMs,
        s.endMs, s.label, toJson(s.instruments), toJson(s.techniques), s.notes));
      this.db.prepare("UPDATE music_dna_profiles SET current_analysis_id=?,updated_at=? WHERE id=?")
        .run(analysisId, timestamp(), profileId);
      // A metadata-only research task is satisfied by a recorded, auditable
      // Music DNA analysis. Don't leave it counted as waiting indefinitely.
      // Crucially, don't close jobs waiting for permitted attached audio.
      this.db.prepare(`UPDATE music_dna_jobs SET status='completed',worker='source-audit',
        error='',leased_until=NULL,updated_at=?
        WHERE profile_id=? AND status='queued'
          AND NOT EXISTS (SELECT 1 FROM music_dna_audio_assets a
            WHERE a.profile_id=music_dna_jobs.profile_id)`).run(timestamp(),profileId);
      this.db.prepare("DELETE FROM music_dna_fts WHERE profile_id=?").run(profileId);
      this.db.prepare("INSERT INTO music_dna_fts(profile_id,artist,title,description) VALUES(?,?,?,?)")
        .run(profileId, profile.artist, profile.title, searchable(profile, data));
      this.db.prepare("DELETE FROM music_dna_features WHERE profile_id=?").run(profileId);
      const feature = this.db.prepare("INSERT OR IGNORE INTO music_dna_features VALUES(?,?,?)");
      for (const genre of data.genres) feature.run(profileId, "genre", genre.toLocaleLowerCase());
      for (const mood of data.moods) feature.run(profileId, "mood", mood.toLocaleLowerCase());
      for (const instrument of data.instruments) feature.run(profileId, "instrument", instrument.name.toLocaleLowerCase());
      if (data.vocals.type) feature.run(profileId, "vocal", data.vocals.type.toLocaleLowerCase());
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.store.audit("analysis_saved", "music_dna_reference", profileId, { analysisId, analyzer: data.analyzer });
    return this.get(profileId);
  }
  search(options = {}) {
    const limit = options.limit == null ? 20 : optionalNumber(options.limit, "limit", 1, 100);
    const offset = options.offset == null ? 0 : optionalNumber(options.offset, "offset", 0, 10_000_000);
    if (!Number.isInteger(limit) || !Number.isInteger(offset)) throw new DomainError("Invalid pagination");
    const { clauses, bindings, term } = searchClauses(options);
    const sql = "SELECT p.id,p.artist,p.title,p.release_year,p.source_kind,p.updated_at," +
      "a.version,a.payload," +
      "(SELECT j.status FROM music_dna_jobs j WHERE j.profile_id=p.id " +
      "ORDER BY j.updated_at DESC, j.rowid DESC LIMIT 1) AS job_status " +
      "FROM music_dna_profiles p " +
      "JOIN music_dna_fts ON music_dna_fts.profile_id=p.id " +
      "LEFT JOIN music_dna_analyses a ON a.id=p.current_analysis_id " +
      (clauses.length ? "WHERE " + clauses.join(" AND ") + " " : "") +
      "ORDER BY " + (term ? "bm25(music_dna_fts), " : "") + "p.updated_at DESC LIMIT ? OFFSET ?";
    return this.db.prepare(sql).all(...bindings, limit, offset).map(row => ({
      id: row.id, artist: row.artist, title: row.title, releaseYear: row.release_year,
      sourceKind: row.source_kind, updatedAt: row.updated_at,
      analysisVersion: row.version || 0, analysis: row.payload ? fromJson(row.payload) : null,
      jobStatus: row.job_status || ""
    }));
  }
  count(options = {}) {
    const { clauses, bindings } = searchClauses(options);
    const sql = "SELECT COUNT(*) AS n FROM music_dna_profiles p " +
      "JOIN music_dna_fts ON music_dna_fts.profile_id=p.id" +
      (clauses.length ? " WHERE " + clauses.join(" AND ") : "");
    return this.db.prepare(sql).get(...bindings).n;
  }
  importBatch(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 500)
      throw new DomainError("Import batch must contain 1–500 references");
    const result = [];
    for (const item of items) {
      const profile = this.create(item);
      const pending = this.db.prepare(
        "SELECT id FROM music_dna_jobs WHERE profile_id=? AND status IN ('queued','running')").get(profile.id);
      let jobId = pending?.id;
      if (!jobId && !profile.analysisVersion) {
        jobId = randomUUID();
        this.db.prepare("INSERT INTO music_dna_jobs(id,profile_id,status,created_at,updated_at) VALUES(?,?,?,?,?)")
          .run(jobId, profile.id, "queued", timestamp(), timestamp());
      }
      result.push({ profileId: profile.id, jobId: jobId || null, duplicate: !!profile.duplicate });
    }
    return result;
  }
  jobCounts() {
    const result={total:0,queued:0,running:0,completed:0,failed:0,
      waitingForEvidence:0,readyForAudio:0};
    for(const row of this.db.prepare(
      "SELECT status,COUNT(*) AS n FROM music_dna_jobs GROUP BY status").all()){
      result.total+=row.n;
      if(Object.hasOwn(result,row.status))result[row.status]=row.n;
    }
    const queue=this.db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN a.profile_id IS NULL THEN 1 ELSE 0 END),0)
        AS waitingForEvidence,
      COALESCE(SUM(CASE WHEN a.profile_id IS NOT NULL AND a.rights_confirmed=1
        THEN 1 ELSE 0 END),0) AS readyForAudio
      FROM music_dna_jobs j
      LEFT JOIN music_dna_audio_assets a ON a.profile_id=j.profile_id
      WHERE j.status='queued'`).get();
    result.waitingForEvidence=queue.waitingForEvidence;
    result.readyForAudio=queue.readyForAudio;
    return result;
  }
  jobs(status = "", limit = 50) {
    if (status && !["queued", "running", "completed", "failed"].includes(status))
      throw new DomainError("Invalid job status");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new DomainError("Invalid limit");
    const columns = "SELECT j.id,j.profile_id,j.status,j.worker,j.attempts,j.error,j.progress,j.created_at,j.updated_at,p.artist,p.title," +
      "(EXISTS(SELECT 1 FROM music_dna_audio_assets a WHERE a.profile_id=j.profile_id)) AS has_audio " +
      "FROM music_dna_jobs j LEFT JOIN music_dna_profiles p ON p.id=j.profile_id";
    const rows = status
      ? this.db.prepare(columns + " WHERE j.status=? ORDER BY j.created_at LIMIT ?").all(status, limit)
      : this.db.prepare(columns + " ORDER BY j.created_at DESC LIMIT ?").all(limit);
    return rows.map(r => ({ id:r.id, profileId:r.profile_id, status:r.status, worker:r.worker,
      attempts:r.attempts, error:r.error, createdAt:r.created_at, updatedAt:r.updated_at,
      artist:r.artist || "", title:r.title || "", hasAudio: r.has_audio === 1,
      progress: Number.isInteger(r.progress) ? r.progress : 0 }));
  }
  audioForProfile(profileId) {
    ensureId(profileId);
    const row = this.db.prepare("SELECT * FROM music_dna_audio_assets WHERE profile_id=?").get(profileId);
    return row ? { profileId: row.profile_id, filename: row.filename, mime: row.mime,
      sha256: row.sha256, byteSize: row.byte_size, rightsConfirmed: !!row.rights_confirmed } : null;
  }
  attachAudio(profileId, info = {}) {
    const profile = this.get(profileId);
    if (!info || typeof info !== "object" || info.rightsConfirmed !== true)
      throw new DomainError("Confirm that you are permitted to process this reference audio", 403);
    const sha256 = text(info.sha256, "Audio hash", 64, true).toLowerCase();
    const filename = text(info.filename, "Audio filename", 80, true);
    if (!/^[a-f0-9]{64}$/.test(sha256) || !/^[0-9a-f-]{36}\.(mp3|wav)$/.test(filename))
      throw new DomainError("Invalid audio identifier");
    if (!["audio/mpeg", "audio/wav"].includes(info.mime) ||
      !Number.isInteger(info.byteSize) || info.byteSize < 128 || info.byteSize > 40 * 1024 * 1024)
      throw new DomainError("Invalid audio metadata");
    const existing = this.audioForProfile(profileId);
    if (existing) {
      if (existing.sha256 !== sha256) throw new DomainError("Reference already has audio; create a new recording reference", 409);
      return { ...existing, duplicate: true };
    }
    const other = this.db.prepare("SELECT id FROM music_dna_profiles WHERE recording_sha256=? AND id<>?")
      .get(sha256, profileId);
    if (other || (profile.recordingSha256 && profile.recordingSha256 !== sha256))
      throw new DomainError("Recording fingerprint is already assigned to another reference", 409);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE music_dna_profiles SET recording_sha256=?, source_kind='local-audio',updated_at=? WHERE id=?")
        .run(sha256, timestamp(), profileId);
      this.db.prepare("INSERT INTO music_dna_audio_assets VALUES(?,?,?,?,?,?,?)")
        .run(profileId, filename, info.mime, sha256, info.byteSize, 1, timestamp());
      const pending = this.db.prepare(
        "SELECT id FROM music_dna_jobs WHERE profile_id=? AND status IN ('queued','running')").get(profileId);
      if (!pending) this.db.prepare(
        "INSERT INTO music_dna_jobs(id,profile_id,status,created_at,updated_at) VALUES(?,?,?,?,?)")
        .run(randomUUID(), profileId, "queued", timestamp(), timestamp());
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.store.audit("audio_attached", "music_dna_reference", profileId, { sha256, byteSize: info.byteSize });
    return this.audioForProfile(profileId);
  }
  claimJob(worker = "blossom-local", { audioOnly = false, metadataOnly = false } = {}) {
    worker = text(worker, "Worker", 100, true);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const queued = this.db.prepare(
        "SELECT j.id,j.profile_id FROM music_dna_jobs j " +
        (audioOnly ? "JOIN music_dna_audio_assets audio ON audio.profile_id=j.profile_id " : "") +
        (metadataOnly && !audioOnly ? "LEFT JOIN music_dna_audio_assets audio ON audio.profile_id=j.profile_id " : "") +
        "WHERE (j.status='queued' OR (j.status='running' AND j.leased_until < ?)) " +
        (metadataOnly && !audioOnly ? "AND audio.profile_id IS NULL " : "") +
        "AND j.attempts < 3 ORDER BY j.created_at LIMIT 1").get(timestamp());
      if (!queued) { this.db.exec("COMMIT"); return null; }
      const leased = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      this.db.prepare("UPDATE music_dna_jobs SET status='running',worker=?,attempts=attempts+1,leased_until=?,updated_at=? WHERE id=?")
        .run(worker, leased, timestamp(), queued.id);
      this.db.exec("COMMIT");
      return { jobId: queued.id, profile: this.get(queued.profile_id), leaseUntil: leased };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  setJobProgress(jobId, percent) {
    ensureId(jobId);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100)
      throw new DomainError("Invalid job progress");
    this.db.prepare("UPDATE music_dna_jobs SET progress=?,updated_at=? WHERE id=? AND status='running'")
      .run(percent, timestamp(), jobId);
  }
  releaseJob(jobId) {
    ensureId(jobId);
    this.db.prepare(
      "UPDATE music_dna_jobs SET status='queued',worker='',attempts=MAX(attempts-1,0),progress=0,leased_until=NULL,updated_at=? " +
      "WHERE id=? AND status='running'").run(timestamp(), jobId);
  }
  requeueCatalogAnalysis(worker = "chatgpt") {
    worker = text(worker, "Worker", 100, true);
    const now = timestamp();
    const interrupted = this.db.prepare(
      "UPDATE music_dna_jobs SET status='queued',worker='',progress=0,leased_until=NULL,updated_at=? " +
      "WHERE status='running' AND worker=? AND attempts<3"
    ).run(now, worker);
    const failed = this.db.prepare(
      "UPDATE music_dna_jobs SET status='queued',worker='',error='',progress=0,leased_until=NULL,updated_at=? " +
      "WHERE id IN (SELECT j.id FROM music_dna_jobs j " +
      "JOIN music_dna_profiles p ON p.id=j.profile_id " +
      "LEFT JOIN music_dna_audio_assets audio ON audio.profile_id=j.profile_id " +
      "WHERE j.status='failed' AND p.current_analysis_id IS NULL AND audio.profile_id IS NULL AND j.attempts<3)"
    ).run(now);
    return { interrupted: interrupted.changes, failed: failed.changes };
  }
  completeJob(jobId, analysis, error = "") {
    ensureId(jobId);
    const job = this.db.prepare("SELECT * FROM music_dna_jobs WHERE id=?").get(jobId);
    if (!job) throw new DomainError("Job not found", 404);
    if (job.status !== "running") throw new DomainError("Job must be claimed before completion", 409);
    let profile;
    if (!error) profile = this.saveAnalysis(job.profile_id, analysis);
    this.db.prepare("UPDATE music_dna_jobs SET status=?,error=?,leased_until=NULL,updated_at=? WHERE id=?")
      .run(error ? "failed" : "completed", text(error, "Job error", 800), timestamp(), jobId);
    return { jobId, status: error ? "failed" : "completed", profile: profile || null };
  }
}
