#!/bin/bash
# Auto-deploy solarchat: pull latest, rebuild if changed, restart service
# Dipanggil oleh systemd timer setiap 1 menit.

APP_DIR="/home/inu/workspaces/pribadi/projects/solarchat"
SERVICE="solarchat"
LOG="/home/inu/workspaces/pribadi/projects/solarchat/deploy.log"
LOCK="/tmp/solarchat-deploy.lock"
GIT_BIN="/usr/bin/git"
BUN_BIN="/home/inu/.bun/bin/bun"

# Hindari proses berjalan bersamaan
if [ -f "$LOCK" ]; then
    pid=$(cat "$LOCK" 2>/dev/null)
    if kill -0 "$pid" 2>/dev/null; then
        exit 0
    fi
    rm -f "$LOCK"
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

cd "$APP_DIR" || exit 1

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"
}

# Fetch remote
if ! $GIT_BIN fetch origin 2>&1 >> "$LOG"; then
    log "Gagal fetch origin"
    exit 1
fi

# Cek apakah ada perubahan (local vs origin/main)
LOCAL_HASH=$($GIT_BIN rev-parse HEAD 2>/dev/null)
REMOTE_HASH=$($GIT_BIN rev-parse origin/main 2>/dev/null)

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    # Tidak ada perubahan; pastikan service tetap hidup
    if ! systemctl is-active --quiet "$SERVICE"; then
        log "Service mati — restart manual"
        sudo systemctl restart "$SERVICE" 2>&1 >> "$LOG"
    fi
    exit 0
fi

log "Deteksi update: $LOCAL_HASH -> $REMOTE_HASH — mulai deploy"

# Build
if ! $GIT_BIN pull origin main 2>&1 >> "$LOG"; then
    log "Gagal pull"
    exit 1
fi

if [ -f "bun.lock" ] || [ -f "package.json" ]; then
    $BUN_BIN install 2>&1 >> "$LOG"
fi

if ! $BUN_BIN run build 2>&1 >> "$LOG"; then
    log "Build GAGAL — service tidak di-restart"
    exit 1
fi

# Restart service
if ! sudo systemctl restart "$SERVICE" 2>&1 >> "$LOG"; then
    log "Restart service GAGAL"
    exit 1
fi

log "Deploy berhasil ke $REMOTE_HASH"
exit 0
