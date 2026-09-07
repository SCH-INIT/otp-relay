# Observability — setup guide

**For:** Jathin
**Level:** Beginner — every command is explained
**What you build:** Prometheus + Grafana + Loki + Alertmanager + log shipping,
running in the K3s cluster.

This guide shows how to install the observability stack from a fresh cluster
state. It assumes the cluster is already set up per `setup-guide.md` and the
OTP Relay app is running.

For *why* the stack looks the way it does (design choices, what we deliberately
left out, etc.), see `docs/dev/observability-design.md`.

For *day-to-day operation* (which dashboard to use, what to do when an alert
fires), see `docs/operations/observability-runbook.md`.

---

## A few concepts before we start

Same Kubernetes basics as `setup-guide.md`. Plus three more:

- **Helm:** a package manager for Kubernetes. Installs collections of objects
  (pods, services, ConfigMaps, ...) from "charts." Each install is a "release."
- **Helm values file:** a YAML file that customizes a chart for our cluster
  (resources, node placement, retention, etc.). We keep one per chart in
  `~/observability/` on the master.
- **CRD (Custom Resource Definition):** lets a third-party operator add new
  kinds of objects to Kubernetes (here, `Prometheus`, `Alertmanager`,
  `ServiceMonitor`). Must be installed *before* any object of those kinds.

---

## Prerequisites

Before following this guide, you need:

- [ ] K3s cluster running on three nodes (per `setup-guide.md`).
- [ ] OTP Relay app running in the `otp-relay` namespace.
- [ ] User-level kubeconfig set up on the master (see "kubectl access" below).
- [ ] Network access from the master to:
  - `https://prometheus-community.github.io`
  - `https://grafana.github.io`
  - `https://grafana-community.github.io`
  - `https://get.helm.sh`
- [ ] Helm 3 installed on the master (see "Install Helm" below).

---

## kubectl access on the master

There are two paths kubectl can take, and both are in use on this cluster:

1. `kubectl` is **aliased** in bash to `sudo k3s kubectl`. This reads
   `/etc/rancher/k3s/k3s.yaml` (root-owned). Prompts for sudo.
2. Helm reads `~/.kube/config` (user-owned), set up once with:
   ```bash
   mkdir -p ~/.kube
   sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
   sudo chown $(id -u):$(id -g) ~/.kube/config
   chmod 600 ~/.kube/config
   ```

Both work, different paths. Don't be surprised that `kubectl` prompts for sudo
but `helm` doesn't.

---

## Install Helm

Helm is a single binary. The official installer:

```bash
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

You'll see a warning: `[WARNING] Could not find git`. That's a warning, not an
error. Git is only needed for Helm plugins, which we don't use.

Verify:

```bash
helm version --short
```

Expected: `v3.20.x+g...` or newer.

---

## Add the Helm repositories

Three chart repositories. Each one carries different charts we'll use.

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add grafana https://grafana.github.io/helm-charts
helm repo add grafana-community https://grafana-community.github.io/helm-charts
helm repo update
```

Why three:

- `prometheus-community` — for `kube-prometheus-stack` (Prometheus + Grafana
  + Alertmanager + node-exporter + kube-state-metrics) and
  `prometheus-operator-crds` (the CRDs alone).
- `grafana` — for `alloy` (the log shipper).
- `grafana-community` — for `loki`. (The Loki Helm chart moved here in
  March 2026 — the original `grafana/loki` chart is now Grafana-Enterprise-only.)

---

## Create the namespace and label the workers

The whole stack lives in one namespace.

```bash
kubectl create namespace observability
```

Add node labels so the chart can place pods on specific workers:

```bash
kubectl label node srvk3wrk01 observability/role=ui
kubectl label node srvk3wrk02 observability/role=data
```

What the labels do:

- `srvk3wrk01` (role=ui) hosts Grafana and Alertmanager — the things humans
  open.
- `srvk3wrk02` (role=data) hosts Prometheus and Loki — the things that hold
  the data.

Spreading across two workers means a single worker failure leaves either
"the UI but no history" or "history but no UI" — never both gone at once.

The master (`srvk3mst01`) doesn't get an observability role. Node-exporter
runs there as part of the DaemonSet (we want master metrics), but no other
workloads.

---

## Part 1: install Prometheus, Grafana, Alertmanager

### 1.1 Install the CRDs first

The `kube-prometheus-stack` chart needs CRDs that don't exist yet:
`Prometheus`, `Alertmanager`, `PrometheusRule`, `ServiceMonitor`,
`PodMonitor`, etc. Install them as a separate Helm release first:

```bash
helm install prometheus-operator-crds prometheus-community/prometheus-operator-crds \
  --version 29.0.0 \
  --namespace observability
```

Why separately: `kube-prometheus-stack` ships with the CRDs bundled, but
Helm's CRD lifecycle inside subcharts has well-known limits — upgrades
don't update CRDs cleanly. Managing them as their own release avoids that
trap.

Verify:

```bash
kubectl get crd | grep monitoring.coreos.com
```

Expected: 10 CRDs listed (alertmanagers, prometheuses, prometheusrules,
servicemonitors, etc.).

### 1.2 Place the values file on the master

The values file lives in this repo at `k8s/observability/prometheus-stack-values.yaml`.
Copy it from your laptop to the master:

```bash
# From your laptop
scp prometheus-stack-values.yaml initadmin@srvk3mst01.local:~/observability/
```

If `~/observability/` doesn't exist on the master, create it first:

```bash
ssh initadmin@srvk3mst01.local 'mkdir -p ~/observability'
```

### 1.3 Dry-run

Always dry-run a Helm install before applying:

```bash
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --version 85.0.1 \
  --namespace observability \
  --values ~/observability/prometheus-stack-values.yaml \
  --dry-run 2>&1 | tail -30
```

Look at the tail. Expected: a `NAME: ... STATUS: pending-install ... NOTES: ...`
block. If you see "ensure CRDs are installed first," go back to step 1.1.

### 1.4 Install

```bash
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --version 85.0.1 \
  --namespace observability \
  --values ~/observability/prometheus-stack-values.yaml
```

Command takes ~60 seconds. Expected output ends with `STATUS: deployed`.

Watch the pods come up:

```bash
kubectl get pods -n observability -w
```

Wait for everything to reach `Running`. Ctrl+C when settled.

Expected pods (8 total):

| Pod (prefix) | Replicas | Node |
|---|---|---|
| `alertmanager-kube-prometheus-stack-alertmanager` | 1 | srvk3wrk01 |
| `kube-prometheus-stack-grafana` | 1 | srvk3wrk01 |
| `kube-prometheus-stack-kube-state-metrics` | 1 | anywhere |
| `kube-prometheus-stack-operator` | 1 | anywhere |
| `kube-prometheus-stack-prometheus-node-exporter` | 3 (DaemonSet) | all 3 nodes |
| `prometheus-kube-prometheus-stack-prometheus` | 1 | srvk3wrk02 |

Verify placement with `kubectl get pods -n observability -o wide`.

### 1.5 Quick health check

Confirm Prometheus is responding:

```bash
kubectl run prom-check --rm -it --image=curlimages/curl --restart=Never -n observability -- \
  curl -sf http://kube-prometheus-stack-prometheus.observability.svc.cluster.local:9090/-/healthy && echo " OK"
```

Expected: `Prometheus Server is Healthy. OK` and the pod auto-deletes.

---

## Part 2: install Loki

### 2.1 Place the values file

```bash
# From your laptop
scp loki-values.yaml initadmin@srvk3mst01.local:~/observability/
```

### 2.2 Install

```bash
helm install loki grafana-community/loki \
  --version 13.7.2 \
  --namespace observability \
  --values ~/observability/loki-values.yaml
```

Watch the pod come up:

```bash
kubectl get pods -n observability -l app.kubernetes.io/name=loki -w
```

Expected: `loki-0` reaches `2/2 Running` in ~60 seconds. Ctrl+C when settled.

The `-0` suffix means it's a StatefulSet (single-binary mode). The `2/2`
includes Loki itself plus a sidecar (`loki-sc-rules`) that watches for
rules ConfigMaps; we don't use the sidecar's feature but it ships with the
chart. Harmless.

### 2.3 Round-trip test

Push a log line, then query it back. Confirms the pipeline works:

```bash
# Push
kubectl run loki-test --rm -it --image=curlimages/curl --restart=Never -n observability -- \
  sh -c 'curl -sS -H "Content-Type: application/json" -XPOST \
    "http://loki.observability.svc.cluster.local:3100/loki/api/v1/push" \
    --data-raw "{\"streams\":[{\"stream\":{\"job\":\"smoketest\"},\"values\":[[\"$(date +%s)000000000\",\"hello smoketest\"]]}]}" \
    -w "\nHTTP %{http_code}\n"'
```

Expected: `HTTP 204`.

```bash
# Query
kubectl run loki-query --rm -it --image=curlimages/curl --restart=Never -n observability -- \
  sh -c 'curl -sS "http://loki.observability.svc.cluster.local:3100/loki/api/v1/query_range" \
    --data-urlencode "query={job=\"smoketest\"}" \
    --data-urlencode "start=$(($(date +%s) - 600))000000000" \
    --data-urlencode "end=$(date +%s)000000000" | head -c 200'
```

Expected: JSON containing `"hello smoketest"`.

---

## Part 3: install Alloy (the log shipper)

### 3.1 Place the values file

```bash
# From your laptop
scp alloy-values.yaml initadmin@srvk3mst01.local:~/observability/
```

### 3.2 Install

```bash
helm install alloy grafana/alloy \
  --version 1.8.1 \
  --namespace observability \
  --values ~/observability/alloy-values.yaml
```

Watch the pods come up:

```bash
kubectl get pods -n observability -l app.kubernetes.io/name=alloy -w
```

Expected: three pods (one per node, it's a DaemonSet). Each reaches `2/2 Running`
in 30-60 seconds.

### 3.3 Expected log-shipping noise on first install

When Alloy first starts, it asks the kube-apiserver for log history of every
pod on its node — including pods that have been running for weeks. Loki
rejects entries older than 7 days (our retention setting). You'll see errors
like:

```
final error sending batch, no retries left, dropping data ... has timestamp too old
```

**This is expected on first install.** It clears within a few minutes once
Alloy works through the backlog. New log lines (timestamped from now
onward) ship correctly.

Verify the pipeline works:

```bash
kubectl run loki-real-query --rm -it --image=curlimages/curl --restart=Never -n observability -- \
  sh -c 'curl -sS "http://loki.observability.svc.cluster.local:3100/loki/api/v1/query_range" \
    --data-urlencode "query={namespace=\"otp-relay\"}" \
    --data-urlencode "start=$(($(date +%s) - 300))000000000" \
    --data-urlencode "end=$(date +%s)000000000" | head -c 500'
```

Expected: JSON with real log lines from the otp-relay or otp-monitor pods.

---

## Part 4: access Grafana during setup

Grafana's IngressRoute for `https://grafana.init-db.lan` will be added once
the wildcard cert is in place. Until then, access during setup is via SSH
tunnel + port-forward.

### From your laptop

Open an SSH tunnel:

```bash
ssh -L 3000:localhost:3000 initadmin@srvk3mst01.local
```

Or add to `~/.ssh/config`:

```
Host srvk3mst01
    Hostname srvk3mst01.local
    User initadmin
    LocalForward 3000 localhost:3000
```

### On the master, in that SSH session

```bash
kubectl port-forward -n observability svc/kube-prometheus-stack-grafana 3000:80
```

Leave that terminal alone. Open `http://localhost:3000` on your laptop browser.

### Get the admin password

In a **second** SSH session to the master (the first is occupied by the
port-forward):

```bash
kubectl -n observability get secret kube-prometheus-stack-grafana \
  -o jsonpath='{.data.admin-password}' | base64 -d ; echo
```

Username is `admin`. Copy the password to a password manager.

### Add Loki as a data source

Grafana ships pre-configured with Prometheus. Loki needs adding:

1. Sidebar → Connections → Data sources → Add new data source → Loki
2. URL: `http://loki.observability.svc.cluster.local:3100`
3. Save & test. Expected: green "Data source connected."

---

## Expected pitfalls (read before debugging)

A few things that will eat hours if you don't know about them.

### Grafana resource sizing

The first attempt at 256Mi memory limit caused OOM under UI load. Bumped to
512Mi. The values file in this repo has the corrected number; if Grafana ever
gets OOMKilled again at a higher load, the next bump is to 768Mi.

Diagnose: `kubectl describe pod -n observability -l app.kubernetes.io/name=grafana | grep -A2 "Last State"`
— look for `Reason: OOMKilled`.

### Grafana rolling-update fails on the PVC

The PVC is `ReadWriteOnce`. Default `RollingUpdate` strategy briefly tries
to run two Grafana pods on the same volume. The init-chown-data sidecar
fails with `Permission denied`. Fixed in our values file by setting
`deploymentStrategy: Recreate` and `initChownData.enabled: false`.

### Orphan port-forwards

If your SSH session drops uncleanly while a `kubectl port-forward` is
running, the process can survive on the master without an attached terminal.
The next port-forward fails with `address already in use`.

Find: `sudo ss -tlnp | grep :3000` (or whichever port).
Kill: `kill <PID>` from the output.

### Use `helm upgrade`, not `kubectl edit` or `kubectl patch`

The observability stack is managed by Helm. Direct edits to deployments
are lost on the next `helm upgrade`. Make changes by:

1. Editing the relevant values file (`prometheus-stack-values.yaml`,
   `loki-values.yaml`, or `alloy-values.yaml`) on your laptop.
2. Committing to the repo.
3. `scp` to `~/observability/` on the master.
4. `helm upgrade <release> <chart> --version <pinned> --namespace observability --values ~/observability/<file>`

Example for Grafana resource changes:

```bash
helm upgrade kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --version 85.0.1 \
  --namespace observability \
  --values ~/observability/prometheus-stack-values.yaml
```

### K3s exposes fewer scrape targets

K3s collapses kube-controller-manager, kube-scheduler, and kube-proxy into
one binary. Their separate ServiceMonitors would fire `ScrapeFailure` alerts
forever. Our values file disables those scrapes (`kubeControllerManager.enabled: false`
and friends). If you ever move to vanilla Kubernetes, re-enable them.

### Loki "timestamp too old" errors on Alloy startup

See Part 3.3. Expected, clears within minutes, ignore unless still firing
after 10 minutes.

---

## Where things live

After install:

| What | Where |
|---|---|
| Prometheus data | `srvk3wrk02:/var/lib/rancher/k3s/storage/...prometheus-db-...` (10Gi PVC) |
| Loki data | `srvk3wrk02:/var/lib/rancher/k3s/storage/...storage-loki-0-...` (5Gi PVC) |
| Grafana data | `srvk3wrk01:/var/lib/rancher/k3s/storage/...grafana-...` (1Gi PVC) |
| Helm releases | `helm list -n observability` shows all four |
| Helm values | `~/observability/` on the master |

The PVC physical paths come from `kubectl get pvc -n observability -o yaml`
under `.spec.volumeName`. The local-path provisioner serves each from its
node's `/var/lib/rancher/k3s/storage/<volume-id>` directory.

---

## Uninstall (for reference)

To remove the whole stack:

```bash
helm uninstall alloy -n observability
helm uninstall loki -n observability
helm uninstall kube-prometheus-stack -n observability
helm uninstall prometheus-operator-crds -n observability

# Then the PVCs (which Helm leaves behind on purpose, to protect data)
kubectl delete pvc -n observability --all

# Then the CRDs (if you want a fully clean slate)
kubectl get crd | grep monitoring.coreos.com | awk '{print $1}' | xargs kubectl delete crd

# Then the namespace
kubectl delete namespace observability

# And the node labels
kubectl label node srvk3wrk01 observability/role-
kubectl label node srvk3wrk02 observability/role-
```

The order matters. Uninstall in this order or you'll have orphans.

---

## What this guide doesn't cover

- The app's own metrics (`otp_queue_depth`, iPhone presence, etc.) — that's
  step 5 of Phase 1.5, separate task.
- Dashboards beyond the bundled ones — step 6.
- Alert rules and Telegram routing — step 7.
- TLS access for Grafana — covered in `internal-ca.md` (to be written when
  Jathin's CA work lands).

Each gets its own short section in this doc as the work completes.
