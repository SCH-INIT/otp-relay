#!/usr/bin/env bash
# =============================================================================
# update.sh — Pull latest code from git and restart the service
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

info "Pulling latest code..."
git pull origin main
ok "Code updated"

info "Updating Python packages..."
"$INSTALL_DIR/venv/bin/pip" install -q --upgrade fastapi uvicorn openpyxl python-dotenv
ok "Packages updated"

# Fix permissions on any new scripts
chmod +x "$INSTALL_DIR/deploy_users.sh"  2>/dev/null || true
chmod +x "$INSTALL_DIR/test_otp_relay.py" 2>/dev/null || true
chmod +x "$INSTALL_DIR/install.sh"        2>/dev/null || true
chmod +x "$INSTALL_DIR/update.sh"         2>/dev/null || true

if $RESTART; then
  info "Restarting service..."
  systemctl restart otp-relay
  sleep 2
  if systemctl is-active --quiet otp-relay; then
    ok "otp-relay restarted successfully"
  else
    fail "Service failed to restart — check: sudo journalctl -u otp-relay -n 30"
    exit 1
  fi
else
  warn "Skipped restart (--no-restart). Run: sudo systemctl restart otp-relay"
fi

echo ""
ok "Update complete"
echo -e "  ${DIM}Portal: https://srvotp26.init-db.lan${RESET}\n"
