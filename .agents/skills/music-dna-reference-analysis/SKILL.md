---
name: music-dna-reference-analysis
description: "Build evidence-ranked musical DNA from a real recording or link"
alwaysApply: false
priority: 85
scope: project
group: music
enabled: true
status: approved
triggers: ["analyze MP3","analyze song","music DNA","Marshall Tucker Band","Electronic","recording analysis"]
tags: ["music-dna","audio","reference"]
---

# music-dna-reference-analysis

## When
A known reference song, MP3/WAV, YouTube/Spotify link or desired artistic DNA is provided.

## Procedure
1. Identify exact artist, track, release/recording version, live/studio/remaster and permitted source. Do not confuse a familiar title with an actual audio sample.
2. Confirm whether audio bytes are available and legally usable. Use FFmpeg/ffprobe or approved analyzers if audio exists. If not, restrict claims to metadata/editorial research and set evidence to source_inferred.
3. Analyze layered musical features: instrument identities, musical roles, technique/articulation, timbre, vocals and harmony, BPM/meter/groove, key/chord tendencies, song sections/transitions, dynamics, effects/mix, era and emotional arc.
4. For bar/time-specific claims, require an actual recording and a timestamped analysis. Assign confidence and evidence to every detailed observation, including what was not measurable.
5. Validate the structure and save a new revision through Music DNA API/MCP only when authorized. Preserve provenance and history.
6. Query the profile and verify source, revision, filters and semantic detail. Never reproduce copyrighted complete lyrics or claim to have listened when you have not.

## Code
src/music-dna.mjs, src/music-dna-api.mjs, src/music-dna-mcp.mjs and test/music-dna.test.mjs.
