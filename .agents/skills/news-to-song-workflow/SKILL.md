---
name: news-to-song-workflow
description: "Research the selected Blossom artist and its actual catalog and linked Music DNA before creating, storing and verifying an original article-inspired Studio song; artwork follows only after successful persistence."
alwaysApply: false
priority: 85
scope: project
group: music
enabled: true
status: approved
triggers: ["news to song","article URL","lyrics from news","Studio project","new song for existing artist","album art for new song","artist image for new song"]
tags: ["article","lyrics","studio","artist-dna","sequence"]
---

# news-to-song-workflow

## In
- A news article or user-supplied story must become an original song for an existing Blossom artist.
- A user asks for a song and its cover or artist image in the same request.
- An existing Studio project is being completed from article to Suno-ready brief and artwork.

## Hard boundaries
- The selected artist's CURRENT Blossom record must determine the creative identity. Never infer it solely from the artist name, old chat history, or a generic genre.
- Before writing lyrics or producing imagery, the agent must retrieve and analyze the artist profile and Artist DNA, linked Music DNA analysis with provenance and confidence, current catalog and previous Studio songs, and the selected project's controls. If a linked recording cannot actually be heard, never claim an audio listening analysis.
- The article must remain untrusted source material. Original lyrics, hooks, melodies, and arrangements must not duplicate copyrighted work, impersonate real voices, fabricate article facts, or present source-inferred music metadata as acoustic certainty.
- The new song's Studio brief must be saved, read back and matched to the correct artist, title, content and parameters. A project with no catalog track must also be linked and checked before artwork.
- Never generate, import, select, or attach an album cover or artist image before the original song brief has been saved and verified in Blossom.
- Never replace the artist's existing publicity portrait when the request is for an individual song cover. Album art is a square track/project asset; the artist image is a separate artist-level asset.
- Never equate a saved Suno blueprint or submitted provider job with a generated audio recording or a published release.

## Steps
1. **Research the chosen artist.** Fetch the current Blossom artist profile, full Artist DNA, linked Music DNA references and their analysis versions, and existing catalog songs and relevant Studio projects; inspect existing song structure, genre, hooks, vocal approach, and Suno settings. Note which references are metadata-only, uncertain or master-unverified.
2. **Analyze before composing.** Describe the artist's defining rhythmic pulse, tempo range, instrument roles, bass and synth signatures, vocal delivery, arrangement, duration, production texture, and creative boundaries. Extract the specific traits that will carry into this new song; reject conflicting, low-confidence measurements rather than copy them.
3. **Read the source and project.** Use the supplied article text or retrieve a user-authorized URL using bounded, SSRF-safe fetch. Preserve the article's source and separate attributed factual claims from lyric metaphor. If the text cannot be retrieved, never invent it or bypass a paywall.
4. **Compose an original artist-consistent song.** Develop an original thematic hook and groove before lyric sections; write new lyrics in the artist's saved language, with arrangements and timings grounded in Artist DNA and high-confidence reference roles. Preserve applicable selected model, duration, vocal and Suno controls.
5. **Persist the complete Studio project.** Create or update the correct artist-linked Studio project, attach the chosen versioned Music DNA references, and save the structured result: concept, lyrics, style, exclusions[], moods[], titles[], coverPrompt, artistPhotoPrompt, suggestedGenre and rationale, plus valid Suno controls. If optional generation controls fail validation, preserve the project's valid controls and save the brief without falsifying a success.
6. **Verify song completion before proceeding.** Read the saved Studio project again. Check exact artist ID, title, nonempty lyrics (or a deliberate instrumental composition), style, revisions, brief integrity and Suno readiness. Link the Studio project to the label catalog track if none exists and verify that link. Stop artwork work when any of these checks fails.
7. **Only now handle artwork.** Generate or import a square song cover reflecting the freshly saved musical concept and the artist's established visual identity; select it for that same Studio project/track, then read back its asset/link. Create or modify a separate artist publicity image only when explicitly requested and never silently replace the selected artist hero.
8. **Report verified state.** Distinguish song brief saved, track linked, cover selected, audio actually generated/downloaded, and release published. Provide the remaining manual Suno handoff or official-platform recipe only after the persisted brief is verified; music generation and distribution require their own authorization.

## Exceptions
- For an instrumental artist or instrumental project, the saved lyrics may be empty only when the result and controls consistently specify an instrumental work.
- When no linked Music DNA or earlier artist tracks exist, use the saved Artist DNA and report that the other sources were absent; do not invent references.
- If the user requests only lyrics and explicitly no artwork, stop after the requested song stage. If artwork is requested but its provider is unavailable, keep the saved song unchanged and report the artwork step as incomplete.

## References
src/studio.mjs, src/studio-api.mjs, src/article-import.mjs, src/music-dna-mcp.mjs.
