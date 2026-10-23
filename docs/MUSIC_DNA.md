# Music DNA database and MCP

Blossom now has a separate catalog of reference recordings. Reference DNA is not an artist identity and is not itself a generated song.

## Local features

- Indexed SQLite FTS5 (BM25), plus normalized inverted indexes for genre, mood, instrument and vocal type.
- Individually identified recordings, with SHA-256/source-URL deduplication. Matching artist/title alone does not deduplicate different recordings.
- Append-only, versioned musical analysis: instruments, playing technique, timbre, vocals, production, BPM, key, moods, summary and timed sections with confidence/provenance.
- Persistent bulk queue (up to 500 inputs per call), claim/lease and completion APIs.
- Existing signed-in browser session required for REST writes and search.
- Separately token-protected stateless MCP for external assistants.

## REST routes

GET /api/music-dna/search?q=flute&instrument=Flute
GET /api/music-dna/profiles/{uuid}
GET /api/music-dna/profiles/{uuid}/versions
GET /api/music-dna/jobs?status=queued
POST /api/music-dna/profiles
POST /api/music-dna/profiles/{uuid}/analyses
POST /api/music-dna/import-batch
POST /api/music-dna/jobs/claim
POST /api/music-dna/jobs/{uuid}/complete

Create a reference using JSON with artist, title, optional releaseYear, sourceUrl, sourceKind (metadata, local-audio, licensed-audio, manual), recordingSha256 and sourceNote. A reference is only metadata until an analysis has actually been saved.

An analysis requires analysisMethod and analyzer. Other keys: confidence, bpm, musicalKey, timeSignature, durationMs, genres, moods, instruments (array of objects with name, technique, timbre, role and optional confidence), vocals, production, sections (array with startMs, endMs, label, instruments, techniques, notes), summary. Do not manufacture measured values from bibliographic metadata.

## MCP over Cloudflare Tunnel

Local endpoint: POST /mcp, JSON-RPC 2.0, with initialize, tools/list, tools/call, ping. Calls return JSON; compatibility and session expectations must be tested against each specific MCP client.

Use separate secrets at least 32 characters long:

    BLOSSOM_MCP_READ_TOKEN
    BLOSSOM_MCP_WRITE_TOKEN

Generate each with: openssl rand -hex 32.

Read tools: music_dna_search, music_dna_get, music_dna_versions, music_dna_jobs.
Write tools: music_dna_add_reference, music_dna_save_analysis, music_dna_import_batch, music_dna_claim_job, music_dna_complete_job.

A write token can read and write. The REST UI still uses a normal browser session and its existing CSRF controls, whereas MCP requires an Authorization: Bearer token. If no valid token is configured, MCP is disabled. Never embed bearer tokens in frontend scripts or Git.

For remote use, add a Cloudflare Tunnel to a dedicated protected hostname, enforce Cloudflare Access, MFA or service authentication, HTTPS, rate limits and log review. Route only /mcp if possible. The existing single-admin web UI must not be publicly exposed without further hardening. Neither Cloudflare configuration nor ChatGPT custom-connector registration is carried out by these source changes.

## PostgreSQL and performance

The scale-out SQL is db/postgres/001_music_dna.sql. It provides GIN full-text/array/JSONB indexes, normalized feature lookups, B-tree filters, trigram approximate names and a pgvector HNSW cosine-similarity index. That vector index is useful only after generating real compatible 1536-dimensional embeddings.

This SQL is an architectural **target**, not an automatic migration. The live runtime still uses SQLite. A cutover requires an explicit migration/backfill, PostgreSQL adapter, transaction and index testing, backup and rollback. Do not claim production-scale throughput before running representative benchmarks.

## Remaining work

- A real MP3/WAV audio-analysis pipeline and a worker consuming queued jobs.
- UI Library/Search/Batch pages and an integrated reference picker in the News-to-Song Studio.
- Actual vector embedding generation, evaluated similarity relevance and a PostgreSQL migration.
- Optional authorized audio imports and source-specific copyright controls.

The current code does not download YouTube/Spotify audio, transcribe copyrighted songs, clone artists, automatically generate Suno output, or perform acoustic analysis. Audio provenance, usage rights and analysis confidence must be respected at every stage.


## Audio-analysis implementation and GUI

The **Music DNA** navigation item offers a Library for registering an existing recording, inspecting the latest analyzed DNA, searching the indexed profiles, uploading permitted MP3/WAV files and seeing queue status. Reference audio must be user-provided and explicitly authorized. Audio upload endpoint: `POST /api/music-dna/profiles/{id}/upload-audio` with `Content-Type: audio/mpeg` or `audio/wav`, the signed-in session cookie, `X-Blossom-Request: ui` and `X-Blossom-Audio-Rights: confirmed`. Data is stored in a configurable `BLOSSOM_REFERENCE_AUDIO_DIR` (default `.data/reference-audio`) with 0600 file permissions. Max file size is 40 MB. Content signatures are checked, then FFmpeg validates decodability.

Install FFmpeg + ffprobe on your Mac with `brew install ffmpeg`. Start a separate worker: `npm run dna:worker:loop` for continuous processing or `npm run dna:worker` for a bounded drain of queued audio. The worker only claims queued jobs with attached authorized reference audio; metadata-only jobs remain waiting for manual/extended analysis. Interrupted claims expire after ten minutes; each job allows up to three attempts and errors are recorded. FFmpeg runs with fixed arguments and no shell. Duration is capped at 15 minutes for this analysis stage.

**Measured now:** media duration, input sample rate, channel count, codec and decoded-mono peak, RMS, silence fraction, and sample count. **Not inferred:** BPM, musical key, instruments, performing technique, voice identity, mood or time-aligned song sections. Those fields remain empty until an independent validated analyzer or human listener actually supplies them. These limitations prevent invented musical profiles from polluting the database.

In News-to-Song Studio, select up to three profiles with analyses using the Music DNA picker, assign 1–100 influence weights, and produce original lyric/arrangement suggestions. Profiles are stored in `studio_music_dna_refs`; musical traits and production characteristics are passed to the creative prompt, while original artist names, source lyrics and source audio remain out of the creative model context. The recipe includes a concise neutral style description rather than imitating a named artist. The existing Suno handoff remains manual.

**Operations and caveats:** The worker currently runs in its own process; it is not automatically started by Blossom. It requires the same SQLite database and audio directory as the web server. FFmpeg/ffprobe must be on PATH. This is not yet a full multi-worker music understanding pipeline, and the existing PostgreSQL SQL file remains a future migration target. The Cloudflare Tunnel is not deployed by these source changes.
