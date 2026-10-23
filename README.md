# Blossom

**Blossom** is an independent operations platform for an original, AI-assisted music label. Manage distinct artist identities, develop original vocal and instrumental tracks, prepare reproducible Suno production blueprints, review commercial rights, and control distributor submissions through a guarded release workflow.

> **Status: local creative-workspace pilot.** Running locally, with real SQLite persistence and an authenticated UI. This is not yet an autonomous music factory. Suno generation, audio uploads, distributor release creation, streaming analytics, and hosted multi-user identity are intentionally not claimed as working.

## One-command macOS setup (Ratatui installer)

Blossom provides an interactive guided installer built with **Ratatui**, the Rust terminal UI crate. Do not confuse it with unrelated packages named "Ratatouille". After cloning the repository, run:

```bash
cd blossom
bash setup.sh
```

The setup script detects/installs Homebrew (with explicit confirmation), a current compatible Node.js (22.13+; Homebrew node@24), FFmpeg/ffprobe, Rust/Cargo (for the Ratatui interface) and the cloudflared binary. It creates a private local `.env` with a random administrator password, AES vault key and separate MCP read/write tokens only if they are missing. **Existing secrets are preserved**, and `.env` never gets committed. The administrator password can be retrieved with `grep '^BLOSSOM_ADMIN_PASSWORD=' .env`; keep it private and store it in your password manager.

Next the installer prepares local storage, runs syntax checks and the entire test suite, synthesizes and decodes a short WAV with FFmpeg, processes it through the Music DNA worker, and creates macOS launchd user services for Blossom and its DNA worker. Both restart on login or after an unexpected exit. Verify at http://127.0.0.1:8787/login.

```bash
bash setup.sh --check          # Read-only health checks, no changes
bash setup.sh --no-services    # Install and verify but do not start launchd agents
bash setup.sh --headless       # Text-only CI/SSH mode
bash setup.sh --yes            # Explicitly authorize unattended Homebrew installation
```

The installer is **macOS-only** at this stage. It never enables public distribution, creates a Cloudflare tunnel, or deploys PostgreSQL automatically. A Cloudflare account/hostname and security policies must be configured separately before remotely exposing MCP. Use `docs/SETUP.md` for service management and troubleshooting.

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

## Creative Studio (News to Song)

The **News to Song** workspace combines the full label workflow in one authenticated, responsive dark interface. It uses original custom vector audio-wave branding, not screenshot backgrounds or mockups.

- Paste a news article or original text, choose an existing artist, save a named project, and link the article URL for source attribution.
- Send the article to your own **OpenAI API** account using the Responses API and strict structured-output JSON schema. Generate a concept, completely original lyrics, mood, suggested titles, Suno styles/exclusions, and separate cover/fictional artist photo prompts.
- Edit and save the lyrics. Ask the AI production assistant about arrangements within the project.
- Set instrument/vocal mode, gender, duration preset, target duration, additional/excluded styles, Max Mode, Weirdness, Style Influence, Variety, personalization and custom instructions. Save a production profile per artist.
- Create and link a production track. Copy a real Suno-ready blueprint or upload MP3/WAV audio from your authorized Suno account.
- Generate cover artwork (1024×1024) and fictional artist portraits (768×1024) **locally on macOS** through official Draw Things CLI. Generated images and imported audio are stored privately and linked to the same project.

### OpenAI API setup

A ChatGPT subscription is **not** the same as an OpenAI API account. Create an API key through your own OpenAI API account and add it under **Connections** with the AES-256-GCM vault enabled, or configure `OPENAI_API_KEY` on the server. API usage is separately billed. Optionally choose `BLOSSOM_OPENAI_MODEL` (default `gpt-4.1-mini`). Blossom sends only the chosen project article and production context to the API, with `store:false`; it does not automatically send your entire account content.

### Draw Things CLI setup on your Mac

Install the official CLI using Draw Things' current Homebrew tap:

```bash
brew install --HEAD drawthingsai/draw-things/draw-things-cli
draw-things-cli generate --help
```

Set `BLOSSOM_DRAW_MODEL` to the **exact installed model identifier**, for example `flux_2_klein_4b_q6p.ckpt`. Run Blossom on **your Mac**, not on a remote Netlify worker, to access your local model cache and GPU. The worker runs `draw-things-cli generate` with explicit safe arguments and `--output`; it never invokes a shell using submitted prompts. Expect local model compatibility, disk/memory usage and occasional CLI-version differences to require real Mac testing.

### Playlist strategy and audio durations

Spotify currently counts a song stream after **30 seconds played**. That does not mean 30-second songs are guaranteed to enter playlists. Choose and override editorial duration presets per artist: radio, streaming, focus, ambient and custom. Target durations are guidance for creation, not guaranteed Suno output lengths. For Spotify editorial consideration, pitch an eligible unreleased track at least seven days before release via Spotify for Artists. There is no legitimate guaranteed-playlist-placement switch.

### Important limits

**What works:** Projects, AI generation/assistant with an OpenAI key, editable presets, audio upload/linkage, local artwork/artist photo generation with installed CLI/model, and the existing guarded release process.

**What still needs authorized provider integration:** Direct Suno generation/download under your account, automatic distributor media creation/upload, Spotify for Artists portrait publication, and durable background artwork jobs. The linked artist image can be prepared for Spotify but is not automatically posted there. Album art is linked to the Blossom project; it must still pass rights/artwork review before distributor submission.

Store `.data/blossom.db` and `.data/assets` securely. Neither audio nor model files belong in the public repository.

## Music DNA reference library (initial implementation)

Reference recordings can be saved as versioned, indexed musical DNA profiles, searched by full text and instrument/genre/mood/vocal facets, and enqueued for future bulk audio analysis. REST endpoints are protected by the existing browser session and a separate optional MCP endpoint uses read/write bearer tokens. **Automatic audio analysis and the PostgreSQL cutover are not yet implemented.** See [Music DNA documentation](docs/MUSIC_DNA.md) and [PostgreSQL schema](db/postgres/001_music_dna.sql).


## Local Music DNA audio measurement and Studio references

The Music DNA Library now supports registering reference recordings and uploading permitted MP3/WAV files (40 MB maximum) with explicit permission confirmation. Audio is stored privately in `.data/reference-audio`, fingerprinted by SHA-256 and queued for signal-level analysis. Install FFmpeg, including `ffprobe`, on your Mac (`brew install ffmpeg`). In a separate terminal, run `npm run dna:worker:loop` to analyze queued local audio. A single batch run is `npm run dna:worker`.

This computes measurable properties (duration, sample rate, codec, channel count, decoded RMS, peak and silence). It **does not yet identify instruments, singers, chord progressions, tempos, or song sections automatically**. You can attach a reviewed detailed DNA analysis via the existing REST/MCP endpoints. The News-to-Song Studio can combine up to three analyzed reference DNA profiles, with editable influence weights, into its original-song brief and Suno blueprint. See [Music DNA](docs/MUSIC_DNA.md).

## Social sign-in for existing Suno and Spotify accounts

The **Connections** screen provides an official Suno website link for signing in with your existing **Google** SSO account. This is a browser handoff, not a Blossom-accessible Suno OAuth token. For Spotify, choose **Connect Spotify · Choose Facebook** (after configuring a Spotify developer Client ID and callback), then select **Continue with Facebook** if your Spotify account already supports that method on Spotify's own website. Blossom saves the resulting Spotify OAuth authorization securely without handling Google/Facebook passwords. See [Operations: provider social sign-in](docs/OPERATIONS.md#existing-suno-google-and-spotify-facebook-account-sign-ins).

## Single-screen Studio layout

Blossom's interface now uses a fixed viewport (no page-level vertical scrolling), closely following the earlier approved dark News-to-Song mock-up: narrow left navigation, compact header, four side-by-side panels and one lower tabbed output dock. On smaller screens, the panels can be browsed horizontally instead of creating a taller page. Long text, form options and growing track collections scroll inside their own panes so controls stay accessible; these content panes can still scroll when the data exceeds the screen.

The layout is tested in headless Chromium at desktop, laptop and mobile sizes; see [Architecture](docs/ARCHITECTURE.md#viewport-based-interface-and-visual-reference).

## Suno browser handoff without a Platform API account

The separately administered **platform.suno.com** developer account is not the normal Suno consumer login. If Platform reports "No platform account found for this email", use your regular subscription at \`https://suno.com\`. Blossom offers a **supervised Playwright Core / installed Chrome** browser handoff from **News to Song**: choose **Open Suno (Playwright)**, sign in with Google manually inside the visible browser, then select **Fill Suno draft** to attempt to fill visible lyrics/styles/title/exclusion fields from the saved Studio recipe. Press **Generate yourself** on the official Suno site after review. Fields not clearly recognized are skipped and should be copied from **Suno blueprint**.

Playwright is not used to bypass Platform approval, automate account login, invoke undocumented Suno endpoints, scrape assets, capture cookies, submit generation jobs or batch-process the consumer site. An isolated persistent profile in \`.data/suno-playwright-profile/\` may keep your website session between runs; protect your Mac's disk and user profile. The implementation is intentionally best-effort: UI field labels can change, Chrome/Google may reject automation, and Suno's [current terms](https://suno.com/terms-of-service) restrict automated access. Confirm your use is permitted by Suno. The recommended full automation route remains authorized API access.

## Draw Things model setup

To enable local cover art, update the repository and run bash setup.sh. The installer now selects lustifySDXLNSFWSFW_v20 (from the screenshot) for BLOSSOM_DRAW_MODEL, repairs previously blank .env entries, installs the official draw-things-cli if missing, and verifies that this identifier appears in the local downloaded-model inventory. Non-empty custom model choices are preserved. See [setup details](docs/SETUP.md#draw-things-model-local-album-artwork).

Draw Things CLI is now installed from **official Homebrew core**, not its older external tap, to avoid Homebrew 6 third-party trust problems. See [setup troubleshooting](docs/SETUP.md#homebrew-6-tap-trust-warnings).

If setup reports your Draw Things checkpoint is missing, use `draw-things-cli models list --downloaded-only` to find the exact model ID. The setup now reports the configured model folder and warns instead of stopping the rest of Blossom. You may set `DRAWTHINGS_MODELS_DIR` in the private `.env` if the Draw Things GUI uses a custom model location. Artwork remains unavailable until an installed model is verified.

## Browser sign-in in your normal browser

Connections opens Suno, Spotify and ChatGPT in your existing default browser, rather than an automated Playwright/Chrome profile. Google's login blocks automated browsers with "This browser or app may not be secure"; native browser tabs avoid that automation-specific problem without hiding browser identity or moving cookies. The regular browser controls its own session: if you are already signed in, you normally continue without login. Blossom never reads, copies or injects your cookies. Credentials for optional developer APIs remain in Advanced.

In News to Song, **Open Suno in browser** uses the same normal browser. **View / copy Suno blueprint** shows lyrics and settings to paste into Suno. Direct Playwright prefill into a Google-authenticated tab is no longer offered in the default workflow. See docs/OPERATIONS.md.

### Google blocks the Playwright login window

If Google says that the browser or app may not be safe, use **Connections → Suno → Open in Safari (Mac)** after updating Blossom. Native macOS Safari is opened via LaunchServices and is never attached to Playwright. An older Playwright-controlled Chrome window must be closed; a new tab inside that same window remains controlled. The current Studio Suno flow also uses Safari or a copyable blueprint instead of attempting an asynchronous popup.

### Connection status when returning from Safari

After opening a provider in Safari, return to Blossom and click **Ik ben ingelogd** (or **Nog niet gelukt**) in the modal or Connections card. Blossom immediately updates and saves that **user-confirmed** status for future sessions. It also refreshes the cards when the Blossom tab regains focus. It cannot know whether a separate Safari window closed or whether Google/Suno actually authenticated you; therefore it never presents the manual confirmation as a verified API connection. No browser cookies are read.

Spotify follows the same native Safari browser login as Suno: initially Blossom opens the official Dutch Spotify login page for your existing Facebook sign-in; after **Ik ben ingelogd** it opens the Web Player with the same Safari session. **Opnieuw aanmelden via Facebook** is available if needed. No developer Client ID is required for browser-only use. Details: `docs/OPERATIONS.md`.

## Fully automatic local AI for News to Song (no new browser window)

Blossom now supports **Ollama on the Mac** for legitimate background inference. Prepare all still uses that local model, or the official OpenAI API when a key is configured. A ChatGPT website login is not an API key.

**Generate with ChatGPT** and a paste of an article URL or a text block of at least 80 characters use a separate persistent Chrome profile (`.data/chatgpt-playwright-profile`). The first run opens a visible window on https://chatgpt.com/ so you can sign in once. Later runs reuse that profile in the background and write the song brief onto the project. Blossom does not read Safari cookies, passwords, or the manual Connections confirmation. `POST /api/studio/projects/{id}/chatgpt-extract` stays the local Ollama compatibility route and does not launch a browser. `POST /api/studio/projects/{id}/chatgpt-lyrics` is the Playwright route.

### First-time local setup (one command, downloads several GB)

```bash
bash scripts/setup-local-ai.sh
launchctl kickstart -k gui/$(id -u)/io.wenneker.blossom.server
```

This script installs Ollama with Homebrew if necessary, starts a local service on 127.0.0.1:11434 and downloads `qwen3:8b`. Review the disk/download implications before running it. The AI provider and model can be configured with `BLOSSOM_LOCAL_AI_URL` (loopback only) and `BLOSSOM_LOCAL_AI_MODEL`. Blossom asks the local service to return a complete structured song brief, saves lyrics/style/titles/prompts to the project database, and offers production parameters without opening any provider website. `Prepare all` and the assistant use the same local engine when there is no OpenAI API key. Local quality, latency and model support differ from ChatGPT.

### Article links

An article URL can now be imported using **Haal artikel op**. If the article text field is empty, automatic extraction first tries to import the URL using bounded public HTTP(S) requests with DNS/redirect SSRF protections. Some publisher websites block server-side requests or require a subscription. In that case no text is invented; paste the permitted article text manually. This feature does not bypass paywalls or reuse browser cookies.

An official OpenAI API key continues to enable automatic OpenAI-backed generation as a distinct alternative. A logged-in ChatGPT browser is **not** evidence of API authorization, even if an MCP app is installed.
\n## Public Blossom gateway health\n\n`https://blossom.wenneker.dev/` is the MCP/OAuth gateway, not the Studio admin dashboard. It shows a public landing page and provides a `GET /healthz` readiness endpoint, while admin `/login`, `/api/*`, and application JavaScript remain inaccessible via the public Host header. Connect ChatGPT to `https://blossom.wenneker.dev/mcp`. The Studio interface continues to run locally at `http://127.0.0.1:8787/`.\n\nFrom the Mac hosting Blossom run:\n\n```bash\ngit pull\nbash setup.sh --headless\nnpm run tunnel:check\n```\n\nIf the local host responds but the public probe fails, check the **existing** Cloudflare Zero Trust tunnel connector and route the public hostname to `http://127.0.0.1:8787`, preserving the HTTP Host header `blossom.wenneker.dev`. Blossom setup does not create or install tunnel credentials automatically, and cannot repair Cloudflare DNS/config without access to your Cloudflare account. Do not bind the admin server to `0.0.0.0` or remove its public-host restrictions. The diagnostic never reads or prints tunnel secrets.\n

### ChatGPT plugin not added after OAuth approval

A Blossom OAuth consent approval is not by itself a ChatGPT plugin installation. Complete the **Scan Tools** and **Create as a plugin** steps in ChatGPT after authorization. If a second click on the Blossom approval page reports **Toestemming al verwerkt**, do not reuse that one-time form. Start a fresh connection from ChatGPT. In local Blossom **Connections → Blossom MCP-koppeling met ChatGPT controleren**, request the private OAuth diagnosis to distinguish redirect, code exchange and tool scan. See `docs/chatgpt-mcp-oauth.md`. To save music briefs, the connection needs a separately approved `blossom:write` scope, not read-only access.
