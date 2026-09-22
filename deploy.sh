#!/bin/bash
# Auto-deploy solarchat: pull latest, rebuild if changed, restart service
# Dipanggil oleh systemd timer setiap 1 menit.

APP_DIR="/home/inu/workspaces/pribadi/projects/solarchat"
SERVICE="solarchat"
LOG="/home/inu/workspaces/pribadi/projects/solarchat/deploy.log"
LOCK="/tmp/solarchat-deploy.lock"
GIT_BIN="/usr/bin/git"
BUN_BIN="/home/inu/.bun/bin/bun"
# Secret dari Doppler (lihat scripts/setup-doppler-server.sh). Kosong/tidak ada = dilewati.
DOPPLER_ENV_FILE="/home/inu/.config/solarchat/doppler.env"
SECRETS_HASH_FILE="/home/inu/.config/solarchat/secrets.sha256"

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

# Benar (0) bila isi secret Doppler berbeda dari yang terakhir dicatat. Isi secret tidak pernah ditulis ke log.
secrets_changed() {
    local doppler_bin token secrets hash
    doppler_bin=$(command -v doppler || true)
    [ -n "$doppler_bin" ] && [ -f "$DOPPLER_ENV_FILE" ] || return 1
    token=$(sed -n 's/^DOPPLER_TOKEN=//p' "$DOPPLER_ENV_FILE")
    [ -n "$token" ] || return 1
    secrets=$(DOPPLER_TOKEN="$token" "$doppler_bin" secrets download --no-file --format env 2>/dev/null) || return 1
    hash=$(printf '%s' "$secrets" | sha256sum | cut -d' ' -f1)
    [ "$hash" = "$(cat "$SECRETS_HASH_FILE" 2>/dev/null)" ] && return 1
    echo "$hash" > "$SECRETS_HASH_FILE"
    return 0
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
    # Kode sama, tapi secret di Doppler berubah: restart agar nilai baru terbaca.
    if secrets_changed; then
        log "Secret Doppler berubah — restart service"
        sudo systemctl restart "$SERVICE" 2>&1 >> "$LOG"
        exit 0
    fi
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

secrets_changed || true  # catat versi secret yang baru saja dipakai saat restart
log "Deploy berhasil ke $REMOTE_HASH"
exit 0
