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
