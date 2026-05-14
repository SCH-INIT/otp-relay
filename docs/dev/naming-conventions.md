# Naming conventions

This document codifies how we name DNS hostnames in the K3s cluster
environment. The rules exist so that the next service we add does not have to
reinvent the convention.

---

## The split

There are two kinds of names, and they follow different rules.

| Layer | What it names | Convention | Example |
|---|---|---|---|
| Hosts | Physical or virtual machines (cluster nodes) | `srv<role><nn>.local` | `srvk3mst01.local` |
| Services | Things users or other services talk to | `<purpose>.init-db.lan` | `otp.init-db.lan` |

The `srv` prefix on host names is a legacy from the previous server-naming
convention. It is correct for hosts: they are servers. It is wrong for
services: a service is a function, not a box.

---

## Host names

Cluster nodes use `srv<role><nn>.local`:

| Role | Hostname | Address |
|---|---|---|
| K3s master | `srvk3mst01.local` | `172.31.10.52` |
| K3s worker (storage node) | `srvk3wrk01.local` | `172.31.10.53` |
| K3s worker | `srvk3wrk02.local` | `172.31.10.54` |

The `.local` zone is internal to the cluster network. These names are not
reachable from the wider company LAN, and that is by design. Hosts are
infrastructure; only services should be exposed.

---

## Service names

Service hostnames live under `init-db.lan` and use a short, purpose-driven
label.

Rules:

1. **Short.** One word where possible. `otp`, `rta`, `grafana`.
2. **Purpose-driven.** Name the function, not the box it runs on, and not the
   sequence number of the host that happens to host it.
3. **Lowercase, no hyphens unless unavoidable.** `otp` not `otp-relay`,
   `grafana` not `grafana-dashboard`.
4. **No version numbers, no instance numbers, no `srv` prefix.**

Current service names:

| Service | DNS | Purpose |
|---|---|---|
| `otp.init-db.lan` | OTP Relay portal | Frontend + API for staff and the iPhone Shortcut |
| `rta.init-db.lan` | RTA Access Portal | Onboarding guidance and admin tooling for RTA |
| `grafana.init-db.lan` | Grafana | Metrics and logs dashboard for the cluster and app |

Future services follow the same pattern.

---

## Product names vs functional names

Some service names match a product (`grafana`). Others are functional (`otp`,
`rta`). We accept both, but the preference depends on the case:

- **Use the product name** when the product is well-known and unlikely to be
  swapped soon. Grafana is a stable choice; staff search "grafana" in their
  browser bar; matching the DNS to the muscle-memory wins.
- **Use a functional name** when the underlying tool is an implementation
  detail or might change. We name the OTP relay `otp`, not `fastapi` or
  `otp-relay`.

If you have to think about which to use, default to **functional**. Product
names are a convenience, not a rule.

---

## What stays internal

Most observability components do not need their own DNS entry. They are
reached through Grafana, not directly:

- Prometheus UI
- Loki query interface
- Alertmanager UI

If a debugging session calls for direct access, use `kubectl port-forward`
from the master. Do not give them public-facing names; that is more attack
surface for no benefit.

---

## Migration history

Previous names that have been retired:

| Old name | New name | Date retired | Notes |
|---|---|---|---|
| `srvotp26.init-db.lan` | `otp.init-db.lan` | (Phase 1.5 TLS cleanup) | Hard cutover, no transition period — portal not yet in productive use |

When retiring an old name, remove it from DNS in the same change that adds
the new one. Do not keep both pointed at the same Service indefinitely; that
guarantees the convention rots back into mixed state.
