#!/usr/bin/env bash
set -Eeuo pipefail

# Safe one-click installer/update script for psi1703/k8s OTP Relay on Debian-family servers.
# Installs/updates the portal app and the required monitor pod without touching SSH,
# CIFS mounts, cron jobs, firewall rules, or unrelated services.
#
# Normal use:
#   sudo bash install-otp-relay-k8s.sh
#
# Useful env vars:
#   REPO_URL=https://github.com/psi1703/k8s.git
#   REPO_REF=main
#   INSTALL_DIR=/opt/otp-relay-k8s
#   NAMESPACE=otp-relay
#   APP_IMAGE=otp-relay:latest
#   MONITOR_IMAGE=otp-monitor:latest
#   SERVICE_NODE_PORT=30080
#   INGRESS_ENABLED=1
#   PHONE_IP=172.31.10.161
#   PHONE_INTERFACE=eth0
#   PHONE_PING_INTERVAL=150
#   PHONE_OFFLINE_THRESHOLD=2
#   BATCH_WINDOW_SEC=10
#   ALERT_LEVEL=error
#   PORTAL_URL=http://server-or-dns-name
#   WHATSAPP_API_KEY=...
#   WHATSAPP_RECIPIENT=...
#   RUNTIME_DATA_DIR=/path/with/users.xlsx/admin_auth.json/admin_config.json/wizard_progress.json
#   SKIP_HELP_DOCS_BUILD=0|1
#   GIT_CLEAN=1|0
#   INSTALL_GITHUB_RUNNER=0|1
#   GITHUB_RUNNER_URL=https://github.com/psi1703/k8s
#   GITHUB_RUNNER_TOKEN=...
#   GITHUB_RUNNER_DIR=/opt/actions-runner
#   RUNNER_ONLY=0|1
#   DEPLOY_MODE=full|app|monitor|manifests|none
#   NONINTERACTIVE=0|1

log() { printf '[otp-relay-k8s] %s\n' "$*"; }
warn() { printf '[otp-relay-k8s] WARNING: %s\n' "$*" >&2; }
fatal() { printf '[otp-relay-k8s] ERROR: %s\n' "$*" >&2; exit 1; }
cmd_exists() { command -v "$1" >/dev/null 2>&1; }
need_root() { [ "$(id -u)" -eq 0 ] || fatal "run as root: sudo bash $0"; }

need_root
export DEBIAN_FRONTEND=noninteractive
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

REPO_URL="${REPO_URL:-https://github.com/psi1703/k8s.git}"
REPO_REF="${REPO_REF:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/otp-relay-k8s}"
NAMESPACE="${NAMESPACE:-otp-relay}"
APP_IMAGE="${APP_IMAGE:-otp-relay:latest}"
MONITOR_IMAGE="${MONITOR_IMAGE:-otp-monitor:latest}"
SERVICE_NODE_PORT="${SERVICE_NODE_PORT:-30080}"
INGRESS_ENABLED="${INGRESS_ENABLED:-1}"
SERVER_HOSTNAME="${SERVER_HOSTNAME:-$(hostname -f 2>/dev/null || hostname)}"
SERVER_IP="${SERVER_IP:-$(hostname -I 2>/dev/null | awk '{print $1}') }"
SERVER_IP="$(printf '%s' "$SERVER_IP" | xargs)"
SERVER_IP="${SERVER_IP:-127.0.0.1}"
PORTAL_URL="${PORTAL_URL:-http://$SERVER_IP}"
PHONE_IP="${PHONE_IP:-172.31.10.161}"
PHONE_INTERFACE="${PHONE_INTERFACE:-$(ip route show default 2>/dev/null | awk '{print $5; exit}') }"
PHONE_INTERFACE="$(printf '%s' "$PHONE_INTERFACE" | xargs)"
PHONE_INTERFACE="${PHONE_INTERFACE:-eth0}"
PHONE_PING_INTERVAL="${PHONE_PING_INTERVAL:-150}"
PHONE_OFFLINE_THRESHOLD="${PHONE_OFFLINE_THRESHOLD:-2}"
BATCH_WINDOW_SEC="${BATCH_WINDOW_SEC:-10}"
ALERT_LEVEL="${ALERT_LEVEL:-error}"
WHATSAPP_API_KEY="${WHATSAPP_API_KEY:-}"
WHATSAPP_RECIPIENT="${WHATSAPP_RECIPIENT:-}"
RUNTIME_DATA_DIR="${RUNTIME_DATA_DIR:-}"
SKIP_HELP_DOCS_BUILD="${SKIP_HELP_DOCS_BUILD:-0}"
GIT_CLEAN="${GIT_CLEAN:-1}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"
INSTALL_GITHUB_RUNNER="${INSTALL_GITHUB_RUNNER:-}"
GITHUB_RUNNER_URL="${GITHUB_RUNNER_URL:-${REPO_URL%.git}}"
GITHUB_RUNNER_TOKEN="${GITHUB_RUNNER_TOKEN:-}"
GITHUB_RUNNER_DIR="${GITHUB_RUNNER_DIR:-/opt/actions-runner}"
GITHUB_RUNNER_USER="${GITHUB_RUNNER_USER:-actions-runner}"
RUNNER_ONLY="${RUNNER_ONLY:-0}"
DEPLOY_MODE="${DEPLOY_MODE:-full}"
DOCKER_BIN="${DOCKER_BIN:-}"

OS_ID="unknown"
OS_NAME="unknown"
OS_VERSION_ID="unknown"
OS_LIKE=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_NAME="${PRETTY_NAME:-${NAME:-unknown}}"
  OS_VERSION_ID="${VERSION_ID:-unknown}"
  OS_LIKE="${ID_LIKE:-}"
fi

ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  x86_64|amd64) RUNNER_ARCH="x64" ;;
  aarch64|arm64) RUNNER_ARCH="arm64" ;;
  armv7l|armv6l|armhf) RUNNER_ARCH="arm" ;;
  *) RUNNER_ARCH="" ;;
esac

IS_RPI=0
if grep -qi 'raspberry pi' /proc/cpuinfo 2>/dev/null || grep -qi 'raspberry pi' /proc/device-tree/model 2>/dev/null; then
  IS_RPI=1
fi

is_debian_family() {
  case "$OS_ID $OS_LIKE" in
    *debian*|*ubuntu*|*raspbian*) return 0 ;;
    *) return 1 ;;
  esac
}

prompt_yes_no() {
  prompt="$1"
  default="${2:-N}"
  if [ "$NONINTERACTIVE" = "1" ]; then
    [ "$default" = "Y" ]
    return $?
  fi
  printf '%s ' "$prompt"
  read -r answer || answer=""
  answer="${answer:-$default}"
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

make_secret() {
  python3 - <<'PY' 2>/dev/null || tr -dc 'A-Fa-f0-9' </dev/urandom | head -c 64
import secrets
print(secrets.token_hex(32))
PY
}
SMS_SECRET_TOKEN="${SMS_SECRET_TOKEN:-$(make_secret)}"

write_runner_sudoers() {
  id -u "$GITHUB_RUNNER_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$GITHUB_RUNNER_USER"

  sudoers_file="/etc/sudoers.d/otp-relay-actions-runner"
  log "granting $GITHUB_RUNNER_USER narrow passwordless sudo for the OTP Relay installer"
  cat > "$sudoers_file" <<EOF_SUDOERS
$GITHUB_RUNNER_USER ALL=(root) NOPASSWD:SETENV: /bin/bash $INSTALL_DIR/install-otp-relay-k8s.sh
$GITHUB_RUNNER_USER ALL=(root) NOPASSWD:SETENV: /usr/bin/bash $INSTALL_DIR/install-otp-relay-k8s.sh
$GITHUB_RUNNER_USER ALL=(root) NOPASSWD:SETENV: /bin/bash $GITHUB_RUNNER_DIR/_work/*/*/install-otp-relay-k8s.sh
$GITHUB_RUNNER_USER ALL=(root) NOPASSWD:SETENV: /usr/bin/bash $GITHUB_RUNNER_DIR/_work/*/*/install-otp-relay-k8s.sh
EOF_SUDOERS
  chmod 0440 "$sudoers_file"
  visudo -cf "$sudoers_file" >/dev/null
}

install_github_runner() {
  [ "$INSTALL_GITHUB_RUNNER" = "1" ] || return 0

  write_runner_sudoers

  if systemctl list-unit-files | grep -q 'actions.runner'; then
    warn "an actions.runner systemd unit already exists; leaving existing runner registration untouched"
    return 0
  fi

  [ -n "$RUNNER_ARCH" ] || fatal "unsupported architecture for GitHub runner: $ARCH_RAW"
  [ -n "$GITHUB_RUNNER_URL" ] || fatal "INSTALL_GITHUB_RUNNER=1 requires GITHUB_RUNNER_URL"
  [ -n "$GITHUB_RUNNER_TOKEN" ] || fatal "INSTALL_GITHUB_RUNNER=1 requires GITHUB_RUNNER_TOKEN"

  log "installing GitHub Actions self-hosted runner before Docker/K3s deployment work"
  mkdir -p "$GITHUB_RUNNER_DIR"
  chown -R "$GITHUB_RUNNER_USER:$GITHUB_RUNNER_USER" "$GITHUB_RUNNER_DIR"

  runner_version="${GITHUB_RUNNER_VERSION:-2.328.0}"
  runner_tar="actions-runner-linux-${RUNNER_ARCH}-${runner_version}.tar.gz"
  runner_url="https://github.com/actions/runner/releases/download/v${runner_version}/${runner_tar}"
  curl -fL "$runner_url" -o "/tmp/$runner_tar"
  tar -xzf "/tmp/$runner_tar" -C "$GITHUB_RUNNER_DIR"
  rm -f "/tmp/$runner_tar"
  chown -R "$GITHUB_RUNNER_USER:$GITHUB_RUNNER_USER" "$GITHUB_RUNNER_DIR"

  sudo -u "$GITHUB_RUNNER_USER" bash -lc "cd '$GITHUB_RUNNER_DIR' && ./config.sh --unattended --url '$GITHUB_RUNNER_URL' --token '$GITHUB_RUNNER_TOKEN' --work _work"
  bash -lc "cd '$GITHUB_RUNNER_DIR' && ./svc.sh install '$GITHUB_RUNNER_USER' && ./svc.sh start"
}

resolve_docker_bin() {
  if [ -n "$DOCKER_BIN" ] && [ -x "$DOCKER_BIN" ]; then
    return 0
  fi
  if cmd_exists docker; then
    DOCKER_BIN="$(command -v docker)"
    return 0
  fi
  for candidate in /usr/bin/docker /usr/local/bin/docker /snap/bin/docker; do
    if [ -x "$candidate" ]; then
      DOCKER_BIN="$candidate"
      return 0
    fi
  done
  return 1
}

install_package_if_available() {
  pkg="$1"
  if apt-cache show "$pkg" >/dev/null 2>&1; then
    apt-get install -y --no-install-recommends "$pkg"
  fi
}

ensure_docker() {
  if ! resolve_docker_bin; then
    log "installing Docker because it is required to build and import local images"
    apt-get install -y --no-install-recommends docker.io
    install_package_if_available docker-cli
  fi

  if ! resolve_docker_bin; then
    fatal "Docker CLI is still not available after installing docker.io/docker-cli. On Debian 13, confirm the package provides /usr/bin/docker or install Docker CE CLI."
  fi

  if ! systemctl is-active --quiet docker; then
    log "starting Docker because it is required to build local images"
    systemctl enable --now docker
  else
    log "Docker already active; no restart performed"
  fi

  log "using Docker CLI: $DOCKER_BIN"
}

requires_docker() {
  case "$DEPLOY_MODE" in
    full|app|monitor) return 0 ;;
    *) return 1 ;;
  esac
}

requires_app_image() {
  case "$DEPLOY_MODE" in
    full|app) return 0 ;;
    *) return 1 ;;
  esac
}

requires_monitor_image() {
  case "$DEPLOY_MODE" in
    full|monitor) return 0 ;;
    *) return 1 ;;
  esac
}

requires_manifests_apply() {
  case "$DEPLOY_MODE" in
    full|app|monitor|manifests) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -z "$INSTALL_GITHUB_RUNNER" ]; then
  if prompt_yes_no "Install a GitHub Actions self-hosted runner for CI/CD deployments from GitHub? [y/N]" "N"; then
    INSTALL_GITHUB_RUNNER=1
  else
    INSTALL_GITHUB_RUNNER=0
  fi
fi

log "detected OS/arch: $OS_NAME / $ARCH_RAW"
[ "$IS_RPI" = "1" ] && log "detected Raspberry Pi hardware"
is_debian_family || fatal "this installer currently supports Debian-family systems only"

log "running non-invasive preflight checks"
if ! ss -lnt 2>/dev/null | grep -qE '(^|[[:space:]]|:)22[[:space:]]'; then
  warn "SSH does not appear to be listening on TCP/22. I will not change SSH, but confirm console access before continuing."
fi
if grep -qi '[[:space:]]cifs[[:space:]]' /etc/fstab 2>/dev/null; then
  warn "CIFS entries detected in /etc/fstab. This installer will not mount, unmount, or edit them."
fi
if mount | grep -qi ' type cifs '; then
  warn "An active CIFS mount is present. It will be left untouched."
fi
if systemctl is-active --quiet docker 2>/dev/null; then
  log "Docker is already running; installer will not restart it"
fi
if systemctl is-active --quiet k3s 2>/dev/null; then
  log "K3s is already running; installer will not restart it"
fi

mkdir -p /var/backups/otp-relay-k8s
ip route > /var/backups/otp-relay-k8s/ip-route.before 2>/dev/null || true
ip addr > /var/backups/otp-relay-k8s/ip-addr.before 2>/dev/null || true
iptables-save > /var/backups/otp-relay-k8s/iptables.before 2>/dev/null || true
nft list ruleset > /var/backups/otp-relay-k8s/nft.before 2>/dev/null || true

if [ "$IS_RPI" = "1" ]; then
  if ! grep -qw cgroup_memory /proc/cmdline 2>/dev/null || ! grep -qw cgroup_enable=memory /proc/cmdline 2>/dev/null; then
    warn "Raspberry Pi memory cgroup flags are not active. K3s may fail without them."
    warn "This installer will not edit boot files automatically. Add cgroup_memory=1 cgroup_enable=memory and reboot if K3s fails."
  fi
fi

log "installing base OS packages required for repository sync and optional runner setup with apt-get"
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git tar gzip sudo python3

install_github_runner

if [ "$RUNNER_ONLY" = "1" ]; then
  log "RUNNER_ONLY=1 set; GitHub runner setup complete. Skipping Docker, K3s, image build, and deployment."
  exit 0
fi

case "$DEPLOY_MODE" in
  full|app|monitor|manifests|none) ;;
  *) fatal "unsupported DEPLOY_MODE=$DEPLOY_MODE. Use full, app, monitor, manifests, or none." ;;
esac
log "deployment mode: $DEPLOY_MODE"

if [ "$DEPLOY_MODE" = "none" ]; then
  log "DEPLOY_MODE=none; no deployment changes required. Exiting before Docker/K3s work."
  exit 0
fi

log "installing Kubernetes/deployment OS packages with apt-get"
apt-get install -y --no-install-recommends \
  iproute2 iptables nftables python3-venv jq

if requires_docker; then
  ensure_docker
else
  log "DEPLOY_MODE=$DEPLOY_MODE does not require Docker image build; skipping Docker check/install"
fi

if ! cmd_exists k3s; then
  log "installing K3s server. This installs Kubernetes networking, but does not stop unrelated services."
  curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC='server --write-kubeconfig-mode 644' sh -
else
  log "K3s already installed; no reinstall performed"
fi

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
log "waiting for Kubernetes node readiness"
for i in $(seq 1 60); do
  if k3s kubectl get nodes >/dev/null 2>&1 && k3s kubectl wait --for=condition=Ready node --all --timeout=10s >/dev/null 2>&1; then
    break
  fi
  sleep 2
  [ "$i" -lt 60 ] || fatal "K3s node did not become Ready"
done

log "syncing repository into $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL" || true
  git -C "$INSTALL_DIR" fetch --prune origin "$REPO_REF"
  git -C "$INSTALL_DIR" reset --hard "origin/$REPO_REF"
  if [ "$GIT_CLEAN" = "1" ]; then
    log "cleaning untracked files in repo working tree, preserving common local data/secret files"
    git -C "$INSTALL_DIR" clean -ffd \
      -e data/ \
      -e .env \
      -e k8s/manifests/secret.env \
      -e '*.log'
  fi
elif [ -e "$INSTALL_DIR" ]; then
  fatal "$INSTALL_DIR exists but is not a git repo. Move it away or set INSTALL_DIR to another path."
else
  git clone --branch "$REPO_REF" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
log "repo synced to $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

log "checking required source files"
[ -f main.py ] || fatal "main.py is missing in repo root"
[ -f monitor.py ] || fatal "monitor.py is required and missing in repo root"
[ -f requirements.txt ] || fatal "requirements.txt is missing in repo root"
[ -d frontend ] || fatal "frontend/ directory is missing"
[ -f frontend/index.html ] || fatal "frontend/index.html is missing"
[ -f frontend/app.jsx ] || fatal "frontend/app.jsx is missing"
[ -f frontend/style.css ] || fatal "frontend/style.css is missing"
[ -f scripts/build_help_docs.py ] || fatal "required help-doc builder is missing: scripts/build_help_docs.py"
[ -d docs/help ] || fatal "required help-doc input directory is missing: docs/help"

if [ -z "$PHONE_IP" ]; then
  fatal "PHONE_IP is required because monitor.py is a core component"
fi
if [ -z "$WHATSAPP_API_KEY" ] || [ -z "$WHATSAPP_RECIPIENT" ]; then
  warn "WhatsApp alert credentials are not set. monitor.py will still run, but WhatsApp alerts will be skipped."
fi

if requires_app_image; then
  log "preparing installer Python environment for app validation/help docs"
  python3 -m venv .installer-venv
  .installer-venv/bin/python -m pip install --upgrade pip setuptools wheel
  .installer-venv/bin/python -m pip install -r requirements.txt

  if [ "$SKIP_HELP_DOCS_BUILD" = "1" ]; then
    log "skipping help docs build because SKIP_HELP_DOCS_BUILD=1"
  else
    log "building help docs with scripts/build_help_docs.py"
    .installer-venv/bin/python scripts/build_help_docs.py
  fi
else
  log "DEPLOY_MODE=$DEPLOY_MODE does not require app help-doc build; skipping installer venv"
fi

log "writing Debian/K3s Docker and Kubernetes assets"
mkdir -p k8s/manifests
cat > k8s/Dockerfile <<'DOCKER'
FROM python:3.12-slim AS runtime
WORKDIR /app
COPY requirements.txt .
RUN useradd --system --uid 999 --no-create-home --shell /usr/sbin/nologin otprelay \
  && python -m venv /app/venv \
  && /app/venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
  && /app/venv/bin/pip install --no-cache-dir -r requirements.txt \
  && mkdir -p /app/data \
  && chown -R otprelay:otprelay /app
COPY main.py .
COPY frontend/ ./frontend/
COPY docs/ ./docs/
USER otprelay
ENV OTP_RELAY_DATA_DIR=/app/data \
    USERS_EXCEL_PATH=/app/data/users.xlsx \
    AUDIT_LOG_PATH=/app/data/audit.log
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD /app/venv/bin/python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/readyz')"
CMD ["/app/venv/bin/python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
DOCKER

cat > k8s/Dockerfile.monitor <<'DOCKER'
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN apt-get update \
  && apt-get install -y --no-install-recommends iputils-arping \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 999 --no-create-home --shell /usr/sbin/nologin otprelay \
  && python -m venv /app/venv \
  && /app/venv/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
  && /app/venv/bin/pip install --no-cache-dir -r requirements.txt \
  && mkdir -p /app/data \
  && chown -R otprelay:otprelay /app
COPY monitor.py .
USER otprelay
ENV OTP_RELAY_DATA_DIR=/app/data
CMD ["/app/venv/bin/python", "monitor.py"]
DOCKER

cat > k8s/manifests/namespace.yaml <<EOF_NS
apiVersion: v1
kind: Namespace
metadata:
  name: $NAMESPACE
EOF_NS

cat > k8s/manifests/configmap.yaml <<EOF_CM
apiVersion: v1
kind: ConfigMap
metadata:
  name: otp-relay-config
  namespace: $NAMESPACE
data:
  # App runtime
  CLAIM_EXPIRY_SEC: "90"
  OTP_DISPLAY_SEC: "285"
  CONCURRENT_RISK_SEC: "30"
  OTP_RELAY_DATA_DIR: "/app/data"
  USERS_EXCEL_PATH: "/app/data/users.xlsx"
  AUDIT_LOG_PATH: "/app/data/audit.log"

  # Monitor runtime. monitor.py is a required component.
  PHONE_IP: "$PHONE_IP"
  PHONE_INTERFACE: "$PHONE_INTERFACE"
  PHONE_PING_INTERVAL: "$PHONE_PING_INTERVAL"
  PHONE_OFFLINE_THRESHOLD: "$PHONE_OFFLINE_THRESHOLD"
  BATCH_WINDOW_SEC: "$BATCH_WINDOW_SEC"
  ALERT_LEVEL: "$ALERT_LEVEL"
  SERVER_HOSTNAME: "$SERVER_HOSTNAME"
  SERVER_IP: "$SERVER_IP"
  PORTAL_URL: "$PORTAL_URL"
EOF_CM

cat > k8s/manifests/pvc.yaml <<EOF_PVC
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: otp-relay-data
  namespace: $NAMESPACE
  labels:
    app: otp-relay
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
EOF_PVC

cat > k8s/manifests/deployment.yaml <<EOF_DEPLOY
apiVersion: apps/v1
kind: Deployment
metadata:
  name: otp-relay
  namespace: $NAMESPACE
  labels:
    app: otp-relay
spec:
  replicas: 1
  selector:
    matchLabels:
      app: otp-relay
  strategy:
    type: Recreate
  template:
    metadata:
      labels:
        app: otp-relay
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 999
        fsGroup: 999
      containers:
        - name: app
          image: $APP_IMAGE
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8000
          envFrom:
            - configMapRef:
                name: otp-relay-config
          env:
            - name: SMS_SECRET_TOKEN
              valueFrom:
                secretKeyRef:
                  name: otp-relay-secrets
                  key: SMS_SECRET_TOKEN
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8000
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8000
            initialDelaySeconds: 20
            periodSeconds: 30
          volumeMounts:
            - name: data
              mountPath: /app/data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: otp-relay-data
EOF_DEPLOY

cat > k8s/manifests/service.yaml <<EOF_SVC
apiVersion: v1
kind: Service
metadata:
  name: otp-relay
  namespace: $NAMESPACE
  labels:
    app: otp-relay
spec:
  type: NodePort
  selector:
    app: otp-relay
  ports:
    - name: http
      port: 80
      targetPort: 8000
      nodePort: $SERVICE_NODE_PORT
      protocol: TCP
EOF_SVC

if [ "$INGRESS_ENABLED" = "1" ]; then
cat > k8s/manifests/ingress.yaml <<EOF_ING
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: otp-relay
  namespace: $NAMESPACE
spec:
  ingressClassName: traefik
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: otp-relay
                port:
                  number: 80
EOF_ING
else
  rm -f k8s/manifests/ingress.yaml
fi

cat > k8s/manifests/deployment-monitor.yaml <<EOF_MON
apiVersion: apps/v1
kind: Deployment
metadata:
  name: otp-monitor
  namespace: $NAMESPACE
  labels:
    app: otp-monitor
spec:
  replicas: 1
  selector:
    matchLabels:
      app: otp-monitor
  strategy:
    type: Recreate
  template:
    metadata:
      labels:
        app: otp-monitor
    spec:
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      securityContext:
        runAsNonRoot: true
        runAsUser: 999
        fsGroup: 999
      containers:
        - name: monitor
          image: $MONITOR_IMAGE
          imagePullPolicy: IfNotPresent
          envFrom:
            - configMapRef:
                name: otp-relay-config
          env:
            - name: WHATSAPP_API_KEY
              valueFrom:
                secretKeyRef:
                  name: otp-relay-secrets
                  key: WHATSAPP_API_KEY
            - name: WHATSAPP_RECIPIENT
              valueFrom:
                secretKeyRef:
                  name: otp-relay-secrets
                  key: WHATSAPP_RECIPIENT
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
              add:
                - NET_RAW
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
          volumeMounts:
            - name: data
              mountPath: /app/data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: otp-relay-data
EOF_MON

log "validating Python syntax and Kubernetes manifests"
if requires_app_image; then
  python3 -m py_compile main.py
fi
if requires_monitor_image; then
  python3 -m py_compile monitor.py
fi
k3s kubectl apply --dry-run=client -f k8s/manifests/namespace.yaml >/dev/null
k3s kubectl apply -f k8s/manifests/namespace.yaml
k3s kubectl apply --dry-run=client \
  -f k8s/manifests/configmap.yaml \
  -f k8s/manifests/pvc.yaml \
  -f k8s/manifests/deployment.yaml \
  -f k8s/manifests/service.yaml \
  -f k8s/manifests/deployment-monitor.yaml >/dev/null
if [ "$INGRESS_ENABLED" = "1" ]; then
  k3s kubectl apply --dry-run=client -f k8s/manifests/ingress.yaml >/dev/null
fi

if requires_manifests_apply; then
  log "creating/updating Kubernetes secret"
  k3s kubectl create secret generic otp-relay-secrets \
    --namespace "$NAMESPACE" \
    --from-literal=SMS_SECRET_TOKEN="$SMS_SECRET_TOKEN" \
    --from-literal=WHATSAPP_API_KEY="$WHATSAPP_API_KEY" \
    --from-literal=WHATSAPP_RECIPIENT="$WHATSAPP_RECIPIENT" \
    --dry-run=client -o yaml | k3s kubectl apply -f -
fi

if requires_app_image; then
  log "building app image with Docker"
  "$DOCKER_BIN" build -t "$APP_IMAGE" -f k8s/Dockerfile .
  log "importing app image into K3s containerd"
  tmp_app_tar="$(mktemp --suffix=.tar)"
  "$DOCKER_BIN" save "$APP_IMAGE" -o "$tmp_app_tar"
  k3s ctr images import "$tmp_app_tar"
  rm -f "$tmp_app_tar"
else
  log "DEPLOY_MODE=$DEPLOY_MODE skips app image build/import"
fi

if requires_monitor_image; then
  log "building required monitor image with Docker"
  "$DOCKER_BIN" build -t "$MONITOR_IMAGE" -f k8s/Dockerfile.monitor .
  log "importing required monitor image into K3s containerd"
  tmp_monitor_tar="$(mktemp --suffix=.tar)"
  "$DOCKER_BIN" save "$MONITOR_IMAGE" -o "$tmp_monitor_tar"
  k3s ctr images import "$tmp_monitor_tar"
  rm -f "$tmp_monitor_tar"
else
  log "DEPLOY_MODE=$DEPLOY_MODE skips monitor image build/import"
fi

if requires_manifests_apply; then
  log "applying Kubernetes resources"
  k3s kubectl apply -f k8s/manifests/configmap.yaml
  k3s kubectl apply -f k8s/manifests/pvc.yaml

  if [ "$DEPLOY_MODE" = "full" ] || [ "$DEPLOY_MODE" = "app" ] || [ "$DEPLOY_MODE" = "manifests" ]; then
    k3s kubectl apply -f k8s/manifests/deployment.yaml
    k3s kubectl apply -f k8s/manifests/service.yaml
    if [ "$INGRESS_ENABLED" = "1" ]; then
      k3s kubectl apply -f k8s/manifests/ingress.yaml
    else
      k3s kubectl delete ingress otp-relay -n "$NAMESPACE" --ignore-not-found=true
    fi
  fi

  if [ "$DEPLOY_MODE" = "full" ] || [ "$DEPLOY_MODE" = "monitor" ] || [ "$DEPLOY_MODE" = "manifests" ]; then
    k3s kubectl apply -f k8s/manifests/deployment-monitor.yaml
  fi
fi

if requires_app_image; then
  log "restarting app deployment to pick up freshly imported local app image"
  k3s kubectl rollout restart deployment/otp-relay -n "$NAMESPACE"
  log "waiting for app rollout"
  k3s kubectl rollout status deployment/otp-relay -n "$NAMESPACE" --timeout=180s
fi

if requires_monitor_image; then
  log "restarting monitor deployment to pick up freshly imported local monitor image"
  k3s kubectl rollout restart deployment/otp-monitor -n "$NAMESPACE"
  log "waiting for monitor rollout"
  k3s kubectl rollout status deployment/otp-monitor -n "$NAMESPACE" --timeout=180s
fi

if [ "$DEPLOY_MODE" = "manifests" ]; then
  log "manifest-only apply complete; checking rollout status for existing deployments"
  k3s kubectl rollout status deployment/otp-relay -n "$NAMESPACE" --timeout=180s || true
  k3s kubectl rollout status deployment/otp-monitor -n "$NAMESPACE" --timeout=180s || true
fi

if [ -n "$RUNTIME_DATA_DIR" ] && { [ "$DEPLOY_MODE" = "full" ] || [ "$DEPLOY_MODE" = "app" ]; }; then
  [ -d "$RUNTIME_DATA_DIR" ] || fatal "RUNTIME_DATA_DIR does not exist: $RUNTIME_DATA_DIR"
  pod="$(k3s kubectl get pod -n "$NAMESPACE" -l app=otp-relay -o jsonpath='{.items[0].metadata.name}')"
  for f in users.xlsx admin_auth.json admin_config.json wizard_progress.json audit.log; do
    if [ -f "$RUNTIME_DATA_DIR/$f" ]; then
      log "copying $f into PVC"
      k3s kubectl cp "$RUNTIME_DATA_DIR/$f" "$NAMESPACE/$pod:/app/data/$f" -n "$NAMESPACE"
    fi
  done
  k3s kubectl rollout restart deployment/otp-relay -n "$NAMESPACE"
  k3s kubectl rollout restart deployment/otp-monitor -n "$NAMESPACE"
  k3s kubectl rollout status deployment/otp-relay -n "$NAMESPACE" --timeout=180s
  k3s kubectl rollout status deployment/otp-monitor -n "$NAMESPACE" --timeout=180s
fi


cat <<EOF_DONE

OTP Relay Kubernetes deployment complete.

Portal URL:   http://$SERVER_IP/
NodePort URL: http://$SERVER_IP:$SERVICE_NODE_PORT/
Namespace:    $NAMESPACE
Repo path:    $INSTALL_DIR
OS/arch:      $OS_NAME / $ARCH_RAW
Monitor:      installed as required component
Runner:       $INSTALL_GITHUB_RUNNER
Runner only:  $RUNNER_ONLY
Deploy mode:  $DEPLOY_MODE

Useful commands:
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  k3s kubectl get pods -n $NAMESPACE
  k3s kubectl logs -n $NAMESPACE deployment/otp-relay
  k3s kubectl logs -n $NAMESPACE deployment/otp-monitor
  k3s kubectl get svc,ingress -n $NAMESPACE
  curl -i http://127.0.0.1/
  curl -i http://127.0.0.1:$SERVICE_NODE_PORT/

Monitor config is in ConfigMap otp-relay-config:
  PHONE_IP=$PHONE_IP
  PHONE_INTERFACE=$PHONE_INTERFACE
  PHONE_PING_INTERVAL=$PHONE_PING_INTERVAL
  PHONE_OFFLINE_THRESHOLD=$PHONE_OFFLINE_THRESHOLD
  PORTAL_URL=$PORTAL_URL

SMS webhook secret token was generated/stored in Kubernetes secret otp-relay-secrets.
To print it on this server:
  k3s kubectl get secret otp-relay-secrets -n $NAMESPACE -o jsonpath='{.data.SMS_SECRET_TOKEN}' | base64 -d; echo
EOF_DONE
