# Roadmap

## Phase 0: research & guardrails
- [x] Inspect official LabelGrid endpoint names and sandbox documentation.
- [x] Check Suno Platform API entry point; do not assume this account can use it.
- [x] Document AI-music rights, distribution review and limitations.
- [ ] Verify Suno account API entitlement, endpoints, parameter ranges and commercial license with the account holder.
- [ ] Choose licensed trend/chart sources and geographic royalty sources.
- [ ] Verify artist names against platform names and trademark databases.

## Phase 1: working operations pilot
- [x] Local authenticated dashboard.
- [x] SQLite artist roster and DNA.
- [x] Track lifecycle and safe Suno blueprint generation.
- [x] Explicit rights/source review before approval.
- [x] Distributor release attachment and checklists.
- [x] LabelGrid validate/distribute/status adapter with disabled-by-default live gate.
- [x] Terms snapshot watcher and contract-change hold.
- [x] Automated domain, server, provider, watcher tests.

## Phase 2: real provider production
- [ ] Credential-safe authorized Suno API integration with capability negotiation.
- [ ] Audio uploads, listening QA and mastering QC (peak, duration, clipping, duplicates).
- [ ] LabelGrid artist, track, release and artwork creation/upload.
- [ ] Webhook verification, delivery-state reconciliation and take-down handling.
- [x] Web login with password-manager autofill, secure sessions and sign-out.
- [x] Encrypted Suno API key storage and OAuth2 Spotify account connection.
- [x] Editorial global genre directory including Country & Americana.
- [ ] Multi-user auth with MFA, externally managed secrets, cost budgets and metering.

## Phase 2.5: Creative Workspace
- [x] Redesigned dark music-creation workspace matching the new Suno/Draw Things inspired product direction.
- [x] Original audio-wave logo in code, reusable between login and dashboard.
- [x] Article-to-original-lyrics and structured production brief through OpenAI Responses API with separate encrypted key.
- [x] Artist-level duration/genre/mode settings, editable parameters, and playlist-intent presets.
- [x] Draw Things CLI adapter for cover and fictional artist photo generation on the same Mac as the app.
- [x] Linked local artwork, artist photo, and imported WAV/MP3 files.
- [x] Session-protected studio operations, new tests and documentation.
- [ ] Live Mac hardware validation with the actual installed Draw Things model.
- [ ] Official Suno API entitlement, endpoints, callbacks and automatic generation.
- [ ] Automatic LabelGrid release creation, source upload, thumbnails and account-specific integration tests.
- [ ] Reliable queues, progress polling and resumable image generation.

## Phase 3: commercial intelligence
- [ ] Paid streaming analytics and statement ingestion, by territory and platform.
- [ ] Fresh chart and playlist monitoring from licensed providers.
- [ ] Attribution and campaign ROI; album/artist/market profitability.
- [ ] Original composition review, human editorial curation and marketing experiment dashboards.

## Phase 4: production hardening
- [ ] PostgreSQL migrations and multi-instance-safe job orchestration.
- [ ] Offsite backups, secret manager, SLOs, security assessments and disaster recovery exercises.
- [ ] 24/7 terms changes with reliable notification, contract approvals and retention.
- [ ] CI deployment with production release controls and observability.

All items marked complete were implemented in source; external services still require paid account access and real end-to-end validation.

## Music DNA knowledge base
- [x] Local reference catalog with provenance and versioned time-aligned analyses.
- [x] FTS5 inverted search and indexed genre/instrument/mood/vocal filters.
- [x] Persistent batch-import queue with job claims and completion.
- [x] Authenticated REST and token-scoped MCP endpoints, with tests.
- [x] PostgreSQL full-text/GIN/trigram/HNSW target DDL prepared.
- [ ] Automated licensed audio inspection and analysis workers.
- [ ] Studio reference profile picker, comparison and Suno parameter blending.
- [ ] Tested PostgreSQL runtime adapter, backfill, vector embeddings, cutover and benchmarks.
- [ ] Harden and deploy Cloudflare Tunnel/Access and verify ChatGPT MCP client interoperability.


## Music DNA audio and creative integrations
- [x] Authorized MP3/WAV reference upload with private storage and SHA-256 checks.
- [x] Safe local ffprobe/FFmpeg signal measurements and lease-based analysis worker.
- [x] Reference Library UI, search and queue overview.
- [x] Save weighted, versioned music references per Studio project and apply characteristics in original Suno recipes / OpenAI briefs.
- [ ] Automatic instrument recognition, playing techniques, vocal timbre, song section detection, tempo and key estimation with validated models.
- [ ] Concurrent worker scheduling/metrics, audio asset lifecycle and large batch ingestion.
- [ ] Continuous hosted worker supervision and protected Cloudflare endpoint deployment.

## Draw Things local model configuration
- [x] Prefer the screenshot's Lustify SDXL model in fresh Blossom configuration.
- [x] Repair a blank BLOSSOM_DRAW_MODEL while preserving non-empty choices.
- [x] Install/check official Draw Things CLI and verify the selected local model.
- [ ] Run a genuine image-generation test on the user's Mac and tune model-specific inference settings.

## Persistent browser connection UI
- [x] Isolated Playwright profiles for Suno, Spotify and ChatGPT browser access.
- [x] One-click Connections controls with guided modal login and browser session reuse.
- [x] Developer credentials placed in collapsed Advanced section.
- [x] Never treat local cookies as API tokens or a confirmed live provider login.
- [ ] Verify real third-party login flow and cookie expiry behavior locally on the user's Mac.
- [ ] Add supported provider API integrations for fully automated workflows when authorized.
