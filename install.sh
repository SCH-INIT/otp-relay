#!/usr/bin/env bash
# =============================================================================+
# install.sh — Fresh install of OTP Relay from the git repository
# Ubuntu 24.04 LTS · Exchange SMTP · LAN only
#
# Usage:
#   git clone git@github.com:SCH-INIT/otp-relay.git /opt/otp-relay
#   cd /opt/otp-relay
#   sudo bash install.sh
# =============================================================================+

set -euo pipefail

BOLD="\033[1m"; GREEN="\033[92m"; YELLOW="\033[93m"; RED="\033[91m"
CYAN="\033[96m"; DIM="\033[2m"; RESET="\033[0m"

ok()      { echo -e "  ${GREEN}✓${RESET}  $*"; }
info()    { echo -e "  ${CYAN}→${RESET}  $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
fail()    { echo -e "  ${RED}✗${RESET}  $*"; }
section() { echo -e "\n${BOLD}$*${RESET}\n$(printf '─%.0s' {1..54})"; }

[[ "$EUID" -ne 0 ]] && { fail "Run with sudo: sudo bash $0"; exit 1; }

INSTALL_DIR="/opt/otp-relay"
[[ ! -f "$INSTALL_DIR/main.py" ]] && {
  fail "Run this from the cloned repo directory: sudo bash $INSTALL_DIR/install.sh"
  exit 1
}

echo -e "\n${BOLD}OTP Relay — Install${RESET}"
echo -e "${DIM}Ubuntu 24.04 · Exchange SMTP${RESET}\n"

# ── 1. System packages ────────────────────────────────────────────────────────

section "1/8  System packages"
apt-get update -qq
apt-get install -y -qq python3.12 python3.12-venv python3-pip nginx openssl arping
ok "Packages installed"

# ── 2. Service account ────────────────────────────────────────────────────────

section "2/8  Service account"
if ! id otprelay &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin otprelay
  ok "Created system user: otprelay"
else
  ok "System user otprelay already exists"
fi

# ── 3. Data directory ─────────────────────────────────────────────────────────

section "3/8  Data directory"
mkdir -p "$INSTALL_DIR/data"
chown -R otprelay:otprelay "$INSTALL_DIR/data"
chmod 700 "$INSTALL_DIR/data"
ok "data/ directory ready"

# ── 4. Python virtual environment ─────────────────────────────────────────────

section "4/8  Python virtual environment"
if [[ ! -f "$INSTALL_DIR/venv/bin/uvicorn" ]]; then
  python3.12 -m venv "$INSTALL_DIR/venv"
  "$INSTALL_DIR/venv/bin/pip" install -q --upgrade fastapi uvicorn openpyxl python-dotenv bcrypt markdown pyyaml
  ok "venv created and packages installed"
else
  "$INSTALL_DIR/venv/bin/pip" install -q --upgrade fastapi uvicorn openpyxl python-dotenv bcrypt markdown pyyaml
  ok "venv already exists — packages updated"
fi

# ── 5. Build Help Docs ────────────────────────────────────────────────────────

section "5/8  Build Help Docs"
cd "$INSTALL_DIR"
"$INSTALL_DIR/venv/bin/python" scripts/build_help_docs.py
ok "Help Docs built"

# ── 6. Configure .env ─────────────────────────────────────────────────────────

section "6/8  Environment configuration"
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  cp "$INSTALL_DIR/.env.template" "$INSTALL_DIR/.env"
  warn ".env created from template — EDIT IT NOW before starting the service:"
  warn "  sudo nano $INSTALL_DIR/.env"
  warn "  Set: SMS_SECRET_TOKEN, SMTP_HOST, SMTP_USER, SMTP_PASSWORD"
else
  ok ".env already exists (not overwritten)"
fi

# ── 6. Permissions ────────────────────────────────────────────────────────────

# ── Load server config from .env ─────────────────────────────────────────────
# Source .env to get SERVER_HOSTNAME and SERVER_IP for cert and nginx generation.
# Fall back to placeholders if .env not yet configured.
if [[ -f "$INSTALL_DIR/.env" ]]; then
  set +u  # allow unset variables while sourcing
  # shellcheck disable=SC1090
  source <(grep -E "^(SERVER_HOSTNAME|SERVER_IP)=" "$INSTALL_DIR/.env" | sed 's/ *= */=/;s/[[:space:]]*#.*//')
  set -u
fi
SERVER_HOSTNAME="${SERVER_HOSTNAME:-srvotp26.company.lan}"
SERVER_IP="${SERVER_IP:-127.0.0.1}"
PORTAL_URL="https://${SERVER_HOSTNAME}"

section "7/8  Permissions"
chown -R root:root "$INSTALL_DIR"
chmod -R 755 "$INSTALL_DIR"
find "$INSTALL_DIR" -type f -not -path "$INSTALL_DIR/venv/*" -exec chmod 644 {} \;
chmod +x "$INSTALL_DIR/deploy_users.sh"
chmod +x "$INSTALL_DIR/test_otp_relay.py"
chmod +x "$INSTALL_DIR/install.sh"
chmod +x "$INSTALL_DIR/update.sh"
chmod +x "$INSTALL_DIR/monitor.py"
chown root:otprelay "$INSTALL_DIR/.env"
chmod 640 "$INSTALL_DIR/.env"
chown -R otprelay:otprelay "$INSTALL_DIR/data"
chmod 700 "$INSTALL_DIR/data"
[[ -f "$INSTALL_DIR/data/users.xlsx" ]] && chmod 600 "$INSTALL_DIR/data/users.xlsx"
[[ -f "$INSTALL_DIR/data/audit.log"  ]] && chmod 600 "$INSTALL_DIR/data/audit.log"
ok "Permissions set"

# ── 7. TLS certificate ────────────────────────────────────────────────────────

section "8/8  TLS + nginx + systemd"

if [[ ! -f /etc/ssl/otp-relay/server.crt ]]; then
  mkdir -p /etc/ssl/otp-relay
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/ssl/otp-relay/server.key \
    -out    /etc/ssl/otp-relay/server.crt \
    -subj   "/C=AE/O=INIT/CN=${SERVER_HOSTNAME}" \
    -addext "subjectAltName=DNS:${SERVER_HOSTNAME},IP:${SERVER_IP}" \
    2>/dev/null
  chmod 600 /etc/ssl/otp-relay/server.key
  chmod 644 /etc/ssl/otp-relay/server.crt
  ok "Self-signed certificate created (10 years) — ${SERVER_HOSTNAME} + ${SERVER_IP}"
else
  ok "TLS certificate already exists (not regenerated)"
  info "To regenerate with updated hostname/IP: sudo rm /etc/ssl/otp-relay/server.crt && sudo bash $0"
fi

SERVER_HOSTNAME="$SERVER_HOSTNAME" SERVER_IP="$SERVER_IP" \
  envsubst '${SERVER_HOSTNAME} ${SERVER_IP}' \
  < "$INSTALL_DIR/nginx/otp-relay.conf.template" \
  > /etc/nginx/sites-available/otp-relay
ln -sf /etc/nginx/sites-available/otp-relay /etc/nginx/sites-enabled/otp-relay
nginx -t 2>/dev/null && systemctl enable nginx --now && systemctl reload nginx
ok "nginx configured and reloaded"

cp "$INSTALL_DIR/systemd/otp-relay.service"   /etc/systemd/system/otp-relay.service
cp "$INSTALL_DIR/systemd/otp-monitor.service" /etc/systemd/system/otp-monitor.service
systemctl daemon-reload
systemctl enable otp-relay
systemctl enable otp-monitor

if [[ -f "$INSTALL_DIR/.env" ]] && ! grep -q "replace-with" "$INSTALL_DIR/.env"; then
  systemctl restart otp-relay
  sleep 2
  if systemctl is-active --quiet otp-relay; then
    ok "otp-relay service started"
  else
    fail "otp-relay failed to start — check: sudo journalctl -u otp-relay -n 30"
  fi
  systemctl restart otp-monitor
  sleep 2
  if systemctl is-active --quiet otp-monitor; then
    ok "otp-monitor service started"
  else
    fail "otp-monitor failed to start — check: sudo journalctl -u otp-monitor -n 30"
  fi
else
  warn "Services NOT started — finish editing .env first:"
  warn "  sudo nano $INSTALL_DIR/.env"
  warn "  sudo systemctl start otp-relay"
  warn "  sudo systemctl start otp-monitor"
fi

ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw reload        >/dev/null 2>&1 || true

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Install complete${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  Portal:   ${CYAN}${PORTAL_URL}${RESET}"
echo -e "  Config:   sudo nano $INSTALL_DIR/.env"
echo -e "  Users:    sudo bash $INSTALL_DIR/deploy_users.sh"
echo -e "  Logs:     sudo journalctl -u otp-relay -f"
echo -e "  Monitor:  sudo journalctl -u otp-monitor -f"
echo -e "  Test:     python3 $INSTALL_DIR/test_otp_relay.py"
echo -e "  Update:   sudo bash $INSTALL_DIR/update.sh"
echo ""

# Optional next step:
# If this server should also act as a GitHub Actions self-hosted runner,
# run the following after install completes:
#   sudo bash /opt/otp-relay/setup_runner.sh <RUNNER_TOKEN>
