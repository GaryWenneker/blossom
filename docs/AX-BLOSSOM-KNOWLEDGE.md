# Blossom: AX project knowledge map

This is a project-scoped, version-controlled reference for AX agents operating against GaryWenneker/blossom. It is not the AX source repository. Last reviewed against Blossom GitHub main on 2026-10-24. Always inspect current code: features, route names and UI labels change.

## Product intent
Blossom is an independent local-first, security-first music-label workspace. It connects a large library of structured Music DNA reference profiles to News-to-Song projects, new original lyrics, Suno production settings, cover/artist visual prompts and guarded music-label operations. A fully autonomous music factory was a goal, not a verified production feature.

## Reference recordings and database
- Audio intake from legally accessible MP3/WAV; public YouTube/Spotify URL alone does not mean audio observed or downloadable.
- A versioned profile must describe instruments and roles, playing technique and timbre, vocal type/phrasing/harmonies, tempo/meter/groove, harmonic motion, arrangement/sections, production effects, dynamics, mood and confidence.
- Evidence classes in music-dna.mjs include not_analyzed, source_inferred, audio_observed and source evidence none/editorial/audio/human_verified. Never upgrade a metadata guess into acoustic proof.
- Scale via durable profile/analysis revisions, source URL/checksum dedupe, FTS and facet search, paginated queues, resumable bulk jobs, indexed filters. Track actual completed job counts, not desired volume.
- Core files: src/music-dna.mjs, src/music-dna-api.mjs, src/music-dna-mcp.mjs, test/music-dna.test.mjs.

## News to Song and Suno
- Input: sourceUrl, article text, selected artist, linked Music DNA and project controls; source is untrusted and may be unavailable.
- Expected creative result object: concept; lyrics; style; exclusions[]; moods[]; titles[]; coverPrompt; artistPhotoPrompt; suggestedGenre; rationale. Completely new writing, no protected lyric or melody duplication, no fabricated article facts.
- Suno controls in src/studio.mjs currently include: sunoModel, genre, additionalStyles, excludeStyles, vocalGender, instrumental, maxMode, weirdness, styleInfluence, variety, personalize, durationPreset, targetSeconds, customInstructions, imagePrompt and artistPhotoPrompt.
- The user wants to submit a news URL and receive an entire production-ready original song brief, not merely a link or bare lyrics. Preserve all control fields, and distinguish a Suno recipe from actual generated and uploaded audio.
- Core: src/studio.mjs, src/studio-api.mjs, public/studio.js, src/providers/local.mjs, src/article-import.mjs, src/drawthings.mjs.

## Authentication and external systems
- Browser login via normal Safari for Google/Suno, Spotify/Facebook where supported and ChatGPT. Google may reject automation-controlled Chrome. Avoid Playwright/stealth/cookie copying for account sign-in.
- A browser handoff state can be user_confirmed but is not independently verified or a provider API credential.
- Website ChatGPT login is not OpenAI API access and does not install Blossom MCP. Automatic inference must use official API or a local, genuinely installed model (Ollama); current UI implementation should be rechecked.
- A ChatGPT MCP plugin may use OAuth for read and write but requires user consent and connector/tool installation steps; do not infer it is installed from Blossom consent alone.

## Public MCP/OAuth
- MCP public URL: https://blossom.wenneker.dev/mcp ; issuer https://blossom.wenneker.dev .
- Main admin UI intentionally local: http://127.0.0.1:8787/ ; Cloudflare routes public gateway to local origin and must not expose admin API/login.
- OAuth metadata GET endpoints should return 200; unauthenticated MCP POST should return 401 WWW-Authenticate, not an active connection.
- OAuth troubleshooting stages: client_registered -> consent_shown -> consent_redirected (or denied) -> token_issued -> mcp_connected -> tools_listed. consent_repeated obscures earlier stages. A returned redirect alone does not prove ChatGPT redeemed it.
- Real incident on 2026-10-23: public OAuth metadata returned HTTP 200, unauthenticated MCP initialize HTTP 401 with expected bearer challenge, while private diagnostics showed activeTokenCount=0, two denied read/write consent attempts and an earlier read-only redirect without token_issued. Therefore Cloudflare routing worked for those paths; the exact ChatGPT callback/token failure remained unverified. Never fossilize that temporary status as current.
- Core files: src/mcp-oauth.mjs, src/music-dna-mcp.mjs, src/server.mjs, docs/chatgpt-mcp-oauth.md, scripts/check-public-tunnel.mjs.

## Mac install, model, testing and UX
- Base installer: bash setup.sh, Rust Ratatui installer, Node 22+/24, FFmpeg, cloudflared tools. Setup must preserve existing .env, vault credentials and data. Optional local AI install: scripts/setup-local-ai.sh; model downloads are large and must be consented to.
- Check npm run check and npm test plus GitHub CI Node 22/24, public MCP/OAuth, Ratatui, Music DNA regression. Runtime Mac service and Cloudflare tunnel separately verified.
- Studio/Connections are dense single-viewport responsive screens. Keep controls visible, direct feedback on first click and workable dialogs. Confirm against the user's existing mockups when attached; do not add unrequested new mockups.
- Track licensing, real performer likeness, rights, distributor receipts and actual publication. Business strategy for scalable pseudonymous functional music is exploratory, not legal/platform approval.

## Project-local AX policy locations
- Rules: .agents/rules/*.mdc
- Skills: .agents/skills/<name>/SKILL.md
- These files are source-controlled in Blossom for AX policy ingestion when AX opens this project. They are NOT automatically in the currently connected AX daemon if it is pointing at /Users/gary/io/ax. Never write Blossom-specific rules into AX's own project and pretend it has indexed Blossom.
- The attached AX tool reported its current root as /Users/gary/io/ax, not Blossom. After update on the Mac, run AX against Blossom's actual project root and verify via ax_rules and ax_skill; initialize/index the project only if necessary, without moving any .ax folder.

## Related skills
music-dna-reference-analysis, music-dna-bulk-ingestion, news-to-song-workflow, suno-production-blueprint, mcp-oauth-diagnosis, cloudflare-mcp-gateway-diagnosis, provider-browser-session-triage, local-ai-headless-generation, blossom-studio-viewport-qa, blossom-setup-and-ci, music-release-rights-review.

## New artist-owned media architecture (2026-10-24)
- `studio_artist_images` is the artist-level, durable media library; each item has `artist_id`, independent selected status, optional Studio source asset, filename, provenance and timestamp. A direct Artists-screen generation needs no Studio project.
- Studio-generated artist-photo is linked to its selected artist and kept after project asset removal. Historic selected project photos migrate into artist library on startup. Reassigning a project to another artist must not silently transfer the former artist's photo.
- The Artists page renders a wide responsive 16:9 hero using a selected image, with CSS overlay of the name; the gallery below the hero selects or removes artist images. New variants preserve active background by default.
- Album covers stay square and separate. Prompts use artist identity, genre and DNA, and avoid baked-in text or fake Spotify verification/listener claims.
- See `.agents/rules/blossom-artist-media.mdc` and `.agents/skills/artist-media-workflow/SKILL.md`.

## Studio release and Suno integration (2026-10-24)
- Stepper Article → AI Brief → Configure → Artwork → Release must represent real navigable sections, persist inputs and reflect completion. Release must be enabled only with artist, proper title, brief, style, and lyrics or instrumental.
- Suno Platform API (separate paid developer key) supports real job submission/status and a guarded audio download into selected Studio audio assets; store job state and never equate submission with an audio file.
- Consumer Suno Safari access is a manual handoff: the user must press Create in Suno and import the MP3/WAV. Do not impersonate an API or automate unauthorized browser endpoints.
- Preserve advanced Suno settings in the recipe; only send fields documented by the official endpoint. Check a real platform account before claiming live functionality.
- See `src/providers/suno-platform.mjs`, `src/studio-api.mjs`, `test/studio-suno-platform.test.mjs`.
