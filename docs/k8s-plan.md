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

### What this phase originally planned to do

The nine-step plan as set out at the start:

1. Doc correction pass — fix cluster shape (3 nodes), references to old hostnames.
2. Phase-2 architecture diagram.
3. `observability-design.md` with the decisions and trade-offs.
4. Install Prometheus + Grafana + Loki + Alloy.
5. App and monitor metrics — instrument both Python processes.
6. Build the custom OTP Relay dashboard in Grafana.
7. Alertmanager wired to Telegram, with alert rules matching the design grammar.
8. Runbook covering known failure modes.
9. Updated architecture diagrams.

### What actually happened

The plan held in broad strokes, but real life intervened in two ways worth recording.

**TLS work crept in (and was worth it).** Step 2 was originally a diagram. While
that step was pending, Jathin produced the internal CA we had been waiting for,
which unlocked a much bigger piece of work — the full TLS migration. Done in
four stages (cert as Traefik default, portal cutover to `rta.init-db.lan`,
iPhone Shortcut migration over HTTPS, dropping the `.83` MetalLB IP). That work
arguably belonged in its own phase, but doing it inside Phase 1.5 meant the
observability install benefited from clean HTTPS routing for Grafana from the
start. Worth the scope drift.

**Telegram message format was rewritten.** The original monitor code used
`🔴 OTP Relay Alert` style messages with batching and a portal-link footer.
Once the alert grammar was defined in `observability-design.md`, the monitor's
existing Telegram path was reworked to match (subject glyph + severity glyph
+ short text, no URLs). Batching was dropped — single, well-shaped messages
per event. Only iPhone state changes get monitor-side alerts; everything else
will route through Alertmanager.

### Steps completed

- **Step 1 — Doc corrections.** Cluster shape (3 nodes) corrected across
  `setup-guide.md`, `deploy.md`, `build-guide.md`. Naming conventions doc
  added (`docs/dev/naming-conventions.md`): hosts `srv<role><nn>.local`,
  services `<purpose>.init-db.lan`. Portal renamed from
  `srvotp26.init-db.lan` to `rta.init-db.lan`. Grafana name reserved as
  `grafana.init-db.lan`.

- **Step 3 — Observability design.** `docs/dev/observability-design.md`
  captures the stack choice (kube-prometheus-stack + Loki + Alloy +
  Alertmanager), node placement, resource budget, metric inventory, alert
  grammar (subject + severity glyphs), and what is deliberately out of scope.

- **Step 4 — Stack installed.** Three Helm releases pinned to versions:
  kube-prometheus-stack 85.0.1, Loki 13.7.2, Alloy 1.8.1. Plus
  prometheus-operator-crds 29.0.0 as a separate CRD-only release.
  Grafana sized at 512Mi (first attempt at 256Mi OOM'd under UI load).
  Pinning: Prometheus+Loki on `srvk3wrk02`, Grafana on `srvk3wrk01`.
  Setup documented in `docs/operations/observability-setup.md` at a level
  Jathin can reproduce from scratch.

- **Step 5 — App and monitor instrumented.** Six metrics in `main.py`
  (`otp_claims_total`, `otp_delivered_total`, `otp_claim_expired_total`,
  `otp_request_duration_seconds`, `otp_queue_depth`, `otp_active_user`).
  Five metrics in `monitor.py` (`otp_iphone_present`,
  `otp_iphone_absence_seconds`, `otp_iphone_absence_events_total`,
  `otp_iphone_absence_duration_seconds`, `otp_monitor_arp_last_success_timestamp_seconds`).
  Both processes expose `/metrics`; ServiceMonitors tell Prometheus to scrape
  them. Queue-depth and active-user gauges measured on-demand via
  `set_function` callbacks, so they reflect live state regardless of whether
  the backend is in-memory or Redis. Prometheus scrape interval 15s.

- **Step 6 — Dashboard v1.** Three rows visible: pipeline (5 stat panels —
  📱 iPhone → 🚪 Portal → 📥 Queue → 👤 Active → ✉️ Delivered 24h),
  support strip (4 panels — 👁️ Monitor, 🎛️ Nodes, 📊 Prometheus,
  ⏰ Last ARP), and trends (OTPs per hour + iPhone absence events, with
  shared tooltip for visual correlation). Dashboard JSON committed to
  `k8s/observability/dashboards/otp-relay-live.json` as a snapshot — not yet
  auto-provisioned; manual export-and-commit for now.

- **TLS migration.** Wildcard `*.init-db.lan` cert from Jathin's internal CA
  installed as Traefik's default. Portal accessible at `https://rta.init-db.lan`,
  Grafana at `https://grafana.init-db.lan`, iPhone Shortcut hitting
  `https://172.31.10.84/sms-received` directly. The old `srvotp26.init-db.lan`
  hostname and the `172.31.10.83` MetalLB IP are gone.

- **Telegram tidy.** Monitor sends `📱🔥 iPhone offline. Last seen just now.`
  and `📱👍 iPhone back. Was offline 12m.` Per-event, no batching, no URLs.
  All other audit events fall through silently and will be picked up by
  Alertmanager in step 7.

- **K3s ServiceLB conflict — documented.** Halfway through the dashboard
  work, MetalLB silently withdrew `172.31.10.84` because the Traefik Service
  had been asking for the same IP two ways (annotation + spec field), with
  K3s's bundled ServiceLB making the timing flare up. Recovered by removing
  the duplicate annotation. Full diagnosis and recovery procedure now in
  `docs/operations/runbook.md`. The underlying conflict — K3s ServiceLB
  running alongside MetalLB — is not yet fixed; documented in
  `docs/operations/k3s-cluster-bootstrap.md` so a future cluster gets
  `--disable=servicelb` from the start.

### Documents produced

- `docs/dev/naming-conventions.md` — host and service naming.
- `docs/dev/observability-design.md` — decisions and trade-offs.
- `docs/operations/observability-setup.md` — beginner-level install guide.
- `docs/operations/k3s-cluster-bootstrap.md` — prerequisite cluster install.
- `docs/operations/runbook.md` — first entry, more to come.
- `k8s/observability/prometheus-stack-values.yaml`, `loki-values.yaml`,
  `alloy-values.yaml` — Helm values pinned and committed.
- `k8s/observability/grafana-ingress.yaml`, `servicemonitor-otp-relay.yaml`,
  `servicemonitor-otp-monitor.yaml` — cluster manifests.
- `k8s/observability/dashboards/otp-relay-live.json` — dashboard snapshot.

### Lessons learned worth recording

- **Build-pipeline truth checks.** Adding a dependency in `requirements.txt`
  did nothing for ~30 minutes of debugging because the Dockerfile hardcoded
  the dependency list. Worth grepping the Dockerfile for `requirements.txt`
  references before adding a Python package. Fixed by switching the Dockerfile
  to actually use `requirements.txt`.

- **Cumulative manual commands become invisible state.** The
  `metallb.universe.tf/loadBalancerIPs` annotation was added with
  `kubectl annotate` early in cluster life. It was correct at the time but
  conflicted with a later HelmChartConfig that asked for the same IP via the
  spec field. Two configurations, both valid in isolation, broken together.
  General rule: prefer declarative (manifests, HelmChartConfig) over
  imperative (`kubectl annotate`, `kubectl edit`) for anything that should
  survive a cluster rebuild.

- **`make_asgi_app()` requires trailing slash, GET routes don't.**
  FastAPI's sub-app mount serves at `/metrics/` (with slash). A plain
  `@app.get("/metrics")` route handles both. The latter is what FastAPI docs
  recommend; use it.

- **Stat panel "graph mode" is often noise.** For binary metrics, counters
  that only grow, and stable values, the sparkline adds visual chaos without
  signal. Turn it on only where the shape over time actually carries info
  (queue depth, request latency).

- **iPhone misses ARP probes ~1-2 times a day for ~120s each time.**
  Always exactly 61s between `📱🔥` and `📱👍` events — the iPhone reliably
  responds to the very first probe after waking. Probably iOS low-power
  state. Not a real failure (Shortcuts run regardless), but our threshold of
  2 trips the alert anyway. Worth raising to 3 or 4 in Phase 1.5 step 7 once
  Alertmanager covers the metric-based path.

### Open issues at end of dashboard-snapshot

These do not block the demo but are tracked for future sessions:

- **K3s ServiceLB still active** — bundled DaemonSet `svclb-traefik-be79d612`
  competing with MetalLB. Will be fixed in Session A (post-demo).
- **ConfigMap has dead env vars** — `ALERT_LEVEL`, `BATCH_WINDOW_SEC`,
  `SERVER_HOSTNAME` no longer used by any process. Cosmetic.
- **Duplicate scrape series** — Prometheus shows `otp_iphone_present` twice
  per pod for reasons not yet diagnosed. Worked around with `max()` in every
  dashboard query. Real fix needed.
- **CA private key sitting on the master, unencrypted.** Follow-up with
  Jathin to move to encrypted offline storage.
- **Cert renewal mechanism is manual.** Calendar reminder needed for early
  April 2027 to renew the wildcard cert before May 15 expiry.
- **`main.py` is 1626 lines.** File split agreed to defer to its own session,
  before any Phase 2 work begins.

### Plan from here

Phase 1.5 finishes after Sessions A through D. After that, Phase 1.6 (the
`main.py` split) is a single-session refactor that gates Phase 2.

| Session | Topic | Estimate |
|---|---|---|
| A | K3s ServiceLB fix + ConfigMap cleanup + duplicate-scrape diagnosis | 60-90 min |
| B | Alertmanager → Telegram, alert rules, message templates, raise `PHONE_OFFLINE_THRESHOLD` | 3-4 hours (could go 5-6) |
| C | Runbook expansion — entry per alert, plus non-alert procedures | 60-90 min |
| D | Architecture diagrams — cluster topology + SMS/metrics data-flow | 45-75 min |
| **— Phase 1.5 done —** |  |  |
| F | `main.py` file split refactor (no behaviour change) | 3-4 hours |
| **— Phase 1.6 done —** |  |  |
| E | Phase 2 / Redis migration (see next section) | 4-6 hours, possibly split |

Total to Phase 1.5 done: roughly 6-10 hours of focused work.
Total to Phase 2 done: another 7-10 hours beyond that.

Session A is scheduled for Wednesday morning, when real users are not yet
leaning on the system. The K3s restart causes ~10 seconds of API downtime,
which is the right kind of risk to take at 9am.

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