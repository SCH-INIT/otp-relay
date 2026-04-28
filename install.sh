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

[[ "${EUID}" -ne 0 ]] && { fail "Run with sudo: sudo bash $0"; exit 1; }

INSTALL_DIR="/opt/otp-relay"
[[ ! -f "${INSTALL_DIR}/main.py" ]] && {
  fail "Run this from the cloned repo directory: sudo bash ${INSTALL_DIR}/install.sh"
  exit 1
}

SERVER_HOSTNAME=""
SERVER_IP=""
PORTAL_URL=""

load_env_server_values() {
  SERVER_HOSTNAME=""
  SERVER_IP=""

  [[ -f "${INSTALL_DIR}/.env" ]] || return 0

  while IFS='=' read -r key value; do
    value="${value%%#*}"
    value="$(printf '%s' "${value}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"

    case "${key}" in
      SERVER_HOSTNAME) SERVER_HOSTNAME="${value}" ;;
      SERVER_IP) SERVER_IP="${value}" ;;
    esac
  done < <(grep -E '^(SERVER_HOSTNAME|SERVER_IP)=' "${INSTALL_DIR}/.env" || true)
}

is_valid_ip() {
  python3.12 - "$1" <<'PY'
import ipaddress
import sys

value = (sys.argv[1] or "").strip()
try:
    ipaddress.ip_address(value)
except Exception:
    raise SystemExit(1)
PY
}

detect_install_hostname() {
  local detected=""
  detected="$(hostname -f 2>/dev/null || true)"
  [[ -n "${detected}" && "${detected}" != "(none)" ]] || detected="$(hostname -s 2>/dev/null || true)"
  [[ -n "${detected}" ]] || detected="localhost"
  printf '%s\n' "${detected}"
}

detect_install_ip() {
  local detected=""
  detected="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [[ -z "${detected}" ]]; then
    detected="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '/src/ {for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)"
  fi
  [[ -n "${detected}" ]] || detected="127.0.0.1"
  printf '%s\n' "${detected}"
}

select_install_server_values() {
  load_env_server_values

  if [[ -z "${SERVER_HOSTNAME}" || "${SERVER_HOSTNAME}" == "srvotp26.company.lan" ]]; then
    SERVER_HOSTNAME="$(detect_install_hostname)"
    warn "Using detected hostname for install-time config: ${SERVER_HOSTNAME}"
  fi

  if [[ -z "${SERVER_IP}" ]] || ! is_valid_ip "${SERVER_IP}"; then
    SERVER_IP="$(detect_install_ip)"
    warn "Using detected IP for install-time config: ${SERVER_IP}"
  fi

  PORTAL_URL="https://${SERVER_HOSTNAME}"
}

echo -e "\n${BOLD}OTP Relay — Install${RESET}"
echo -e "${DIM}Ubuntu 24.04 · Exchange SMTP${RESET}\n"

# ── 1. System packages ────────────────────────────────────────────────────────

section "1/8  System packages"
apt-get update -qq
apt-get install -y -qq \
  python3.12 \
  python3.12-venv \
  python3-pip \
  nginx \
  openssl \
  arping \
  gettext-base
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
mkdir -p "${INSTALL_DIR}/data"
chown -R otprelay:otprelay "${INSTALL_DIR}/data"
chmod 700 "${INSTALL_DIR}/data"
ok "data/ directory ready"

# ── 4. Python virtual environment ─────────────────────────────────────────────

section "4/8  Python virtual environment"
if [[ ! -f "${INSTALL_DIR}/venv/bin/uvicorn" ]]; then
  python3.12 -m venv "${INSTALL_DIR}/venv"
  "${INSTALL_DIR}/venv/bin/pip" install -q --upgrade fastapi uvicorn openpyxl python-dotenv bcrypt markdown pyyaml
  ok "venv created and packages installed"
else
  "${INSTALL_DIR}/venv/bin/pip" install -q --upgrade fastapi uvicorn openpyxl python-dotenv bcrypt markdown pyyaml
  ok "venv already exists — packages updated"
fi

# ── 5. Build Help Docs ────────────────────────────────────────────────────────

section "5/8  Build Help Docs"
cd "${INSTALL_DIR}"
"${INSTALL_DIR}/venv/bin/python" scripts/build_help_docs.py
ok "Help Docs built"

# ── 6. Configure .env ─────────────────────────────────────────────────────────

section "6/8  Environment configuration"
if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  cp "${INSTALL_DIR}/.env.template" "${INSTALL_DIR}/.env"
  warn ".env created from template — leave it as a template for now if you are not ready to start services."
  warn "  Later edit: sudo nano ${INSTALL_DIR}/.env"
  warn "  Required before first app start: SERVER_HOSTNAME, SERVER_IP, SMS_SECRET_TOKEN"
else
  ok ".env already exists (not overwritten)"
fi

# Pick safe install-time hostname/IP even if .env still contains placeholders.
select_install_server_values

# ── 7. Permissions ────────────────────────────────────────────────────────────

section "7/8  Permissions"
chown -R root:root "${INSTALL_DIR}"
chmod -R 755 "${INSTALL_DIR}"
find "${INSTALL_DIR}" -type f -not -path "${INSTALL_DIR}/venv/*" -exec chmod 644 {} \;
chmod +x "${INSTALL_DIR}/deploy_users.sh"
chmod +x "${INSTALL_DIR}/test_otp_relay.py"
chmod +x "${INSTALL_DIR}/install.sh"
chmod +x "${INSTALL_DIR}/update.sh"
chmod +x "${INSTALL_DIR}/monitor.py"
chown root:otprelay "${INSTALL_DIR}/.env"
chmod 640 "${INSTALL_DIR}/.env"
chown -R otprelay:otprelay "${INSTALL_DIR}/data"
chmod 700 "${INSTALL_DIR}/data"
[[ -f "${INSTALL_DIR}/data/users.xlsx" ]] && chmod 600 "${INSTALL_DIR}/data/users.xlsx"
[[ -f "${INSTALL_DIR}/data/audit.log"  ]] && chmod 600 "${INSTALL_DIR}/data/audit.log"
ok "Permissions set"

# ── 8. TLS certificate + nginx + systemd ─────────────────────────────────────

section "8/8  TLS + nginx + systemd"

if [[ ! -f /etc/ssl/otp-relay/server.crt ]]; then
  mkdir -p /etc/ssl/otp-relay
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/ssl/otp-relay/server.key \
    -out    /etc/ssl/otp-relay/server.crt \
    -subj   "/C=AE/O=INIT/CN=${SERVER_HOSTNAME}" \
    -addext "subjectAltName=DNS:${SERVER_HOSTNAME},IP:${SERVER_IP}"
  chmod 600 /etc/ssl/otp-relay/server.key
  chmod 644 /etc/ssl/otp-relay/server.crt
  ok "Self-signed certificate created (10 years) — ${SERVER_HOSTNAME} + ${SERVER_IP}"
else
  ok "TLS certificate already exists (not regenerated)"
  info "To regenerate with updated hostname/IP: sudo rm /etc/ssl/otp-relay/server.crt && sudo bash $0"
fi

SERVER_HOSTNAME="${SERVER_HOSTNAME}" SERVER_IP="${SERVER_IP}" \
  envsubst '${SERVER_HOSTNAME} ${SERVER_IP}' \
  < "${INSTALL_DIR}/nginx/otp-relay.conf.template" \
  > /etc/nginx/sites-available/otp-relay

ln -sf /etc/nginx/sites-available/otp-relay /etc/nginx/sites-enabled/otp-relay

if nginx -t; then
  systemctl enable nginx --now
  systemctl reload nginx
  ok "nginx configured and reloaded"
else
  fail "nginx config test failed"
  exit 1
fi

cp "${INSTALL_DIR}/systemd/otp-relay.service"   /etc/systemd/system/otp-relay.service
cp "${INSTALL_DIR}/systemd/otp-monitor.service" /etc/systemd/system/otp-monitor.service
systemctl daemon-reload
ok "systemd unit files installed"

echo ""
warn "Application services were intentionally NOT started."
warn "This matches the documented flow: edit .env first, then start otp-relay and otp-monitor."
info "Edit:   sudo nano ${INSTALL_DIR}/.env"
info "Start:  sudo systemctl start otp-relay"
info "Start:  sudo systemctl start otp-monitor"

ufw allow 80/tcp  >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw reload        >/dev/null 2>&1 || true

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Install complete${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  Portal:   ${CYAN}${PORTAL_URL}${RESET}"
echo -e "  Config:   sudo nano ${INSTALL_DIR}/.env"
echo -e "  Users:    sudo bash ${INSTALL_DIR}/deploy_users.sh"
echo -e "  Logs:     sudo journalctl -u otp-relay -f"
echo -e "  Monitor:  sudo journalctl -u otp-monitor -f"
echo -e "  Test:     python3 ${INSTALL_DIR}/test_otp_relay.py"
echo -e "  Update:   sudo bash ${INSTALL_DIR}/update.sh"
echo ""

# Optional next step:
# If this server should also act as a GitHub Actions self-hosted runner,
# run the following after install completes:
#   sudo bash /opt/otp-relay/setup_runner.sh <RUNNER_TOKEN>
