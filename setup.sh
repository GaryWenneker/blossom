#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"
MODE="install"
HEADLESS=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check";;
    --headless) HEADLESS=1;;
    --yes) ASSUME_YES=1;;
    --no-services|--help|-h) ;;
    *) printf 'Unknown argument: %s\n' "$arg" >&2; exit 2;;
  esac
done
if [[ " $* " == *" --help "* ]] || [[ " $* " == *" -h "* ]]; then
  cat <<'HELP'
Blossom guided setup (macOS)
  bash setup.sh               install dependencies, validate, start local services
  bash setup.sh --check       read-only diagnostics (no installations/config writes)
  bash setup.sh --headless    plain-text output (CI/SSH without terminal)
  bash setup.sh --no-services install and verify, but do not manage launchd
  bash setup.sh --yes         allow unattended Homebrew bootstrap
Note: this uses Ratatui terminal UI, not an unrelated Ratatouille package.
HELP
  exit 0
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'This installer currently supports macOS only. Use the manual instructions for other systems.\n' >&2
  exit 2
fi
node_compatible() {
  command -v node >/dev/null 2>&1 &&
  node -e 'const [maj,min]=process.versions.node.split(".").map(Number);process.exit(maj>22||(maj===22&&min>=13)?0:1)' >/dev/null 2>&1
}
if [[ "$MODE" == "check" ]]; then
  if ! node_compatible; then
    printf 'Node.js >=22.13 is required to run checks. No changes made.\n' >&2
    exit 1
  fi
  exec node scripts/setup-blossom.mjs "$@"
fi
install_brew_package() {
  local package="$1"
  if ! brew list --formula "$package" >/dev/null 2>&1; then
    printf '[setup] Installing Homebrew package: %s\n' "$package"
    brew install "$package"
  fi
}
if ! command -v brew >/dev/null 2>&1; then
  printf '[setup] Homebrew is not installed.\n'
  if [[ "$ASSUME_YES" != "1" && ! -t 0 ]]; then
    printf '[setup] Rerun in a terminal to approve Homebrew installation or use --yes.\n' >&2
    exit 1
  fi
  if [[ "$ASSUME_YES" != "1" ]]; then
    read -r -p 'Install the official Homebrew package manager? [y/N] ' answer
    case "$answer" in y|Y|yes|YES) ;; *) exit 1;; esac
  fi
  if [[ "$ASSUME_YES" == "1" ]]; then
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  else
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v brew >/dev/null 2>&1; then
  printf '[setup] Homebrew installation failed.\n' >&2
  exit 1
fi
if ! node_compatible; then
  install_brew_package node@24
  export PATH="$(brew --prefix node@24)/bin:$PATH"
fi
if ! node_compatible; then
  printf '[setup] Node.js >=22.13 not found after installation.\n' >&2
  exit 1
fi
if ! command -v draw-things-cli >/dev/null 2>&1; then
  # Official Draw Things CLI uses the models downloaded by the app.
  install_brew_package drawthingsai/draw-things/draw-things-cli
fi
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  install_brew_package ffmpeg
fi
if ! command -v cargo >/dev/null 2>&1; then
  install_brew_package rust
fi
# Playwright uses a visible local Google Chrome profile. Never automate Google sign-in.
if [[ ! -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]] &&
   [[ ! -x "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
  printf '[setup] Installing Google Chrome for supervised Playwright handoff.\n'
  brew install --cask google-chrome
fi
if ! command -v cloudflared >/dev/null 2>&1; then
  # Install the client but never create an internet-facing tunnel automatically.
  install_brew_package cloudflared
fi
if [[ "$HEADLESS" == "1" || ! -t 0 || ! -t 1 ]]; then
  exec node scripts/setup-blossom.mjs "$@"
fi
if ! command -v cargo >/dev/null 2>&1; then
  printf '[setup] Cargo unavailable; falling back to plain-text setup.\n' >&2
  exec node scripts/setup-blossom.mjs "$@"
fi
cargo run --quiet --manifest-path setup/ratatui-installer/Cargo.toml --release -- "$@"
