# Blossom guided setup (macOS)

Blossom's installer is based on **Ratatui** (the Rust terminal user interface crate). This is not the similarly named Ratatouille Linux attestation or Mac cleanup tool.

## First installation

From the cloned, up-to-date GitHub repository:

    cd blossom
    bash setup.sh

The bootstrap installs Homebrew if missing (requires operator confirmation), a supported Node.js runtime, FFmpeg/ffprobe, Rust/Cargo, and the cloudflared binary through Homebrew. Brew packages are reused when already installed. No external shell installer is run except Homebrew's official, explicitly confirmed installer when Homebrew is missing.

The Ratatui dashboard runs eight gated checks:

1. Node.js >=22.13, ffmpeg, ffprobe, npm.
2. Secure .env configuration (does not replace existing passwords or vault keys).
3. Private .data/reference-audio, .data/logs and local database preservation.
4. Source syntax checks via npm run check.
5. Full tests via npm test.
6. Real FFmpeg decode and Music DNA analysis of a generated 1-second WAV (in a temporary database, with cleanup).
7. macOS launchd service installation for the UI and worker.
8. Local web server health at http://127.0.0.1:8787/healthz.

On first run .env includes generated BLOSSOM_ADMIN_PASSWORD, BLOSSOM_VAULT_KEY, BLOSSOM_MCP_READ_TOKEN and BLOSSOM_MCP_WRITE_TOKEN, and only local loopback host/port settings. Keys are never printed in a log or embedded in the launch agent. File permissions are set to 0600. Keep .env securely backed up separately from the SQLite database; losing the vault key makes encrypted credentials inaccessible. Fetch the login password locally with:

    grep '^BLOSSOM_ADMIN_PASSWORD=' .env

The launch agents are named:
- io.wenneker.blossom.server
- io.wenneker.blossom.dna-worker

They start on user login, restart if unexpectedly stopped, and write output to .data/logs/. The worker uses the same SQLite database and reference-audio directory as the web UI. To inspect agents:

    launchctl print gui/$(id -u)/io.wenneker.blossom.server
    launchctl print gui/$(id -u)/io.wenneker.blossom.dna-worker

To see the local web UI: http://127.0.0.1:8787/login. To manage services, use macOS launchctl with the installed plists under ~/Library/LaunchAgents. The installer does not delete existing third-party services or rewrite unrelated plists.

## Health checks and alternatives

    bash setup.sh --check        # Read only, no package/config/launchd changes
    bash setup.sh --no-services  # Install dependencies, config and tests without launchd
    bash setup.sh --headless     # Plain-text output for SSH/CI
    bash setup.sh --yes          # Allow unattended Homebrew bootstrap (may require sudo)

A check-only invocation requires an existing Node.js >=22.13 and .env and reports a failure if the local web server is not healthy. For a new system, run full setup first. If cargo cannot build the Ratatui UI because internet access is unavailable, retry when online or use bash setup.sh --headless. No installation or test failure is reported as success.

## What setup intentionally does not do

- Generate musical instrument, vocal or song structure claims without a model or evidence. Its audio smoke test verifies signal measurements, not instrument recognition.
- Automatically download protected recordings from streaming services or remove copyright restrictions.
- Configure Cloudflare DNS, user accounts, Access policies, tunnel credentials, or publish a local private endpoint. The cloudflared executable is installed only.
- Migrate data from SQLite into PostgreSQL. The Music DNA PostgreSQL migration is still a separate planned step.
- Install Draw Things models without choosing a supported model and explicit operator action.
- Automate Suno music generation or distributor release publication.
- Overwrite an existing administrator password, vault key, tokens or SQLite data.

The setup script can be rerun safely to add missing settings or dependencies. New environment settings are appended, not replaced. If an existing .env contains invalid or conflicting settings, the installer stops and asks for remediation rather than silently rotating secrets.
