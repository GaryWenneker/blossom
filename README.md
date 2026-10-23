# Blossom

**Blossom** is an independent operations platform for an original, AI-assisted music label. Manage distinct artist identities, develop original vocal and instrumental tracks, prepare reproducible Suno production blueprints, review commercial rights, and control distributor submissions through a guarded release workflow.

> **Status: MVP foundation.** Running locally, with real SQLite persistence and an authenticated UI. This is not yet an autonomous music factory. Suno generation, audio uploads, distributor release creation, streaming analytics, and hosted multi-user identity are intentionally not claimed as working.

## Quick start

Requires **Node.js 22.13+**. No runtime npm dependencies are needed.

```bash
git clone https://github.com/GaryWenneker/blossom.git
cd blossom
export BLOSSOM_ADMIN_PASSWORD='use-a-long-random-password-here'
npm run seed
npm start
```

Open **http://127.0.0.1:8787/login** and sign in as `admin`. This is a web form compatible with 1Password autofill, not the old HTTP Basic dialog. The seeded names are *unverified proposals*: perform artist-name and trademark checks before release.

Run `npm test` and `npm run check` before changes. For development, `npm run dev` enables file watching. Local state is stored in `.data/blossom.db`, ignored by Git.

## What is implemented

- Local responsive dashboard with artist, track, release, intelligence and compliance views.
- Distinct artists with creative DNA, language, genre, target countries and voice profile.
- Persistent track workflow: `idea → brief → generated → review → approved`, plus rejection.
- Versioned, copyable Suno **blueprints**, with explicit manual-generation mode until an authorized Suno API is verified.
- Required per-track review of audio source, rights, provenance, originality and AI disclosures.
- Draft releases associated with an **existing LabelGrid release ID**; required DSP asset/metadata checklist.
- Real [LabelGrid](https://api.labelgrid.com/docs/api) validate, distribute and delivery-status endpoints, with Bearer auth on the backend.
- Independent release approval before sending, live-delivery setting **off by default**, and explicit `PUBLISH` confirmation.
- Crash-safe *ambiguous-submission hold*: after a network error during delivery, the release requires manual reconciliation instead of automatic retry.
- On-demand contract-document snapshots, change detection, manual acknowledgment and distribution holds.
- Auditable operations, no external business credentials committed to Git.

## Optional distributor integration

LabelGrid API requires a separate paid, activated API account. Set:

```bash
export LABELGRID_API_TOKEN='your-server-side-token'
export LABELGRID_BASE_URL='https://api-sandbox.stg.labelgrid.com/api/public'
```

Confirm the sandbox host/account with LabelGrid, allowlist your IP if needed, and validate there first. The app accepts only verified LabelGrid domains. To allow **real publication**, set `BLOSSOM_ALLOW_LIVE_DISTRIBUTION=true` intentionally; the live distribution endpoint still requires a validated release, every rights check, approval, no unresolved contract changes, and final human confirmation. Do **not** enable production delivery while using test data.

This initial implementation **does not create LabelGrid releases or upload binaries**. Upload and complete audio, cover art, writers/credits, AI disclosures and metadata in LabelGrid first, then enter the actual release ID in Blossom. The next phase will automate asset ingestion through the distributor API.

## Optional contract monitoring

```bash
export BLOSSOM_MONITOR_ENABLED=true
```

The process checks a fixed set of official pages on startup and approximately every 24 hours while running. The UI can trigger a check manually. Text changes raise a hold until you review them. Site HTML may change without legal terms changing: treat signals as investigation requests, **not legal judgments**. This is not a guaranteed 24/7 service; production requires a scheduler, durable alerts and human legal review.

## Security caveats

The MVP now uses a cookie-based browser sign-in for a **single administrator**, with the password provided through `BLOSSOM_ADMIN_PASSWORD` (12+ characters), an explicit custom header on state-changing requests, restricted content types, server-only credentials, and a localhost default binding. The authenticated browser form uses an HTTP-only session cookie, custom request header and origin check. Do not expose this single-admin pilot directly to the internet without HTTPS, a reverse proxy, MFA and operational hardening.

SQLite supports a single local process for the pilot. Before distributed deployment, migrate persistence to PostgreSQL and add proper users, roles, MFA, backups, monitoring and queued jobs.

## Design decisions

- No invented Suno API endpoints, credential scraping or login automation.
- No purchasing or guaranteed payout claims based solely on national Spotify subscription prices.
- No use of real artists' voices, copyrighted recordings or existing lyrics without permission.
- No artificial streaming, misleading artist identities, or upload flooding.
- Distribution is never triggered by merely creating or generating a track.

Read [architecture](docs/ARCHITECTURE.md), [implementation plan](docs/ROADMAP.md) and [operator checks](docs/OPERATIONS.md) for scope, limitations and next steps.

## Web sign-in, secure connections and musical genres (Phase 2)

The login page at `/login` has standard `autocomplete=username` and `autocomplete=current-password` attributes, so you can save and autofill Blossom's own login in **1Password**. The server password remains `BLOSSOM_ADMIN_PASSWORD` (12+ characters). Sessions are stored as hashes, expire after eight hours, and can be revoked by signing out.

For the **Connections** page, configure an independent encryption key first:

```bash
npm run vault:key
# Copy the base64 value into BLOSSOM_VAULT_KEY in your secure environment
```

Keep the key separate from the SQLite database and back up both. Suno can store your email address and your official Suno Platform API key (if your account has API access). Spotify connects through official OAuth2 Authorization Code + PKCE; your Spotify website password is **not** stored. Configure the Spotify app's Client ID and register the precise redirect URI `http://127.0.0.1:8787/auth/spotify/callback` for local development, or `https://your-domain.example/auth/spotify/callback` for hosting. Set `BLOSSOM_PUBLIC_URL` to the corresponding origin.

**Important:** the Spotify Web API can read authorized profile information but cannot upload music directly; music distribution continues through LabelGrid. Saving a Suno API key does not yet initiate real Suno music generation. That requires access to official, verified API documentation for your account.

The new **Genres** view contains a broad editorial taxonomy (100+ styles), including Traditional Country, Contemporary Country, Country Pop, Outlaw Country, Americana, Bluegrass and Honky Tonk. When creating artists, choose a known style using suggestions or enter your own custom genre.

The secret vault encrypts values with AES-256-GCM. It never returns credentials to the browser. Losing your `BLOSSOM_VAULT_KEY` makes existing saved secrets unrecoverable.
