#!/usr/bin/env bash
# =============================================================================
# update.sh — Pull latest code from git and restart the services
#
# Usage:
#   sudo bash /opt/otp-relay/update.sh
#   sudo bash /opt/otp-relay/update.sh --no-restart
# =============================================================================

set -euo pipefail

BOLD="\033[1m"; GREEN="\033[92m"; YELLOW="\033[93m"; RED="\033[91m"
CYAN="\033[96m"; DIM="\033[2m"; RESET="\033[0m"

ok()      { echo -e "  ${GREEN}✓${RESET}  $*"; }
info()    { echo -e "  ${CYAN}→${RESET}  $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
fail()    { echo -e "  ${RED}✗${RESET}  $*"; }

[[ "$EUID" -ne 0 ]] && { fail "Run with sudo: sudo bash $0"; exit 1; }

RESTART=true
[[ "${1:-}" == "--no-restart" ]] && RESTART=false

INSTALL_DIR="/opt/otp-relay"
cd "$INSTALL_DIR"

echo -e "\n${BOLD}OTP Relay — Update${RESET}\n"

# ── 1. Pull latest code ───────────────────────────────────────────────────────
info "Pulling latest code..."
git fetch origin main
git reset --hard origin/main
ok "Code updated"

# ── 2. Python packages ────────────────────────────────────────────────────────
info "Updating Python packages..."
"$INSTALL_DIR/venv/bin/pip" install -q --upgrade fastapi uvicorn openpyxl python-dotenv requests bcrypt markdown pyyaml
ok "Packages updated"

# ── 3. Permissions ────────────────────────────────────────────────────────────
chmod +x "$INSTALL_DIR/deploy_users.sh"    2>/dev/null || true
chmod +x "$INSTALL_DIR/test_otp_relay.py"  2>/dev/null || true
chmod +x "$INSTALL_DIR/install.sh"         2>/dev/null || true
chmod +x "$INSTALL_DIR/update.sh"          2>/dev/null || true
chmod +x "$INSTALL_DIR/monitor.py"         2>/dev/null || true

# ── 4. Sync systemd units ─────────────────────────────────────────────────────
# Copy any updated unit files and reload systemd so changes take effect.
# A daemon-reload is safe to run at any time — it does not restart services.
UNITS_CHANGED=false
for unit in "$INSTALL_DIR"/systemd/*.service; do
  name=$(basename "$unit")
  dest="/etc/systemd/system/$name"
  if [[ ! -f "$dest" ]] || ! cmp -s "$unit" "$dest"; then
    cp "$unit" "$dest"
    ok "systemd unit updated: $name"
    UNITS_CHANGED=true
  fi
done

if $UNITS_CHANGED; then
  systemctl daemon-reload
  ok "systemd daemon reloaded"
else
  ok "systemd units unchanged"
fi

# ── 5. Restart services ───────────────────────────────────────────────────────
if $RESTART; then
  info "Restarting services..."

  systemctl restart otp-relay
  sleep 2
  if systemctl is-active --quiet otp-relay; then
    ok "otp-relay restarted successfully"
  else
    fail "otp-relay failed to restart — check: sudo journalctl -u otp-relay -n 30"
    exit 1
  fi

  systemctl restart otp-monitor 2>/dev/null && {
    sleep 2
    if systemctl is-active --quiet otp-monitor; then
      ok "otp-monitor restarted successfully"
    else
      fail "otp-monitor failed to restart — check: sudo journalctl -u otp-monitor -n 30"
    fi
  } || warn "otp-monitor not found — skipping"

else
  warn "Skipped restart (--no-restart). Run: sudo systemctl restart otp-relay otp-monitor"
fi

echo ""
ok "Update complete"
echo -e "  ${DIM}Portal: https://srvotp26.init-db.lan${RESET}\n"
