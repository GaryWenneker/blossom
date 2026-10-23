# Blossom architecture (MVP)

## Context

Blossom is a new and independent music-label management product. Its scope covers market hypotheses, artist identities, AI-assisted composition briefs, track provenance, distributor submission and rights-change monitoring.

## Runtime

- Node.js HTTP server and static HTML/CSS/JavaScript UI. No browser-side secrets.
- `node:sqlite` synchronous local database: artists, tracks, releases, watches and audit events. Single-process pilot only. WAL enabled for on-disk DB.
- Pure domain state machine for track stages and immutable audit history.
- Explicit authorized LabelGrid REST adapter. HTTPS bearer token read from process environment; never sent to browser.
- Suno blueprint generator is local and **does not** claim undocumented API access.
- Fixed-allowlist legal watch snapshots with SHA-256 comparison and manual acknowledgment.

## Data and workflow

```text
Artist DNA -> Track idea -> Brief -> Generated -> Review -> Approved
                                         |             |
                                         +-> Rejected   v
Distributor draft (existing LabelGrid ID) -> Checklists -> Validation (API)
  -> Human approval -> Live-delivery gate -> Submit (API) -> DSP queues
                                             |
                                             +-> Unknown outcome (hold)
```

A reviewer explicitly attests to rights, provenance, originality and AI disclosures; these confirmations are **not** an independent proof of ownership. LabelGrid performs its own metadata checks. Unresolved terms changes block distribution. Ambiguous external post errors are never silently retried.

## Threat model and boundaries

- Unauthorized access: admin password required for all private routes; localhost default.
- Browser request forgery: JSON POST and `X-Blossom-Request: ui`, no permissive CORS.
- Credential exposure: `LABELGRID_API_TOKEN` is server-side only; `.env` excluded from Git.
- Repeated delivery: compare-and-swap DB transition to `submitting` before a network call; ambiguous outcome requires reconciliation.
- Input safety: prepared SQL statements, validation, limited JSON body and escaped client rendering.
- External endpoint injection: LabelGrid HTTPS host allowlist, fixed monitoring URL list and explicit timeout.
- Provider outage: errors surfaced; no claim of publish success on failure.
- Scale limitation: single process; backend migration and queueing needed before SaaS usage.

## Next architecture iteration

- Next.js/TypeScript dashboard and authenticated API, once access controls and backend contracts are stable.
- PostgreSQL with migrations, transactions and durable work queue.
- Verified Suno API capability/terms discovery; generational job status, credit limits and export.
- Distributor release creation and binary asset upload with idempotent, validated operations.
- Real market research adapters and streaming royalty statements by territory; no invented payout rates.
- Monitored contract sources with semantic diff, legal review and alert delivery.

No application is 'unbreakable'; recovery drills, external contracts and responsible operations are ongoing work.

## Web authentication, vault, OAuth and genres (Phase 2)

The former Basic Auth challenge has been replaced with an actual login page compatible with 1Password and other browser password managers. Sessions are random 256-bit tokens stored by SHA-256 hash in SQLite, with eight-hour expiry, logout revocation, HTTP-only SameSite=Lax cookies, and Secure cookies for HTTPS origins. A bounded per-IP login failure counter and same-origin JSON mutation guard limit basic abuse. This is single-admin local pilot authentication, not a hosted multi-user IAM system.

The encrypted vault uses AES-256-GCM with a separate, externally managed 256-bit `BLOSSOM_VAULT_KEY`, authenticated with per-credential additional authenticated data. Only secret metadata/status is sent back to the browser. The API stores the official Suno account email/API key, not Suno's website password.

Spotify links via OAuth Authorization Code + PKCE. The flow stores a short-lived encrypted verifier and one-time session-bound OAuth state; token exchange and profile verification happen server-side. The encrypted Spotify refresh token is never returned to the browser. The Spotify Client ID is publicly identifiable app configuration. Spotify OAuth does not provide upload rights: distribution remains with a licensed DSP distributor.

The genres module is an editorial taxonomy, including a full Country & Americana family. Artists may use any custom genre if a taxonomy value does not fit. Genres are not claims of live popularity.

Hosting requirements: trusted HTTPS reverse proxy, exact `BLOSSOM_PUBLIC_URL` with Spotify callback allowlisted, backups and dedicated secret management. Production-grade MFA, network security and account management remain future work.

## Creative Studio composition pipeline (Phase 3)

```text
Article / original brief
  -> StudioStore (SQLite) with artist-specific production settings
  -> OpenAI Responses (strict JSON schema, original lyrics and visual prompts)
  -> User edit/review -> Suno manual production blueprint
  -> Optional existing Suno MP3/WAV import
  -> Draw Things CLI (macOS only) generates cover and fictional portrait
  -> Encrypted/private asset storage keyed by project and asset UUID
  -> Create a linked Track -> Existing rights and distributor release gates
```

A `StudioAPI` authenticated route adapter exposes JSON operations and validated binary audio upload. The host's existing session checks, CSRF header and same-origin policy guard all operations. OpenAI API keys are encrypted at rest by the existing Vault; only readiness information is shown to the browser. Never put submitted news text in a shell command. Draw Things runs with `spawn(..., {shell:false})`, a server-managed model identifier, resource limits and per-process mutual exclusion.

Secrets and private files live outside Git. Generated images are not legal evidence of likeness clearance, and manual rights review remains mandatory. The browser never reads the local model directory or raw key.

The browser renders HTML/CSS and SVG with functioning controls; historical tracks, releases and compliance views remain available from the same sidebar.

## Viewport-based interface and visual reference

The October 2026 approved Blossom dark Studio mock-up is the layout reference: lime accent, 220px navigation rail, slim header, four equal-height side-by-side News-to-Song panels (article, AI brief, Suno parameters and artwork), plus a bottom output dock.

The app uses a fixed viewport shell (100dvh) without document-level vertical scrolling. News-to-Song uses CSS grid, retaining its four adjacent primary panels on large screens and horizontal panel navigation at smaller widths, **without stacking the four panels into a tall document**. The dock uses actual tabs for tracks/assets and AI assistant. Oversized lyrics, long articles, form details and record lists remain fully accessible by scrolling *inside their bounded panes*. This is intentional: arbitrary-length user content cannot fit into a finite height without hiding, clipping or internal scrolling.

The Music DNA Library is height-bounded, with separate scrollable registration/job panels and a scrollable result list. All other operational screens use an internally scrolling main content region, not document scrolling. Mobile has a compact top navigation row and horizontally navigable Studio panels, with keyboard-focusable controls.

The stylesheet override is public/viewport.css loaded after all existing styles. Regression coverage in test/viewport.test.mjs inspects the shell contracts and uses headless Chrome/Chromium to measure rendered Studio/Library geometry at multiple desktop and mobile window sizes. **This compares the code's layout design with the approved reference, not a claim of pixel-identical appearance to the historic mock-up.**
