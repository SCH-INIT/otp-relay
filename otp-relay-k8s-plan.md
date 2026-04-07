# OTP Relay → Kubernetes: The Actual Plan

**Audience:** Christian, the IT guy, and whoever else is coming along for the ride.  
**TL;DR:** We are not building a dual-DC HA cloud platform. We are learning Kubernetes by containerising a tool we already use, in phases, without blowing ourselves up.

---

## Why we're doing this

The OTP Relay runs on a single Ubuntu VM with systemd and a deploy script. It works. The goal of this project is **not** to make it more reliable — it's to use a real, familiar application as a vehicle for learning containers and Kubernetes properly, so we understand what we're doing when the stakes are higher.

That means:

- We containerise what already exists, without rewriting it first.
- We learn the fundamentals before we touch HA, replication, or cross-site failover.
- We keep the current `main` branch running in production on systemd until we're confident the Kubernetes path is solid.

---

## Branch strategy

Two branches from now on:

| Branch | Purpose |
|---|---|
| `main` | Production. Systemd deploy. Bug fixes only. Do not break this. |
| `k8s` | Everything new. Dockerfile, manifests, iteration. Merge to `main` when we're ready to cut over. |

The `otp-relay-deploy.sh` script stays on `main` until the Kubernetes deployment is proven. Then it becomes a museum piece.

---

## What the app actually is

Before we Kubernetes-ify anything, it helps to understand what we're dealing with:

- **FastAPI** backend, one Python process, one worker.
- **In-memory queue** (`collections.deque`) holds who is waiting for an OTP, with a 5-minute expiry.
- **Flat files:** `data/users.xlsx` (user list), `data/audit.log` (event log).
- **Email via Exchange SMTP** — anonymous relay on port 25.
- **nginx** reverse proxy in front, TLS termination.
- **One iPhone** on the LAN that receives OTP SMS and POSTs to the server.

The critical observation: **if the process restarts, the in-memory queue is gone.** Anyone mid-flow loses their claim and has to start over. This is acceptable in production today because restarts are rare and the user just clicks again. It matters more in Kubernetes because pods restart more freely.

---

## Phase 1 — Containerise and deploy on K3s

**Goal:** Run the existing app in Kubernetes. Nothing else. Learn the fundamentals by doing.

**What we build:**

- `Dockerfile` — packages the app with its venv, copies the frontend, runs uvicorn.
- Kubernetes `Deployment` — one replica, health probes, resource limits.
- `Service` — ClusterIP, then exposed via MetalLB.
- `ConfigMap` — non-secret configuration (SMTP host, port, paths).
- `Secret` — sensitive values (SMS token, SMTP password).
- `PersistentVolumeClaim` — for the `data/` directory (audit log, users.xlsx).
- nginx stays as a sidecar container in the same pod, or we use an ingress controller — decision to make when we get there.

**What we do NOT do in Phase 1:**

- No PostgreSQL.
- No Redis.
- No second replica (would break the in-memory queue immediately).
- No cross-site anything.
- No service mesh.
- No Helm chart yet (write raw manifests first, understand what Helm is abstracting).

**Kubernetes concepts learned:**

`Namespace` · `Deployment` · `Service` · `ConfigMap` · `Secret` · `PersistentVolumeClaim` · liveness probe · readiness probe · rolling update · `kubectl` basics · logs · `CrashLoopBackOff` (you will meet this)

**Done when:** The app is running in K3s, reachable on the LAN via MetalLB IP, and we can update it by pushing a new image and doing a rolling restart.

---

## Phase 2 — Understand stateful pain, then fix it

**Goal:** Break the app on purpose, understand why, then fix it properly.

**Step 1 — break it deliberately:**  
Scale the deployment to two replicas. Watch the claim queue stop working — user A claims on pod 1, the SMS arrives on pod 2, nothing happens. Now you *understand* why shared state matters, not just intellectually but in your gut.

**Step 2 — add Redis:**  
Replace the `collections.deque` in `main.py` with a Redis-backed queue. Redis is the right tool here — it is a fast, simple key-value store with list primitives and TTL support. It is not a database; it does not need schema migrations; it has a tiny operational footprint.

We add a Redis `Deployment` (or a single-instance `StatefulSet`) alongside the app. The app connects via the cluster's internal DNS (`redis.otp-relay.svc.cluster.local` or similar).

This is deliberately *not* PostgreSQL. PostgreSQL would be the right answer if we had relational data, complex queries, or a need for ACID transactions across tables. We have a queue and an expiry window. Redis is the right tool.

**What we learn:**

- Inter-pod networking and cluster DNS.
- `StatefulSet` vs `Deployment` — when each applies.
- Persistent storage for a database container.
- What `init containers` are for (waiting for Redis to be ready before the app starts).
- Why connection strings and service discovery work the way they do in Kubernetes.

The audit log (`audit.log`) can stay as a flat file on the PVC for now. Long-term it should go somewhere centralised (Loki, or just stdout and a log aggregator), but that is Phase 3 or 4 territory.

---

## Phase 3 — Resilience within one cluster

**Goal:** Make the single-cluster deployment properly robust. Learn failure behaviour.

- Run two app replicas (now that the queue is in Redis, this works).
- Add proper resource `requests` and `limits` to every container.
- Set up a `PodDisruptionBudget` so rolling updates never take everything down at once.
- Add monitoring: Prometheus + Grafana, or at minimum k9s for interactive cluster inspection.
- Simulate failures: kill a pod, drain a node, watch Kubernetes recover. This is where the learning gets visceral.
- Explore horizontal pod autoscaling — probably not needed for this app, but worth understanding the mechanism.

**Done when:** We can kill any single pod or node and the service keeps running without anyone noticing.

---

## Phase 4 — Second data centre (if we still want to learn more)

By the time we get here, everyone involved will know enough Kubernetes to understand what "PostgreSQL streaming replication across two clusters" actually means in practice — the networking requirements, the failover complexity, the operational burden. At that point we can make an informed decision about whether it is worth it for this specific application.

The short answer is probably: for OTP Relay specifically, a warm standby in DC2 with a manual failover runbook is sufficient. Active/active requires redesigning the app to be genuinely stateless or to handle distributed coordination, which is a significant project.

But that is a future-Christian problem.

---

## What we are explicitly not doing (and why)

| Temptation | Why we're skipping it |
|---|---|
| Start with dual-DC active/standby | Too complex to learn from. Simulating failures within one cluster teaches the same concepts. |
| PostgreSQL in Phase 1 | Adds DB container ops, migrations, and connection management before we understand basic pod scheduling. Wrong order. |
| Helm chart immediately | Helm abstracts exactly the things we need to understand manually first. Write raw manifests, then graduate to Helm. |
| Multiple replicas in Phase 1 | The in-memory queue breaks immediately. Experience the problem before you solve it. |
| Rewrite the app before containerising | Containerise what exists. Iterate from there. |

---

## Suggested repo layout (in the `k8s` branch)

```
deploy/
  Dockerfile
  manifests/
    namespace.yaml
    configmap.yaml
    secret-example.yaml      ← committed, real secret stays out of git
    deployment.yaml
    service.yaml
    pvc.yaml
  redis/
    deployment.yaml
    service.yaml
    pvc.yaml
docs/
  k8s-plan.md                ← this file
  diagrams/
    phase1-architecture.svg
```

---

## The one-line version

**Get it running in a container on K3s this week. Everything else is iteration.**
