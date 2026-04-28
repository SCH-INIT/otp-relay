#!/usr/bin/env bash
# =============================================================================
# setup_action-runner.sh — Install/configure GitHub Actions self-hosted runner
#
# Usage:
#   sudo bash setup_action-runner.sh <RUNNER_TOKEN> [arm64|x64] [RUNNER_NAME]
#   sudo bash setup_action-runner.sh <RUNNER_TOKEN> [RUNNER_NAME]
#
# Examples:
#   sudo bash setup_action-runner.sh ABC123...
#   sudo bash setup_action-runner.sh ABC123... arm64
#   sudo bash setup_action-runner.sh ABC123... runner-pi
#   sudo bash setup_action-runner.sh ABC123... arm64 runner-pi
#
# Notes:
#   - If no runner name is provided, the script prompts for one and defaults to
#     the host shortname.
#   - The bundled GitHub dependency helper is skipped by default to avoid noisy
#     legacy-package probe errors on modern Debian/Ubuntu systems. Set
#     RUN_BUNDLED_HELPER=1 to run it explicitly.
# =============================================================================

set -euo pipefail

BOLD="\033[1m"; GREEN="\033[92m"; YELLOW="\033[93m"; RED="\033[91m"
CYAN="\033[96m"; DIM="\033[2m"; RESET="\033[0m"

ok()      { echo -e "  ${GREEN}✓${RESET}  $*"; }
info()    { echo -e "  ${CYAN}→${RESET}  $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
fail()    { echo -e "  ${RED}✗${RESET}  $*"; }
section() { echo -e "\n${BOLD}$*${RESET}\n$(printf '─%.0s' {1..54})"; }

usage() {
  cat <<EOF
Usage:
  sudo bash $0 <RUNNER_TOKEN> [arm64|x64] [RUNNER_NAME]
  sudo bash $0 <RUNNER_TOKEN> [RUNNER_NAME]

Examples:
  sudo bash $0 ABC123...
  sudo bash $0 ABC123... arm64
  sudo bash $0 ABC123... runner-pi
  sudo bash $0 ABC123... arm64 runner-pi
EOF
}

[[ "${EUID}" -ne 0 ]] && { fail "Run with sudo."; usage; exit 1; }
[[ $# -lt 1 ]] && { fail "Missing runner token."; usage; exit 1; }

RUNNER_TOKEN="$1"
ARG2="${2:-}"
ARG3="${3:-}"
ARCH_OVERRIDE=""
RUNNER_NAME_INPUT=""
RUN_BUNDLED_HELPER="${RUN_BUNDLED_HELPER:-0}"

parse_optional_args() {
  local value
  for value in "${ARG2}" "${ARG3}"; do
    [[ -n "${value}" ]] || continue
    case "${value}" in
      arm64|aarch64|x64|amd64|x86_64)
        if [[ -n "${ARCH_OVERRIDE}" ]]; then
          fail "Architecture provided more than once."
          usage
          exit 1
        fi
        ARCH_OVERRIDE="${value}"
        ;;
      *)
        if [[ -n "${RUNNER_NAME_INPUT}" ]]; then
          fail "Runner name provided more than once."
          usage
          exit 1
        fi
        RUNNER_NAME_INPUT="${value}"
        ;;
    esac
  done
}

parse_optional_args

# Detect real non-root user who launched sudo
RUNNER_USER="${SUDO_USER:-}"
if [[ -z "${RUNNER_USER}" || "${RUNNER_USER}" == "root" ]]; then
  fail "Could not detect the normal server user automatically."
  fail "Run this as: sudo bash $0 <RUNNER_TOKEN> [arm64|x64] [RUNNER_NAME]"
  fail "Do not run it from a root login shell."
  exit 1
fi

RUNNER_HOME="$(getent passwd "${RUNNER_USER}" | cut -d: -f6)"
[[ -z "${RUNNER_HOME}" ]] && { fail "Could not determine home directory for ${RUNNER_USER}"; exit 1; }

RUNNER_DIR="${RUNNER_HOME}/actions-runner"
REPO_URL="https://github.com/psi1703/otp-relay-psi"
RUNNER_VERSION="2.325.0"
HOST_SHORT="$(hostname -s)"
RUNNER_NAME="${HOST_SHORT}"

OS_ID=""
OS_VERSION_ID=""
OS_PRETTY_NAME=""
RUNNER_ARCH=""
LABEL_ARCH=""
RUNNER_LABELS=""
SERVICE_NAME=""

pkg_exists() {
  apt-cache show "$1" >/dev/null 2>&1
}

install_first_available() {
  local pkg
  for pkg in "$@"; do
    if pkg_exists "$pkg"; then
      info "Installing package: $pkg"
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg"
      return 0
    fi
  done
  warn "None of these packages were available: $*"
  return 1
}

detect_os() {
  [[ -r /etc/os-release ]] || { fail "Cannot read /etc/os-release"; exit 1; }
  # shellcheck disable=SC1091
  . /etc/os-release

  OS_ID="${ID:-unknown}"
  OS_VERSION_ID="${VERSION_ID:-unknown}"
  OS_PRETTY_NAME="${PRETTY_NAME:-unknown}"

  ok "Detected OS: ${OS_PRETTY_NAME}"
}

choose_arch() {
  local detected
  detected="$(uname -m)"

  if [[ -n "${ARCH_OVERRIDE}" ]]; then
    case "${ARCH_OVERRIDE}" in
      arm64|aarch64)
        RUNNER_ARCH="arm64"
        LABEL_ARCH="ARM64"
        ;;
      x64|amd64|x86_64)
        RUNNER_ARCH="x64"
        LABEL_ARCH="X64"
        ;;
      *)
        fail "Unsupported architecture override: ${ARCH_OVERRIDE}"
        fail "Use one of: arm64, x64"
        exit 1
        ;;
    esac
    ok "Using architecture override: ${RUNNER_ARCH}"
    return 0
  fi

  case "${detected}" in
    aarch64|arm64)
      RUNNER_ARCH="arm64"
      LABEL_ARCH="ARM64"
      ;;
    x86_64|amd64)
      RUNNER_ARCH="x64"
      LABEL_ARCH="X64"
      ;;
    *)
      fail "Unsupported machine architecture: ${detected}"
      fail "Run with explicit override if needed: sudo bash $0 <RUNNER_TOKEN> [arm64|x64] [RUNNER_NAME]"
      exit 1
      ;;
  esac

  ok "Detected machine architecture: ${detected} -> ${RUNNER_ARCH}"
}

choose_runner_name() {
  local candidate=""
  local default_name="${HOST_SHORT}"

  if [[ -n "${RUNNER_NAME_INPUT}" ]]; then
    candidate="${RUNNER_NAME_INPUT}"
  elif [[ -t 0 ]]; then
    read -r -p "Enter runner name [${default_name}]: " candidate
  fi

  [[ -n "${candidate}" ]] || candidate="${default_name}"

  while true; do
    if [[ "${candidate}" =~ ^[A-Za-z0-9._-]+$ ]]; then
      RUNNER_NAME="${candidate}"
      ok "Runner name: ${RUNNER_NAME}"
      return 0
    fi

    warn "Runner name can only contain letters, numbers, dots, underscores, and hyphens."
    if [[ -t 0 ]]; then
      read -r -p "Enter runner name [${default_name}]: " candidate
      [[ -n "${candidate}" ]] || candidate="${default_name}"
    else
      fail "Invalid runner name: ${candidate}"
      exit 1
    fi
  done
}

set_runner_labels() {
  RUNNER_LABELS="self-hosted,Linux,${LABEL_ARCH}"
  ok "Runner labels: ${RUNNER_LABELS}"
}

install_dependencies() {
  section "5/8  Install runner dependencies"

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq

  apt-get install -y -qq \
    curl \
    tar \
    jq \
    unzip \
    ca-certificates \
    git

  case "${OS_ID}" in
    ubuntu|debian|raspbian)
      install_first_available libssl3t64 libssl3 libssl1.1 || true
      install_first_available \
        libicu76 \
        libicu75 \
        libicu74 \
        libicu72 \
        libicu71 \
        libicu70 \
        libicu69 \
        libicu68 \
        libicu67 \
        libicu66 \
        libicu65 \
        libicu63 \
        libicu60 \
        libicu57 \
        libicu55 \
        libicu52 || true
      ;;
    *)
      warn "No apt dependency map defined for OS: ${OS_ID}"
      ;;
  esac

  ok "Dependency installation step completed"
}

configure_needrestart() {
  if [[ -d /etc/needrestart/conf.d ]]; then
    echo '$nrconf{override_rc}{qr(^actions\.runner\..+\.service$)} = 0;' > /etc/needrestart/conf.d/actions_runner_services.conf
    ok "Configured needrestart to ignore GitHub runner service"
  fi
}

download_and_extract_runner() {
  section "6/8  Download and extract runner"

  mkdir -p "${RUNNER_DIR}"
  chown -R "${RUNNER_USER}:${RUNNER_USER}" "${RUNNER_DIR}"

  RUNNER_ARCHIVE="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
  RUNNER_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}"

  sudo -u "${RUNNER_USER}" bash <<EOF
set -euo pipefail
cd "${RUNNER_DIR}"

if [[ ! -f "${RUNNER_ARCHIVE}" ]]; then
  curl -fL -o "${RUNNER_ARCHIVE}" "${RUNNER_URL}"
fi

if [[ ! -f "./config.sh" ]]; then
  tar xzf "${RUNNER_ARCHIVE}"
fi
EOF

  ok "Runner package ready"
}

configure_runner() {
  section "7/8  Configure runner"

  if [[ -f "${RUNNER_DIR}/.runner" ]]; then
    local existing_name=""
    existing_name="$(sudo -u "${RUNNER_USER}" jq -r '.agentName // empty' "${RUNNER_DIR}/.runner" 2>/dev/null || true)"
    warn "Runner already configured at ${RUNNER_DIR}"
    [[ -n "${existing_name}" ]] && warn "Existing runner name: ${existing_name}"
    if [[ -n "${existing_name}" && "${existing_name}" != "${RUNNER_NAME}" ]]; then
      warn "Requested runner name '${RUNNER_NAME}' was not applied because the runner is already configured."
      warn "Remove and reconfigure the runner if you want to rename it."
    fi
    return 0
  fi

  sudo -u "${RUNNER_USER}" bash <<EOF
set -euo pipefail
cd "${RUNNER_DIR}"
./config.sh \
  --url "${REPO_URL}" \
  --token "${RUNNER_TOKEN}" \
  --name "${RUNNER_NAME}" \
  --labels "${RUNNER_LABELS}" \
  --unattended \
  --replace
EOF

  ok "Runner configured"
}

maybe_run_bundled_helper() {
  cd "${RUNNER_DIR}"

  if [[ "${RUN_BUNDLED_HELPER}" == "1" ]]; then
    if [[ -x "./bin/installdependencies.sh" ]]; then
      warn "RUN_BUNDLED_HELPER=1 set — running bundled dependency helper"
      ./bin/installdependencies.sh
    fi
  else
    info "Skipping bundled dependency helper to avoid legacy package probe noise"
  fi
}

install_and_start_service() {
  section "8/8  Install and start service"

  cd "${RUNNER_DIR}"

  maybe_run_bundled_helper

  [[ -x "./svc.sh" ]] || { fail "svc.sh not found in ${RUNNER_DIR}"; exit 1; }

  if [[ -f "${RUNNER_DIR}/.service" ]]; then
    SERVICE_NAME="$(tr -d '\r\n' < "${RUNNER_DIR}/.service")"
  fi

  if [[ -n "${SERVICE_NAME}" ]] && systemctl list-unit-files --type=service | awk '{print $1}' | grep -Fxq "${SERVICE_NAME}"; then
    info "Runner service already installed: ${SERVICE_NAME}"
  else
    ./svc.sh install "${RUNNER_USER}"
    if [[ -f "${RUNNER_DIR}/.service" ]]; then
      SERVICE_NAME="$(tr -d '\r\n' < "${RUNNER_DIR}/.service")"
    fi
  fi

  ./svc.sh start
  sleep 2

  if [[ -n "${SERVICE_NAME}" ]]; then
    if systemctl is-active --quiet "${SERVICE_NAME}"; then
      ok "Runner service is active: ${SERVICE_NAME}"
    else
      fail "Runner service failed to start: ${SERVICE_NAME}"
      systemctl --no-pager --full status "${SERVICE_NAME}" || true
      exit 1
    fi
  else
    ok "Runner service installed and started"
  fi
}

echo -e "\n${BOLD}GitHub Actions Runner Setup${RESET}"
echo -e "${DIM}Repo: ${REPO_URL}${RESET}\n"

section "1/8  Validate runner user"
id "${RUNNER_USER}" >/dev/null 2>&1 || { fail "User '${RUNNER_USER}' does not exist"; exit 1; }
ok "Detected runner user: ${RUNNER_USER}"
ok "Runner home: ${RUNNER_HOME}"

section "2/8  Detect OS"
detect_os

section "3/8  Detect runner platform"
choose_arch
set_runner_labels

section "4/8  Runner identity"
choose_runner_name

install_dependencies
configure_needrestart
download_and_extract_runner
configure_runner
install_and_start_service

echo ""
ok "Runner setup complete"
echo -e "  ${DIM}Runner name: ${RUNNER_NAME}${RESET}"
echo -e "  ${DIM}Labels: ${RUNNER_LABELS}${RESET}"
if [[ -n "${SERVICE_NAME}" ]]; then
  echo -e "  ${DIM}Service: ${SERVICE_NAME}${RESET}"
fi
echo -e "  ${DIM}Check GitHub -> Settings -> Actions -> Runners to confirm it is online.${RESET}"
