---
name: music-dna-bulk-ingestion
description: "Build resumable, deduplicated bulk Music DNA intake"
alwaysApply: false
priority: 85
scope: project
group: data
enabled: true
status: approved
triggers: ["bulk music","bulk import","huge DNA database","FTS"]
tags: ["bulk","music-dna","index"]
---

# music-dna-bulk-ingestion

## Procedure
1. Define the authorized set of sources, volumes, licensing, request quotas and whether audio files or metadata are available. Never assume a playlist provides downloadable audio.
2. Inspect existing profiles, job/queue tables, uniqueness constraints and search indexes in src/music-dna.mjs.
3. Normalize track identity: artist, title, version, source URL, release metadata, recording SHA when available; keep remasters, acoustic takes and live performances distinct.
4. Preflight duplicates and unchanged records; queue bounded, resumable jobs with page/cursor checkpoints, retries and error classification.
5. Execute supported analysis: audio_observed only when audio parsed; source_inferred for metadata-only. Record confidence and version.
6. Save revisions transactionally; verify counts, errors, skipped duplicates, duration, index performance and search results by mood, instrument, genre and vocal.
7. Report exact successful/incomplete totals and the evidence limits. Add tests for idempotency, batch recovery and Unicode/facet search.
