#!/usr/bin/env bash
# =============================================================================
# setup_action-runner.sh - Install/configure GitHub Actions self-hosted runner
# Ubuntu 24.04 VM / company server
#
# Usage:
#   sudo bash setup_action-runner.sh <RUNNER_TOKEN> [arm64|x64] [RUNNER_NAME]
#   sudo bash setup_action-runner.sh <RUNNER_TOKEN> [RUNNER_NAME]
#
# Examples:
#   sudo bash setup_action-runner.sh ABC123...
#   sudo bash setup_action-runner.sh ABC123... x64
#   sudo bash setup_action-runner.sh ABC123... srvotp26-runner
#   sudo bash setup_action-runner.sh ABC123... x64 srvotp26-runner
#
# Optional environment overrides:
#   OTP_RELAY_RUNNER_USER=<server-user> sudo -E bash setup_action-runner.sh <TOKEN>
#   RUNNER_VERSION=2.325.0 sudo -E bash setup_action-runner.sh <TOKEN>
#   RUN_BUNDLED_HELPER=1 sudo -E bash setup_action-runner.sh <TOKEN>
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
  cat <<EOF_USAGE
Usage:
  sudo bash $0 <RUNNER_TOKEN> [arm64|x64] [RUNNER_NAME]
  sudo bash $0 <RUNNER_TOKEN> [RUNNER_NAME]

Examples:
  sudo bash $0 ABC123...
  sudo bash $0 ABC123... x64
  sudo bash $0 ABC123... srvotp26-runner
  sudo bash $0 ABC123... x64 srvotp26-runner

Optional environment overrides:
  OTP_RELAY_RUNNER_USER=<server-user> sudo -E bash $0 <TOKEN>
  RUNNER_VERSION=2.325.0 sudo -E bash $0 <TOKEN>
EOF_USAGE
}

[[ "${EUID}" -ne 0 ]] && { fail "Run with sudo."; usage; exit 1; }
[[ $# -lt 1 ]] && { fail "Missing runner token."; usage; exit 1; }

RUNNER_TOKEN="$1"
ARG2="${2:-}"
ARG3="${3:-}"
ARCH_OVERRIDE=""
RUNNER_NAME_INPUT=""
RUN_BUNDLED_HELPER="${RUN_BUNDLED_HELPER:-0}"

REPO_URL="https://github.com/SCH-INIT/otp-relay"
RUNNER_VERSION="${RUNNER_VERSION:-2.325.0}"
HOST_SHORT="$(hostname -s)"
RUNNER_NAME="${HOST_SHORT}"
OS_ID=""
OS_VERSION_ID=""
OS_PRETTY_NAME=""
RUNNER_ARCH=""
LABEL_ARCH=""
RUNNER_LABELS=""
SERVICE_NAME=""

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

resolve_runner_user() {
  local candidate="${OTP_RELAY_RUNNER_USER:-${GITHUB_RUNNER_USER:-}}"

  if [[ -z "${candidate}" || "${candidate}" == "root" ]]; then
    candidate="${SUDO_USER:-}"
  fi

  if [[ -z "${candidate}" || "${candidate}" == "root" ]]; then
    fail "Could not detect the normal server user automatically."
    fail "Run from a sudo session, or pass: OTP_RELAY_RUNNER_USER=<server-user> sudo -E bash $0 <TOKEN>"
    exit 1
  fi

  if ! id "${candidate}" >/dev/null 2>&1; then
    fail "Runner user does not exist: ${candidate}"
    exit 1
  fi

  RUNNER_USER="${candidate}"
  RUNNER_HOME="$(getent passwd "${RUNNER_USER}" | cut -d: -f6)"
  [[ -n "${RUNNER_HOME}" ]] || { fail "Could not determine home directory for ${RUNNER_USER}"; exit 1; }
  RUNNER_DIR="${RUNNER_HOME}/actions-runner"

  ok "Runner user: ${RUNNER_USER}"
  ok "Runner home: ${RUNNER_HOME}"
}

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
      arm64|aarch64) RUNNER_ARCH="arm64"; LABEL_ARCH="ARM64" ;;
      x64|amd64|x86_64) RUNNER_ARCH="x64"; LABEL_ARCH="X64" ;;
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
    aarch64|arm64) RUNNER_ARCH="arm64"; LABEL_ARCH="ARM64" ;;
    x86_64|amd64) RUNNER_ARCH="x64"; LABEL_ARCH="X64" ;;
    *)
      fail "Unsupported machine architecture: ${detected}"
      fail "Run with explicit override if needed: sudo bash $0 <TOKEN> [arm64|x64] [RUNNER_NAME]"
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
  section "5/8 Install runner dependencies"
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
    ubuntu|debian)
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
  section "6/8 Download and extract runner"
  mkdir -p "${RUNNER_DIR}"
  chown -R "${RUNNER_USER}:${RUNNER_USER}" "${RUNNER_DIR}"

  local runner_archive="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
  local runner_url="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${runner_archive}"
  local archive_path="${RUNNER_DIR}/${runner_archive}"

  if [[ -x "${RUNNER_DIR}/config.sh" && -x "${RUNNER_DIR}/run.sh" ]]; then
    ok "Runner package already exists at ${RUNNER_DIR}"
    return 0
  fi

  info "Downloading ${runner_archive}"
  sudo -u "${RUNNER_USER}" curl -fsSL "${runner_url}" -o "${archive_path}"

  info "Extracting runner package"
  sudo -u "${RUNNER_USER}" tar -xzf "${archive_path}" -C "${RUNNER_DIR}"
  rm -f "${archive_path}"
  chown -R "${RUNNER_USER}:${RUNNER_USER}" "${RUNNER_DIR}"
  ok "Runner extracted"
}

configure_runner() {
  section "7/8 Configure runner"
  cd "${RUNNER_DIR}"

  if [[ "${RUN_BUNDLED_HELPER}" == "1" && -x ./bin/installdependencies.sh ]]; then
    info "Running bundled dependency helper"
    ./bin/installdependencies.sh || warn "Bundled dependency helper reported a non-fatal issue"
  else
    ok "Skipped bundled dependency helper"
  fi

  if [[ -f "${RUNNER_DIR}/.runner" ]]; then
    local existing_name=""
    existing_name="$(sudo -u "${RUNNER_USER}" bash -lc "cd '${RUNNER_DIR}' && ./config.sh --check 2>/dev/null | sed -n 's/^Runner name: //p' | head -1" || true)"
    warn "Runner already configured at ${RUNNER_DIR}"
    [[ -n "${existing_name}" ]] && warn "Existing runner name: ${existing_name}"
    if [[ -n "${existing_name}" && "${existing_name}" != "${RUNNER_NAME}" ]]; then
      warn "Requested runner name '${RUNNER_NAME}' was not applied because the runner is already configured."
      warn "Remove and reconfigure the runner if you want to rename it."
    fi
    return 0
  fi

  sudo -u "${RUNNER_USER}" ./config.sh \
    --url "${REPO_URL}" \
    --token "${RUNNER_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABELS}" \
    --work "_work" \
    --unattended \
    --replace

  ok "Runner configured"
}

install_and_start_service() {
  section "8/8 Install and start service"
  cd "${RUNNER_DIR}"

  if [[ -x ./svc.sh ]]; then
    ./svc.sh install "${RUNNER_USER}" || true
    ./svc.sh start
    SERVICE_NAME="$(systemctl list-units --type=service --all --no-legend 'actions.runner.*.service' | awk '{print $1}' | grep 'SCH-INIT-otp-relay' | head -1 || true)"
    ok "Runner service installed and started"
  else
    fail "svc.sh not found in ${RUNNER_DIR}"
    exit 1
  fi
}

main() {
  parse_optional_args

  echo -e "\n${BOLD}OTP Relay — GitHub Actions Runner Setup${RESET}"
  echo -e "${DIM}Ubuntu 24.04 VM / company server${RESET}\n"

  section "1/8 Runner user"
  resolve_runner_user

  section "2/8 Detect OS"
  detect_os

  section "3/8 Detect runner platform"
  choose_arch
  set_runner_labels

  section "4/8 Runner identity"
  choose_runner_name

  install_dependencies
  configure_needrestart
  download_and_extract_runner
  configure_runner
  install_and_start_service

  echo ""
  ok "Runner setup complete"
  echo -e "  ${DIM}Repository: ${REPO_URL}${RESET}"
  echo -e "  ${DIM}Runner name: ${RUNNER_NAME}${RESET}"
  echo -e "  ${DIM}Labels: ${RUNNER_LABELS}${RESET}"
  if [[ -n "${SERVICE_NAME}" ]]; then
    echo -e "  ${DIM}Service: ${SERVICE_NAME}${RESET}"
  fi
  echo -e "  ${DIM}Check GitHub -> Settings -> Actions -> Runners to confirm it is online.${RESET}"
}

main "$@"
