-- Blossom Music DNA: PostgreSQL scale-out schema.
-- Prerequisites: PostgreSQL 16+, pgvector extension installed on the server.
-- This is a target schema, NOT an automatic conversion of the current SQLite store.
-- Apply to a dedicated database, run the verified backfill, then switch over.
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS music_dna_profiles (
  id uuid PRIMARY KEY,
  artist text NOT NULL,
  title text NOT NULL,
  release_year integer,
  source_url text NOT NULL DEFAULT '',
  source_kind text NOT NULL,
  recording_sha256 text NOT NULL DEFAULT '',
  source_note text NOT NULL DEFAULT '',
  current_analysis_id uuid,
  bpm numeric(6,2),
  genres text[] NOT NULL DEFAULT '{}',
  moods text[] NOT NULL DEFAULT '{}',
  instruments text[] NOT NULL DEFAULT '{}',
  vocal_type text NOT NULL DEFAULT '',
  search_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(artist,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(search_text,'')), 'B')
  ) STORED,
  CONSTRAINT music_dna_bpm_range CHECK (bpm IS NULL OR bpm BETWEEN 20 AND 350),
  CONSTRAINT music_dna_hash_format CHECK (recording_sha256 = '' OR recording_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS music_dna_unique_source
  ON music_dna_profiles (source_url) WHERE source_url <> '';
CREATE UNIQUE INDEX IF NOT EXISTS music_dna_unique_recording
  ON music_dna_profiles (recording_sha256) WHERE recording_sha256 <> '';
CREATE INDEX IF NOT EXISTS music_dna_name_lookup
  ON music_dna_profiles (lower(artist), lower(title));
CREATE INDEX IF NOT EXISTS music_dna_search_gin
  ON music_dna_profiles USING gin (search_vector);
CREATE INDEX IF NOT EXISTS music_dna_genres_gin
  ON music_dna_profiles USING gin (genres);
CREATE INDEX IF NOT EXISTS music_dna_moods_gin
  ON music_dna_profiles USING gin (moods);
CREATE INDEX IF NOT EXISTS music_dna_instruments_gin
  ON music_dna_profiles USING gin (instruments);
CREATE INDEX IF NOT EXISTS music_dna_bpm_btree ON music_dna_profiles (bpm);
CREATE INDEX IF NOT EXISTS music_dna_artist_fuzzy
  ON music_dna_profiles USING gin (artist gin_trgm_ops);
CREATE INDEX IF NOT EXISTS music_dna_title_fuzzy
  ON music_dna_profiles USING gin (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS music_dna_analyses (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES music_dna_profiles(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL,
  analyzer text NOT NULL,
  analysis_method text NOT NULL,
  confidence numeric(4,3),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id,version)
);
CREATE INDEX IF NOT EXISTS music_dna_analysis_by_profile
  ON music_dna_analyses (profile_id, version DESC);
CREATE INDEX IF NOT EXISTS music_dna_analysis_json_gin
  ON music_dna_analyses USING gin (payload jsonb_path_ops);

CREATE TABLE IF NOT EXISTS music_dna_sections (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES music_dna_analyses(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  end_ms integer NOT NULL,
  label text NOT NULL,
  instruments text[] NOT NULL DEFAULT '{}',
  techniques text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  CHECK (end_ms > start_ms),
  UNIQUE(analysis_id, ordinal)
);
CREATE INDEX IF NOT EXISTS music_dna_section_timeline
  ON music_dna_sections (analysis_id,start_ms);
CREATE INDEX IF NOT EXISTS music_dna_section_instruments
  ON music_dna_sections USING gin (instruments);

CREATE TABLE IF NOT EXISTS music_dna_features (
  profile_id uuid NOT NULL REFERENCES music_dna_profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY(profile_id,kind,value)
);
CREATE INDEX IF NOT EXISTS music_dna_feature_inverted
  ON music_dna_features(kind,value,profile_id);

-- One consistent 1536-dimensional embedding model is chosen for this index.
-- Different embedding models/dimensions need separate indexed tables or expression indexes.
CREATE TABLE IF NOT EXISTS music_dna_embeddings (
  profile_id uuid NOT NULL REFERENCES music_dna_profiles(id) ON DELETE CASCADE,
  model text NOT NULL,
  embedding vector(1536) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(profile_id,model)
);
CREATE INDEX IF NOT EXISTS music_dna_embedding_cosine_hnsw
  ON music_dna_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS music_dna_jobs (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES music_dna_profiles(id),
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  worker text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 0,
  leased_until timestamptz,
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS music_dna_pending_jobs
  ON music_dna_jobs (created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS music_dna_expiring_jobs
  ON music_dna_jobs (leased_until) WHERE status = 'running';

COMMIT;

-- Example indexed keyword + instrument + tempo search:
-- SELECT id,artist,title FROM music_dna_profiles
-- WHERE search_vector @@ websearch_to_tsquery('simple', 'warm acoustic guitar')
--   AND instruments @> ARRAY['flute']::text[]
--   AND bpm BETWEEN 75 AND 100
-- ORDER BY ts_rank(search_vector,websearch_to_tsquery('simple','warm acoustic guitar')) DESC LIMIT 25;
--
-- Example semantic similarity (requires populated embeddings):
-- SELECT p.id,p.artist,p.title,(e.embedding <=> $1::vector) AS distance
-- FROM music_dna_embeddings e JOIN music_dna_profiles p ON p.id=e.profile_id
-- WHERE e.model=$2 ORDER BY e.embedding <=> $1::vector LIMIT 25;
