# OTP Relay Kubernetes Plan

**Audience:** Christian, SCH, the IT team, and anyone learning Kubernetes with this project.  
**Goal:** make the current OTP Relay portal run in Kubernetes first, then improve it in controlled phases.

---

## Why this repo exists

The current OTP Relay portal works on the Ubuntu VM deployment. The goal of this `k8s` repo is not to rewrite everything at once. The goal is to use a real, familiar application to learn Kubernetes properly.

We will:

- Start with the current working portal behavior.
- Containerise it without changing the application model.
- Deploy it to K3s with one app replica first.
- Keep runtime state on a PVC.
- Add Redis only after we deliberately prove why the current in-memory queue cannot scale horizontally.
- Keep dual-data-centre ideas as a later learning phase, not a Phase 1 requirement.

---

## Repo strategy

The portal and Kubernetes work now live in the same repository on separate branches:

| Branch | Purpose |
|---|---|
| `SCH-INIT/otp-relay` `portal` branch | Current VM/company-server portal deployment. The working production-style baseline. |
| `SCH-INIT/otp-relay` `k8s` branch | Kubernetes deployment. Portal code merged in, plus Docker/K8s manifests, CI/CD, and consolidated docs. |

The `k8s` branch was seeded from the portal baseline and adds container and orchestration files around it.

---

## Current app model

The portal is currently:

- **FastAPI backend** running as one Python process with one Uvicorn worker.
- **React frontend** loaded from `frontend/app.jsx` through Babel in the browser.
- **On-screen OTP delivery** through browser polling.
- **iPhone Shortcut** posts received SMS content to `/sms-received`.
- **In-memory OTP state**:
  - `claim_queue`
  - `pending_otps`
  - admin sessions
- **PVC-backed runtime files** in Kubernetes:
  - `users.xlsx`
  - `audit.log`
  - `wizard_progress.json`
  - `admin_auth.json`
  - `admin_config.json`
- **SMTP is diagnostics only.** OTP delivery does not use email.

The critical design point: the current queue and pending OTPs are process-local. If the pod restarts, active OTP state is lost. That is acceptable in Phase 1 because users can claim again, but it means we must keep `replicas: 1` until Redis or another shared state layer is added.

---

## Current repo layout

```text
SCH-INIT/otp-relay (k8s branch)
├── main.py
├── monitor.py
├── requirements.txt
├── README.md
├── .gitignore
├── install-otp-relay-k8s.sh
├── .github/
│   └── workflows/
│       └── deploy-k3s.yml
├── frontend/
│   ├── index.html
│   ├── app.jsx
│   ├── guide.html
│   └── style.css
├── scripts/
│   ├── build_help_docs.py
│   └── generate_sample_users.py
├── docs/
│   ├── k8s-plan.md
│   ├── diagrams/
│   │   ├── phase-map.svg
│   │   └── phase1-architecture.svg
│   ├── dev/
│   │   └── dockerfile.md
│   ├── operations/
│   │   ├── build-guide.md
│   │   ├── setup-guide.md
│   │   └── github-actions-deploy.md
│   └── help/
│       ├── assets/
│       └── 00-overview.md … 11-notes-and-tips.md
└── k8s/
    ├── Dockerfile
    ├── Dockerfile.monitor
    └── manifests/
        ├── namespace.yaml
        ├── configmap.yaml
        ├── secret-example.env
        ├── pvc.yaml
        ├── deployment.yaml
        ├── deployment-monitor.yaml
        └── service.yaml
```

Runtime data should not be committed:

```text
data/
.env
k8s/manifests/secret.env
*.log
*.tar
```

---

## Phase 1 — Containerise and deploy on K3s

### Goal

Run the current portal in Kubernetes with the same behavior as the VM deployment.

### Scope

Phase 1 includes:

- App Docker image.
- Monitor Docker image, if phone monitoring is included.
- One app Deployment with `replicas: 1`.
- One Service.
- One PVC mounted at `/app/data`.
- ConfigMap for non-secret environment variables.
- Secret for `SMS_SECRET_TOKEN` and monitor WhatsApp values.
- Health endpoints:
  - `/healthz`
  - `/readyz`
- Resource requests and limits.
- Simple rollout/update process.

### Phase 1 does not include

- No Redis.
- No PostgreSQL.
- No two app replicas.
- No Helm yet.
- No service mesh.
- No dual-data-centre failover.
- No active/active architecture.

### Why one replica

The OTP queue and delivered OTP state currently live in memory. With two pods, user A could claim on pod 1 while the SMS lands on pod 2. That would break delivery. Therefore Phase 1 must stay at one app replica.

### Runtime data mapping

VM deployment:

```text
/opt/otp-relay/data/
```

Kubernetes deployment:

```text
/app/data/
```

The PVC should contain:

```text
/app/data/users.xlsx
/app/data/audit.log
/app/data/wizard_progress.json
/app/data/admin_auth.json
/app/data/admin_config.json
```

---

## Phase 1 deployment flow

### Build images

```bash
docker build -t otp-relay:latest -f k8s/Dockerfile .
docker build -t otp-monitor:latest -f k8s/Dockerfile.monitor .
```

For K3s without a registry, export and import:

```bash
docker save otp-relay:latest -o otp-relay-latest.tar
docker save otp-monitor:latest -o otp-monitor-latest.tar

sudo k3s ctr images import otp-relay-latest.tar
sudo k3s ctr images import otp-monitor-latest.tar
```

### Create namespace

```bash
kubectl apply -f k8s/manifests/namespace.yaml
```

### Create secret

```bash
cp k8s/manifests/secret-example.env k8s/manifests/secret.env
nano k8s/manifests/secret.env

kubectl create secret generic otp-relay-secrets \
  --from-env-file=k8s/manifests/secret.env \
  --namespace=otp-relay \
  --dry-run=client -o yaml | kubectl apply -f -
```

### Apply manifests

```bash
kubectl apply -f k8s/manifests/configmap.yaml
kubectl apply -f k8s/manifests/pvc.yaml
kubectl apply -f k8s/manifests/deployment.yaml
kubectl apply -f k8s/manifests/service.yaml
```

If using the monitor:

```bash
kubectl apply -f k8s/manifests/deployment-monitor.yaml
```

### Verify

```bash
kubectl get pods -n otp-relay
kubectl get svc -n otp-relay
kubectl logs -n otp-relay deployment/otp-relay
kubectl logs -n otp-relay deployment/otp-monitor
```

### Test endpoints

```bash
curl http://<loadbalancer-ip>/healthz
curl http://<loadbalancer-ip>/readyz
```

---

## Phase 1 validation checklist

The Kubernetes version is good enough for Phase 1 when all of this works:

- Login page loads.
- User token login works.
- OTP claim flow works.
- SMS POST to `/sms-received` works.
- OTP appears on screen.
- Wizard saves progress to `wizard_progress.json`.
- Admin login works.
- Admin token config creates/updates `admin_config.json`.
- `users.xlsx` loads from `/app/data/users.xlsx`.
- Audit log writes to `/app/data/audit.log`.
- Guide pop-out loads `frontend/guide.html`.
- `/healthz` returns OK.
- `/readyz` returns OK.
- Pod restart does not lose PVC-backed files.
- Active OTP state loss on pod restart is understood and accepted for Phase 1.

---

## Phase 1.5 — Observability

### Why before Phase 2

Phase 2 is going to deliberately break the running system to learn about shared
state. Before we do that, we want to see what is happening inside the cluster:
which pods restarted, when memory pressure happened, where requests are slow,
and how often the iPhone goes offline. Observability is the instrument panel
for Phase 2 and beyond.

### Scope

- Metrics: Prometheus + Grafana (kube-prometheus-stack), running in its own namespace.
- Logs: Loki + Grafana Alloy, queried through the same Grafana.
- Alerts: Alertmanager routing to the existing Telegram bot.
- App-side: FastAPI exposes Prometheus metrics; the monitor exposes ARP and
  iPhone-presence metrics.
- Dashboards: one cluster-health dashboard, one OTP Relay app dashboard.
- Pinned: Prometheus and Loki PVCs land on `srvk3wrk02.local`, Grafana on
  `srvk3wrk01.local`. A single worker failure does not take down both
  observability and the app at once.
- Access: `https://srvgrafana.init-db.lan` on a second MetalLB IP, TLS via Traefik.

### Documents produced in this phase

- `docs/dev/observability-design.md` — decisions and trade-offs.
- `docs/operations/observability-setup.md` — beginner-level install guide.
- `docs/operations/observability-runbook.md` — which dashboard, which alert, what to do.
- `docs/diagrams/observability-architecture.svg` — where the observability stack fits.
- `docs/diagrams/end-to-end-request-path.svg` — browser/iPhone to pod to storage.

---

## Phase 2 — Prove and fix stateful pain

### Goal

Understand exactly why the current in-memory queue prevents horizontal scaling, then fix it with shared state.

### Step 1: deliberately break it

Scale the app to two replicas:

```bash
kubectl scale deployment/otp-relay -n otp-relay --replicas=2
```

Expected result: the OTP flow becomes unreliable because each pod has its own queue and pending OTP memory.

This is intentional. The point is to experience the failure mode clearly.

### Step 2: add Redis

Move these from Python memory into Redis:

- claim queue
- pending OTPs
- OTP display TTL
- possibly admin sessions

Use Redis for what it is good at:

- list operations
- key/value state
- TTL expiry
- lightweight shared coordination

Do not add PostgreSQL just to hold a queue. PostgreSQL can be considered later only if the app grows relational data needs.

### Done when

The app can run with two replicas and the OTP queue works regardless of which pod handles `/claim-otp`, `/claim-status`, or `/sms-received`.

---

## Phase 3 — Resilience in one cluster

After Redis/shared state exists:

- Run two app replicas.
- Add a PodDisruptionBudget.
- Test rolling updates.
- Kill pods and confirm recovery.
- Drain a worker node and confirm the surviving worker keeps the service alive.
- Consider HPA only after metrics and shared state are working.

Done when a single pod failure does not interrupt normal use.

---

## Phase 4 — Optional second data centre

This is not needed for Phase 1.

If the team still wants to learn more later, consider:

- warm standby in DC2
- manual failover runbook
- backup/restore of Redis/PVC state
- DNS or VIP failover
- documented DR test procedure

Active/active is not a small change. It would require app redesign and distributed coordination. For this tool, active/standby is likely enough.

---

## Diagrams

Recommended files:

```text
docs/diagrams/phase-map.svg
docs/diagrams/phase1-architecture.svg
```

The phase map is the roadmap. The Phase 1 architecture diagram shows the intended K3s layout. If the first deployment uses only a `LoadBalancer` Service and no Ingress, that is fine; update the diagram later when Ingress is added.

---

## Practical rule

Get Phase 1 running first.

Do not add Redis, Helm, multi-replica, or second data centre work until the current portal runs cleanly in K3s with one replica.