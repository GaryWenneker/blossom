#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew ontbreekt: installeer eerst via https://brew.sh"; exit 1
fi
brew install yt-dlp ffmpeg python@3.13
PYTHON="$(brew --prefix python@3.13)/bin/python3.13"
"$PYTHON" -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
mkdir -p audio downloads results
printf '\nInstallatie klaar. Test met:\n  ./blossom.command mcp-test\n  ./blossom.command list\n'
