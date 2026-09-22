#!/usr/bin/env bash
# Jalankan SEKALI di server (sebagai user inu, dari folder aplikasi):
#   bash scripts/setup-doppler-server.sh
# Memasang Doppler CLI, menyimpan service token, dan mengarahkan service solarchat ke scripts/start.sh.
# Batalkan kapan saja dengan:
#   sudo rm /etc/systemd/system/solarchat.service.d/doppler.conf && sudo systemctl daemon-reload && sudo systemctl restart solarchat
set -euo pipefail

SERVICE="solarchat"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR="${SOLARCHAT_CONFIG_DIR:-/home/inu/.config/solarchat}"
DROPIN_DIR="/etc/systemd/system/${SERVICE}.service.d"

step() { printf '\n==> %s\n' "$1"; }

step "1/5 Doppler CLI"
if ! command -v doppler >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
        curl -sLf --retry 3 --tlsv1.2 --proto "=https" 'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' \
            | sudo gpg --dearmor --yes -o /usr/share/keyrings/doppler-archive-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" \
            | sudo tee /etc/apt/sources.list.d/doppler-cli.list >/dev/null
        sudo apt-get update && sudo apt-get install -y doppler
    else
        (curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh || wget -t 3 -qO- https://cli.doppler.com/install.sh) | sudo sh
    fi
fi
doppler --version

step "2/5 Service token"
echo "Buat di dashboard Doppler: project solarchat → config prd → Access → Generate (akses Read)."
read -rsp "Tempel token (dp.st.…): " TOKEN
echo
case "$TOKEN" in dp.st.*) ;; *) echo "Token harus diawali dp.st." >&2; exit 1 ;; esac
if ! SECRETS=$(DOPPLER_TOKEN="$TOKEN" doppler secrets download --no-file --format env 2>&1); then
    echo "Token ditolak Doppler: $SECRETS" >&2
    exit 1
fi
echo "Token valid: $(printf '%s\n' "$SECRETS" | grep -c '=' || true) secret terbaca."

step "3/5 Simpan token di $CONFIG_DIR (hanya bisa dibaca user ini)"
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"
umask 077
printf 'DOPPLER_TOKEN=%s\n' "$TOKEN" > "$CONFIG_DIR/doppler.env"
chmod 600 "$CONFIG_DIR/doppler.env"
chmod +x "$APP_DIR/scripts/start.sh"

step "4/5 Arahkan service $SERVICE ke scripts/start.sh"
echo "ExecStart saat ini:"
systemctl cat "$SERVICE" | grep -E '^\s*ExecStart=' || true
sudo mkdir -p "$DROPIN_DIR"
sudo tee "$DROPIN_DIR/doppler.conf" >/dev/null <<UNIT
[Service]
EnvironmentFile=$CONFIG_DIR/doppler.env
ExecStart=
ExecStart=$APP_DIR/scripts/start.sh
UNIT
sudo systemctl daemon-reload

step "5/5 Restart dan cek"
sudo systemctl restart "$SERVICE"
sleep 4
if systemctl is-active --quiet "$SERVICE"; then
    echo "OK: $SERVICE aktif dengan secret dari Doppler."
    echo "Secret baru cukup ditambahkan di Doppler; deploy.sh me-restart service dalam ±1 menit."
else
    echo "GAGAL: $SERVICE tidak aktif. Log terakhir:" >&2
    sudo journalctl -u "$SERVICE" -n 30 --no-pager >&2
    exit 1
fi
