# Cluster bootstrap — K3s + MetalLB

**For:** Jathin
**Level:** Beginner — every command is explained
**What you build:** Three-node K3s cluster on bare metal, with MetalLB
providing LoadBalancer IPs on the company LAN.

This is the prerequisite step before `setup-guide.md`. If you already have a
working K3s cluster with MetalLB, skip this doc. If you're standing up a
fresh cluster, do this first.

---

## The trap this doc exists to prevent

K3s ships with a built-in load-balancer implementation called **ServiceLB**
(sometimes called Klipper-LB). It's a DaemonSet that watches LoadBalancer
Services and assigns node IPs as external IPs.

MetalLB does the same job, better — it advertises a single virtual IP
via ARP, which is what we want for `srv*.init-db.lan` style hostnames.

**If both run, they fight.** The fight is silent until something — a Helm
upgrade, a Service annotation change, a controller reconcile — triggers a
re-evaluation. Then one or both retract IP allocations and the affected
Service becomes unreachable.

**Fix: disable K3s ServiceLB at cluster install time.** This guide does that.
If you skip it, search for "MetalLB withdrew IP" in `runbook.md` for recovery.

---

## A few concepts before we start

- **K3s:** a lightweight Kubernetes distribution. Single binary, embedded
  database (sqlite by default). Suits our 3-node bare-metal install.
- **MetalLB:** a Kubernetes service that lets LoadBalancer-type Services get
  real LAN IPs (without a cloud provider doing it for them).
- **L2 mode (vs BGP):** MetalLB has two modes for advertising IPs. We use L2
  (ARP), which works on any flat network. BGP needs router cooperation.

---

## Prerequisites

- [ ] Three Ubuntu 24.04 servers on the same LAN segment (master + two workers).
- [ ] Each server has a static IP (or DHCP reservation pinned by MAC).
- [ ] Each server resolves the others' hostnames (via DNS or `/etc/hosts`).
- [ ] You can ssh into all three as `initadmin` with sudo.
- [ ] A spare range of IPs in the LAN to give to MetalLB (we use
      `172.31.10.83-172.31.10.84`).

---

## Part 1 — install K3s

### 1.1 — install on the master

On the **master** (`srvk3mst01`):

```bash
curl -sfL https://get.k3s.io | sh -s - server \
    --disable=servicelb \
    --disable=traefik \
    --tls-san=srvk3mst01.local
```

Three flags worth understanding:

- `--disable=servicelb` — **this is the critical one.** Stops K3s from
  running its built-in load balancer. We use MetalLB instead.
- `--disable=traefik` — temporarily disables the K3s-bundled Traefik install.
  We re-enable it below with our own config.
- `--tls-san=srvk3mst01.local` — adds the master's hostname to the API
  server's TLS certificate, so workers and `kubectl` can reach the API by
  hostname (not just IP).

The script takes 1-2 minutes. Verify:

```bash
sudo systemctl status k3s
sudo kubectl get nodes
```

Expected: status `active (running)`, one node listed as `Ready`.

### 1.2 — grab the node token

The token is what workers use to join. Read it from the master:

```bash
sudo cat /var/lib/rancher/k3s/server/node-token
```

Copy the output — a long string starting with `K10...::server:`. You'll
paste it on each worker.

### 1.3 — install on each worker

On **each worker** (`srvk3wrk01`, `srvk3wrk02`), substituting the token from
step 1.2:

```bash
curl -sfL https://get.k3s.io | K3S_URL=https://srvk3mst01.local:6443 \
    K3S_TOKEN='<paste token here>' \
    sh -
```

No `--disable` flags on workers — they don't run their own ServiceLB or
Traefik. The master controls what's enabled cluster-wide.

Verify on the **master**:

```bash
sudo kubectl get nodes
```

Should show all three nodes `Ready`. Repeat for the second worker.

### 1.4 — set up kubeconfig for your user

K3s writes `/etc/rancher/k3s/k3s.yaml` as root-only. Make it available to
your user on the master:

```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
chmod 600 ~/.kube/config
```

From here on, `kubectl` works without sudo (using `~/.kube/config`), and
Helm reads `~/.kube/config` directly. Note: K3s also installs `kubectl` as
an alias to `sudo k3s kubectl`, which works too — both paths are fine.

---

## Part 2 — install MetalLB

### 2.1 — install via manifests

```bash
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.9/config/manifests/metallb-native.yaml
```

(Pin the version. v0.14.9 is what we run today; update only after testing.)

Wait for the pods to come up:

```bash
kubectl get pods -n metallb-system -w
```

Expected: 1 controller pod (Running), 3 speaker pods (Running, one per node).
Ctrl+C when settled.

### 2.2 — configure the IP pool

MetalLB needs to know which IPs it's allowed to hand out. Create the pool:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: lan-pool
  namespace: metallb-system
spec:
  addresses:
    - 172.31.10.83-172.31.10.84
  autoAssign: true
EOF
```

Adjust the IP range for your environment. The pool can be a single IP
(`172.31.10.84-172.31.10.84`) or a range. Our setup uses two for room to
grow, even though only `.84` is currently in use (`.83` is free for future
Services).

### 2.3 — enable L2 advertisement

This tells MetalLB to actually answer ARP for the pool's IPs:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: lan-l2
  namespace: metallb-system
spec:
  ipAddressPools:
    - lan-pool
EOF
```

Without this, MetalLB has IPs but won't advertise them — Services get
allocated but the network can't reach them.

### 2.4 — verify

```bash
kubectl get ipaddresspool,l2advertisement -n metallb-system
```

Expected: one of each, no errors.

A full end-to-end test requires a LoadBalancer Service. The Traefik install
in `setup-guide.md` is the first one we add.

---

## Part 3 — re-enable Traefik with our wildcard cert

We disabled Traefik during K3s install (step 1.1) so we can install it
declaratively with our preferred config. Follow the cert-handling sequence
in `setup-guide.md` (Parts X.Y onward).

---

## Common mistakes to avoid

### Forgetting `--disable=servicelb` on the master install

The exact failure mode this doc was written to prevent. If you forgot, two
options:

- **Restart K3s with the flag:** edit `/etc/systemd/system/k3s.service`,
  add `--disable=servicelb` to the ExecStart line, then
  `sudo systemctl daemon-reload && sudo systemctl restart k3s`. Brief
  cluster API downtime (~10 seconds).
- **Live with it and document carefully:** acceptable if the cluster is
  already in use and you can't restart. Add explicit recovery steps for the
  conflict pattern to your runbook.

### Asking MetalLB for the same IP two ways

If you also set `loadBalancerIP` in a Service's `spec` AND set
`metallb.universe.tf/loadBalancerIPs` as an annotation, MetalLB will reject
the allocation with `service can not have both`. Pick one — we use the spec
field, set via HelmChartConfig for Traefik. Never use the annotation.

### Using BGP mode without thinking it through

This guide uses L2. BGP needs your network router to peer with MetalLB. Don't
switch modes unless you've talked with networking and understand the
implications.

---

## Next

After this guide, the cluster is ready for `setup-guide.md` (deploys the
OTP relay app + Traefik) and `observability-setup.md` (deploys
Prometheus/Grafana/Loki).
