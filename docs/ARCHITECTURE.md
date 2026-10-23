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
