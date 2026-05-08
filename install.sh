#!/usr/bin/env bash
# =============================================================================
# install.sh — Fresh install of OTP Relay from the git repository
# Ubuntu 24.04 LTS VM · Company LAN
#
# Usage:
#   git clone -b portal git@github.com:SCH-INIT/otp-relay.git /opt/otp-relay
#   cd /opt/otp-relay
#   sudo bash install.sh
# =============================================================================

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
  python3 - "$1" <<'PY'
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


find_self_hosted_runner_user() {
  # Prefer explicit configuration when the server uses a custom runner account.
  # Example:
  #   OTP_RELAY_RUNNER_USER=svc-ghrunner sudo -E bash install.sh
  local candidate="${OTP_RELAY_RUNNER_USER:-${GITHUB_RUNNER_USER:-}}"
  if [[ -n "${candidate}" ]] && id "${candidate}" &>/dev/null; then
    printf '%s\n' "${candidate}"
    return 0
  fi

  # If the GitHub Actions runner has already been installed, infer the account
  # from common runner directories under /home.
  local runner_dir=""
  for runner_dir in /home/*/actions-runner /home/*/actions-runner-*; do
    [[ -d "${runner_dir}" ]] || continue
    candidate="$(stat -c '%U' "${runner_dir}" 2>/dev/null || true)"
    if [[ -n "${candidate}" && "${candidate}" != "root" ]] && id "${candidate}" &>/dev/null; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  # When install.sh is run via sudo by the same account that will run the
  # self-hosted runner, SUDO_USER is a sensible fallback.
  candidate="${SUDO_USER:-}"
  if [[ -n "${candidate}" && "${candidate}" != "root" ]] && id "${candidate}" &>/dev/null; then
    printf '%s\n' "${candidate}"
    return 0
  fi

  return 1
}

apply_runner_managed_permissions() {
  local runner_user="${1:-}"
  [[ -n "${runner_user}" ]] || return 0

  # Generated Help Docs output. deploy-help-docs.yml rsyncs this directory
  # without sudo, so the self-hosted runner user must own it.
  mkdir -p "${INSTALL_DIR}/frontend/help"
  chown -R "${runner_user}:${runner_user}" "${INSTALL_DIR}/frontend/help"
  find "${INSTALL_DIR}/frontend/help" -type d -exec chmod 755 {} \;
  find "${INSTALL_DIR}/frontend/help" -type f -exec chmod 644 {} \;

  # Application-code workflow updates these runtime Python files directly.
  touch "${INSTALL_DIR}/main.py" \
        "${INSTALL_DIR}/monitor.py"

  chown "${runner_user}:${runner_user}" \
        "${INSTALL_DIR}/main.py" \
        "${INSTALL_DIR}/monitor.py"

  chmod 644 "${INSTALL_DIR}/main.py"
  chmod 755 "${INSTALL_DIR}/monitor.py"

  # Portal UI workflow deploys generated/static frontend artifacts.
  # app.jsx is source in the repo. The live portal serves generated app.js.
  touch "${INSTALL_DIR}/frontend/index.html" \
        "${INSTALL_DIR}/frontend/style.css" \
        "${INSTALL_DIR}/frontend/app.js" \
        "${INSTALL_DIR}/frontend/guide.html"

  chown "${runner_user}:${runner_user}" \
        "${INSTALL_DIR}/frontend/index.html" \
        "${INSTALL_DIR}/frontend/style.css" \
        "${INSTALL_DIR}/frontend/app.js" \
        "${INSTALL_DIR}/frontend/guide.html"

  chmod 644 \
        "${INSTALL_DIR}/frontend/index.html" \
        "${INSTALL_DIR}/frontend/style.css" \
        "${INSTALL_DIR}/frontend/app.js" \
        "${INSTALL_DIR}/frontend/guide.html"
}

echo -e "\n${BOLD}OTP Relay — Install${RESET}"
echo -e "${DIM}Ubuntu 24.04 LTS VM · Company LAN${RESET}\n"

# ── 1. System packages ────────────────────────────────────────────────────────

section "1/9  System packages"
apt-get update -qq
apt-get install -y -qq \
  python3 \
  python3-venv \
  python3-pip \
  nginx \
  openssl \
  arping \
  gettext-base \
  nodejs \
  npm
ok "Packages installed"

# ── 2. Service account ────────────────────────────────────────────────────────

section "2/9  Service account"
if ! id otprelay &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin otprelay
  ok "Created system user: otprelay"
else
  ok "System user otprelay already exists"
fi

# ── 3. Data directory ─────────────────────────────────────────────────────────

section "3/9  Data directory"
mkdir -p "${INSTALL_DIR}/data"
chown -R otprelay:otprelay "${INSTALL_DIR}/data"
chmod 700 "${INSTALL_DIR}/data"
ok "data/ directory ready"

# ── 4. Python virtual environment ─────────────────────────────────────────────

section "4/9  Python virtual environment"
if [[ ! -f "${INSTALL_DIR}/venv/bin/uvicorn" ]]; then
  python3 -m venv "${INSTALL_DIR}/venv"
  "${INSTALL_DIR}/venv/bin/pip" install -q --upgrade fastapi uvicorn openpyxl python-dotenv bcrypt markdown pyyaml
  ok "venv created and packages installed"
else
  "${INSTALL_DIR}/venv/bin/pip" install -q --upgrade fastapi uvicorn openpyxl python-dotenv bcrypt markdown pyyaml
  ok "venv already exists — packages updated"
fi

# ── 5. Build Portal UI ────────────────────────────────────────────────────────

section "5/9  Build Portal UI"
cd "${INSTALL_DIR}/frontend"

if [[ ! -f package.json ]]; then
  fail "frontend/package.json is missing — cannot build frontend/app.js"
  exit 1
fi

if [[ ! -f package-lock.json ]]; then
  fail "frontend/package-lock.json is missing — run npm install in frontend/ and commit the lockfile"
  exit 1
fi

npm ci --silent
npm run build --silent
test -s app.js

# node_modules is only needed during the install-time build. The live portal
# serves static app.js and should not keep npm dependencies in the live tree.
rm -rf node_modules

cd "${INSTALL_DIR}"
ok "Portal UI built: frontend/app.js"

# ── 6. Build Help Docs ────────────────────────────────────────────────────────

section "6/9  Build Help Docs"
cd "${INSTALL_DIR}"
"${INSTALL_DIR}/venv/bin/python" scripts/build_help_docs.py
ok "Help Docs built"

# ── 6b. Remove .git from install directory ───────────────────────────────────
# /opt/otp-relay is managed by the GitHub Actions runner going forward.
# The runner _work clone is the only git repo — /opt/otp-relay receives
# files copied by deploy scripts and must never be a git repo itself.

section "6b/9  Detach git from install directory"
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  rm -rf "${INSTALL_DIR}/.git"
  ok "Removed .git — /opt/otp-relay is now deploy-target only, not a git repo"
else
  ok ".git already absent"
fi

# ── 7. Configure .env ─────────────────────────────────────────────────────────

section "7/9  Environment configuration"
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

# ── 8. Permissions ────────────────────────────────────────────────────────────

section "8/9  Permissions"
chown -R root:root "${INSTALL_DIR}"
chmod -R 755 "${INSTALL_DIR}"
find "${INSTALL_DIR}" -type f -not -path "${INSTALL_DIR}/venv/*" -exec chmod 644 {} \;
chmod +x "${INSTALL_DIR}/deploy_users.sh"
chmod +x "${INSTALL_DIR}/test_otp_relay.py"
chmod +x "${INSTALL_DIR}/install.sh"
chmod +x "${INSTALL_DIR}/monitor.py"
chown root:otprelay "${INSTALL_DIR}/.env"
chmod 640 "${INSTALL_DIR}/.env"
chown -R otprelay:otprelay "${INSTALL_DIR}/data"
chmod 700 "${INSTALL_DIR}/data"
[[ -f "${INSTALL_DIR}/data/users.xlsx" ]] && chmod 600 "${INSTALL_DIR}/data/users.xlsx"
[[ -f "${INSTALL_DIR}/data/audit.log"  ]] && chmod 600 "${INSTALL_DIR}/data/audit.log"
# Allow the company-server self-hosted runner user to update files managed
# by the GitHub Actions deployment workflows. The username is detected instead
# of hard-coded so this installer works on servers that do not use a fixed
# account name. To override detection, set:
#   OTP_RELAY_RUNNER_USER=<username> sudo -E bash install.sh
RUNNER_USER="$(find_self_hosted_runner_user || true)"
if [[ -n "${RUNNER_USER}" ]]; then
  apply_runner_managed_permissions "${RUNNER_USER}"
  ok "Runner-managed deploy paths assigned to ${RUNNER_USER}"
else
  warn "No self-hosted runner user detected yet — skipping runner-managed path ownership."
  warn "After runner setup, re-run install.sh or apply the documented one-time permission repair."
fi
ok "Permissions set"

# ── 9. TLS certificate + nginx + systemd ─────────────────────────────────────

section "9/9  TLS + nginx + systemd"

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

# Disable default nginx site if present — it conflicts on port 80/443
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  rm /etc/nginx/sites-enabled/default
  ok "Removed default nginx site (would conflict on port 80/443)"
fi

if nginx -t; then
  systemctl enable nginx --now
  systemctl reload nginx
  ok "nginx configured and reloaded"
else
  fail "nginx config test failed"
  exit 1
fi

# Always stop any running instances before installing fresh unit files.
# This prevents stale processes from surviving a reinstall and running
# with a mismatched (old) ExecStart line.
info "Stopping any running otp-relay / otp-monitor instances..."
systemctl stop otp-relay  2>/dev/null || true
systemctl stop otp-monitor 2>/dev/null || true

cp "${INSTALL_DIR}/systemd/otp-relay.service"   /etc/systemd/system/otp-relay.service
cp "${INSTALL_DIR}/systemd/otp-monitor.service" /etc/systemd/system/otp-monitor.service
systemctl daemon-reload
systemctl enable otp-relay otp-monitor

# Verify systemd picked up the correct ExecStart from the repo unit file
EXPECTED_EXEC="$(grep '^ExecStart=' "${INSTALL_DIR}/systemd/otp-relay.service")"
LOADED_EXEC="$(systemctl cat otp-relay | grep '^ExecStart=')"
if [[ "${EXPECTED_EXEC}" != "${LOADED_EXEC}" ]]; then
  fail "systemd unit mismatch after daemon-reload — expected:"
  fail "  ${EXPECTED_EXEC}"
  fail "  got: ${LOADED_EXEC}"
  fail "Run: sudo systemctl daemon-reload && sudo systemctl start otp-relay"
  exit 1
fi

ok "systemd unit files installed and verified"

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
echo -e "  Updates:  push to GitHub — runner deploys automatically"
echo ""

# Optional next step:
# If this server should also act as a GitHub Actions self-hosted runner,
# run the following after install completes:
#   sudo bash /opt/otp-relay/setup_action-runner.sh <RUNNER_TOKEN>
