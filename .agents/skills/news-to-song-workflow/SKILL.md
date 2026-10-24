---
name: news-to-song-workflow
description: "Convert an authorized article into an original structured Studio project"
alwaysApply: false
priority: 85
scope: project
group: music
enabled: true
status: approved
triggers: ["news to song","article URL","lyrics from news","Studio project"]
tags: ["article","lyrics","studio"]
---

# news-to-song-workflow

## Workflow
1. Read the existing Studio project (sourceUrl, article text, genre, artist language, instruments, Music DNA references, target duration, Suno controls).
2. If source text missing, import public HTML with safe bounded fetch and DNS/redirect SSRF defenses; if unavailable, ask for text rather than invent content or bypass a paywall.
3. Extract a factual short story and themes separately from creative metaphor. Mark uncertain, incomplete and sensitive claims.
4. Generate wholly original concept and lyrics respecting requested structure, vocal language and selected reference traits without copying recorded music.
5. Return the exact brief contract: concept, lyrics, style, exclusions[], moods[], titles[], coverPrompt, artistPhotoPrompt, suggestedGenre, rationale.
6. Validate all fields and save through Studio API or studio_project_save_result if write access is approved. Confirm persisted result by reading it again; never claim saved on mere HTTP/browser open.
7. Produce a Suno-ready blueprint and optional prompts for album cover, artist photo and track title. Music generation and publishing require separate confirmations.

## References
src/studio.mjs, src/studio-api.mjs, src/article-import.mjs, src/music-dna-mcp.mjs.
