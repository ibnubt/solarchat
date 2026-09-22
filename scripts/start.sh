#!/usr/bin/env bash
# Entry point service solarchat (dipasang oleh scripts/setup-doppler-server.sh).
# Bila DOPPLER_TOKEN ada, secret Doppler disuntikkan ke environment dan menang atas .env;
# variabel yang tidak ada di Doppler tetap dibaca Bun dari .env. Tanpa token: hanya .env.
set -euo pipefail

cd "$(dirname "$0")/.."
CONFIG_DIR="${SOLARCHAT_CONFIG_DIR:-/home/inu/.config/solarchat}"
BUN_BIN="${BUN_BIN:-/home/inu/.bun/bin/bun}"
DOPPLER_BIN="$(command -v doppler || true)"

if [ -n "${DOPPLER_TOKEN:-}" ] && [ -n "$DOPPLER_BIN" ]; then
    # Fallback terenkripsi: aplikasi tetap bisa start memakai secret terakhir bila Doppler tidak terjangkau.
    exec "$DOPPLER_BIN" run --fallback "$CONFIG_DIR/doppler-fallback.json" -- "$BUN_BIN" build/index.js
fi

exec "$BUN_BIN" build/index.js
