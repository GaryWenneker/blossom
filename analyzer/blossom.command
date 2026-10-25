#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Voer eerst ./install.command uit." >&2; exit 1
fi
exec .venv/bin/python blossom_bridge.py "$@"
