# OTP Relay
**Kubernetes (K3s) · Company LAN · On-screen OTP delivery**

---

## How it works

```
iPhone 16 (company WiFi)
   ↓  iOS Shortcut → HTTP POST /sms-received
K3s cluster (otp-relay pod)
   ↓  matches SMS to the active claimant
   ↓  stores OTP in memory (never on disk)
Portal (user's browser)
   ↓  polls /claim-status every 3 seconds
OTP appears on screen — no email involved
```

1. User opens the portal, enters their token, clicks **Claim my slot**
2. If the queue is empty they become the active user immediately. Otherwise they enter the waiting room and are told not to trigger their OTP yet.
3. Once active, the user opens the platform and triggers the OTP SMS. They have **90 seconds** before their slot is reclaimed.
4. iPhone receives SMS → Shortcut fires → POSTs to the cluster over LAN
5. Server stores the OTP in memory (never logged, never written to disk) and unblocks the queue
6. The OTP appears on the user's screen for **4 minutes 45 seconds**, during which other users can already claim the next slot.
7. Every step is written to `data/audit.log`. OTP values are never recorded.

A second pod (`otp-monitor`) runs alongside the app. It pings the iPhone using ARP and forwards error-level audit events to IT via WhatsApp.

### Queue design

Only one user is active at a time. OTP SMS messages carry no user-identifying information, so the server cannot match an incoming SMS to a specific person. Concurrent active users would cause mis-delivery. The 90-second slot window keeps wait times short.

---

## Repository structure

```
otp-relay/ (k8s branch)
├── main.py                          # FastAPI application
├── monitor.py                       # Phone watcher + WhatsApp alert forwarder
├── requirements.txt                 # Python dependencies
├── install-otp-relay-k8s.sh         # K3s installer script
├── .github/
│   └── workflows/
│       └── deploy-k3s.yml           # GitHub Actions CI/CD
├── frontend/
│   ├── index.html                   # Portal markup
│   ├── app.jsx                      # React UI (Babel in-browser)
│   ├── guide.html                   # Help page pop-out
│   └── style.css                    # All styles
├── scripts/
│   ├── build_help_docs.py           # Builds help page content from docs/help/
│   └── generate_sample_users.py
├── docs/
│   ├── k8s-plan.md                  # Architecture plan and phased roadmap
│   ├── diagrams/                    # SVG architecture diagrams
│   ├── dev/
│   │   └── dockerfile.md            # Dockerfile design decisions
│   ├── operations/
│   │   ├── build-guide.md           # Image build and deploy workflow
│   │   ├── setup-guide.md           # Beginner ops guide (for Jathin)
│   │   └── github-actions-deploy.md # CI/CD setup and operations
│   └── help/
│       ├── assets/                  # Screenshots for help pages
│       └── 00-overview.md … 11-notes-and-tips.md
└── k8s/
    ├── Dockerfile                   # App container image
    ├── Dockerfile.monitor           # Monitor container image
    └── manifests/
        ├── namespace.yaml
        ├── configmap.yaml
        ├── secret-example.env
        ├── pvc.yaml
        ├── deployment.yaml
        ├── deployment-monitor.yaml
        └── service.yaml
```

> `data/`, `.env`, `k8s/manifests/secret.env`, `*.log`, and `*.tar` are excluded from git.

---

## Deployment overview

| Item | Value |
|---|---|
| Cluster | K3s on bare metal (3 nodes) |
| Namespace | `otp-relay` |
| App image | `otp-relay:latest` (local import, no registry) |
| Monitor image | `otp-monitor:latest` (local import, no registry) |
| Ingress | MetalLB LoadBalancer → port 80 → pod 8000 |
| Persistent data | PVC at `/app/data/` (users.xlsx, audit.log, wizard state, admin config) |
| Secrets | `otp-relay-secrets` (SMS token, WhatsApp credentials) |
| Config | `otp-relay-config` ConfigMap (timers, paths, monitor settings, admin tokens) |
| CI/CD | GitHub Actions with self-hosted runner on K3s node |

Both the app and monitor pods are pinned to the same worker node via `nodeSelector` (`otp-relay/storage=true`) because the PVC uses `ReadWriteOnce`.

---

## Quick start

Full setup instructions are in `docs/operations/setup-guide.md`. The short version:

```bash
# Label the storage node
kubectl label node srvk3wrk01 otp-relay/storage=true

# Create namespace
kubectl apply -f k8s/manifests/namespace.yaml

# Create secret (copy secret-example.env to secret.env first, fill in values)
kubectl create secret generic otp-relay-secrets \
  --from-env-file=k8s/manifests/secret.env \
  --namespace=otp-relay \
  --dry-run=client -o yaml | kubectl apply -f -

# Import images
sudo k3s ctr images import otp-relay-latest.tar
sudo k3s ctr images import otp-monitor-latest.tar

# Apply manifests
kubectl apply -f k8s/manifests/configmap.yaml
kubectl apply -f k8s/manifests/pvc.yaml
kubectl apply -f k8s/manifests/deployment.yaml
kubectl apply -f k8s/manifests/deployment-monitor.yaml
kubectl apply -f k8s/manifests/service.yaml
```

---

## Updating

The recommended path is GitHub Actions (push to trigger deploy). Manual fallback:

```bash
# Build images
docker build -t otp-relay:latest -f k8s/Dockerfile .
docker build -t otp-monitor:latest -f k8s/Dockerfile.monitor .

# Export, copy to server, import
docker save otp-relay:latest -o otp-relay-latest.tar
docker save otp-monitor:latest -o otp-monitor-latest.tar
scp *.tar user@server:/tmp/
sudo k3s ctr images import /tmp/otp-relay-latest.tar
sudo k3s ctr images import /tmp/otp-monitor-latest.tar

# Restart
kubectl rollout restart deployment/otp-relay -n otp-relay
kubectl rollout restart deployment/otp-monitor -n otp-relay
```

---

## Monitor and alerts

`monitor.py` runs as its own pod with `hostNetwork: true` (required for ARP to reach the iPhone on the physical LAN) and does two things:

**Phone watcher** — sends ARP requests to the iPhone at regular intervals. ARP is used instead of ICMP ping because iOS filters ping in low-power state but must respond to ARP. If consecutive checks fail, a WhatsApp alert is sent via CallMeBot.

**Log forwarder** — tails the audit log in real time. Entries at or above `ALERT_LEVEL` are forwarded to IT via WhatsApp. Events within `BATCH_WINDOW_SEC` are grouped to avoid flooding.

---

## Useful commands

```bash
kubectl get pods -n otp-relay                                # pod status
kubectl get svc -n otp-relay                                 # service IP
kubectl logs -n otp-relay deployment/otp-relay                # app logs
kubectl logs -n otp-relay deployment/otp-monitor              # monitor logs
kubectl rollout restart deployment/otp-relay -n otp-relay     # restart app
kubectl rollout restart deployment/otp-monitor -n otp-relay   # restart monitor
kubectl top pod -n otp-relay                                  # resource usage
kubectl describe pod -n otp-relay <pod-name>                  # diagnostics
```

---

## Documentation

| Document | What it covers |
|---|---|
| `docs/k8s-plan.md` | Architecture plan, phased roadmap, design rationale |
| `docs/dev/dockerfile.md` | Every decision in the Dockerfile, explained |
| `docs/operations/setup-guide.md` | Step-by-step first deploy guide (beginner level) |
| `docs/operations/build-guide.md` | Image build and deployment workflows |
| `docs/operations/github-actions-deploy.md` | CI/CD setup with self-hosted runner |

---

## Branches

| Branch | Purpose |
|---|---|
| `main` | Original systemd/VM deployment (legacy, not actively developed) |
| `portal` | Portal features on the VM deployment model |
| `k8s` | **Active.** Portal merged in, running on Kubernetes |
