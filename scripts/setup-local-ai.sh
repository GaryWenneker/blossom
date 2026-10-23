#!/usr/bin/env bash
# Explicit one-time local background AI installer. No ChatGPT cookie access.
set -Eeuo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then echo "macOS required" >&2; exit 2; fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
MODEL="${BLOSSOM_LOCAL_AI_MODEL:-qwen3:8b}"
if [[ ! "$MODEL" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,99}$ ]]; then echo "Invalid local model identifier" >&2; exit 2; fi
if ! command -v brew >/dev/null 2>&1; then echo "Run bash setup.sh to install Homebrew first." >&2; exit 1; fi
if ! command -v ollama >/dev/null 2>&1; then
  echo "[local-ai] Installing Ollama via Homebrew..."
  brew install ollama
fi
echo "[local-ai] Starting Ollama on the Mac (headless)..."
brew services start ollama
ready=0
for _ in $(seq 1 35); do
  if curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [[ "$ready" != "1" ]]; then
  echo "[local-ai] No response on localhost:11434. Check brew services list." >&2; exit 1
fi
echo "[local-ai] Downloading the model; this requires several gigabytes of storage..."
ollama pull "$MODEL"
echo "[local-ai] Installed models:"
ollama list
echo "[local-ai] Ready. Restart Blossom and use Genereer automatisch (lokaal)."
