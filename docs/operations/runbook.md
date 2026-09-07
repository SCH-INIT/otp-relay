# Runbook

Operational procedures for known failure modes. Each entry has the same
shape: symptoms, diagnosis, recovery, root cause.

This doc grows organically. When something breaks and we fix it, an entry
lands here. Over time it becomes the most-useful doc in the repo.

For acute issues during business hours, just call Christian or Parminder.
This doc is for when nobody answers, or for the second time it happens.

---

## Index

- [MetalLB withdrew the IP — Traefik unreachable](#metallb-withdrew-the-ip)

---

## MetalLB withdrew the IP

### Symptoms

- `https://rta.init-db.lan` doesn't load, browser says connection failed.
- `https://grafana.init-db.lan` same.
- iPhone Shortcut posts to `https://172.31.10.84/sms-received` get
  "could not connect" errors.
- Audit log shows no `sms_received` events recently.
- From the master, `ping 172.31.10.84` returns `Destination Host Unreachable`.

### Quick recovery (if you know what to do)

```bash
kubectl annotate svc traefik -n kube-system metallb.universe.tf/loadBalancerIPs-
kubectl rollout restart deployment controller -n metallb-system
```

Watch:

```bash
kubectl logs -n metallb-system deployment/controller --tail=10 -f
```

When you see `ipAllocated` for `172.31.10.84` (10-30 seconds), the IP is
back. Ctrl+C the log tail. Verify with `ping 172.31.10.84` from the master.

### Full diagnosis (if you're not sure)

Run these in order. Stop and act when one of them shows the problem.

**1. Is the cluster itself alive?**

```bash
kubectl get nodes
```

All three nodes should be `Ready`. If not, the problem is bigger than this
runbook entry — go look at the unreachable nodes.

**2. Are Traefik and MetalLB pods running?**

```bash
kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik
kubectl get pods -n metallb-system
```

All should be Running. Restarts should be 0 (or very small).

**3. Can the master ARP-resolve `.84`?**

```bash
ping -c 2 172.31.10.84
ip neigh show 172.31.10.84
```

If `Destination Host Unreachable` and `ip neigh` shows `FAILED`, MetalLB
has stopped answering ARP for this IP. Continue to step 4.

**4. Has MetalLB withdrawn the IP?**

```bash
kubectl logs -n metallb-system -l component=speaker --tail=50 | grep "172.31.10.84"
```

If you see `serviceWithdrawn ... reason:ipNotAllowed`, that's the symptom.
The IP allocation failed validation. Continue to step 5.

**5. What's the controller saying?**

```bash
kubectl logs -n metallb-system deployment/controller --tail=40 | grep -iE "error|allocation"
```

The error message `service can not have both metallb.io/loadBalancerIPs and
svc.Spec.LoadBalancerIP` confirms the root cause: the Traefik Service has
both an annotation and a spec field asking MetalLB for the same IP. MetalLB
demands one or the other, not both.

**6. Apply the fix.**

Remove the duplicate annotation:

```bash
kubectl annotate svc traefik -n kube-system metallb.universe.tf/loadBalancerIPs-
```

This leaves the `spec.loadBalancerIP` field in place (which is the
source-of-truth, applied via our HelmChartConfig). MetalLB will re-allocate
within seconds.

```bash
kubectl logs -n metallb-system deployment/controller --tail=10 -f
```

When you see `ipAllocated` for the IP, recovery is done.

### Root cause

K3s ships with a bundled load balancer called **ServiceLB** that competes
with MetalLB. Both watch LoadBalancer-type Services and try to assign IPs.

A second issue is configurational: the Traefik Service has accumulated two
ways of asking for the same IP (one annotation, one spec field). The
annotation was added manually with `kubectl annotate` early in the cluster
life. The spec field came later, from a HelmChartConfig.

MetalLB tolerates the dual config most of the time, but when the controller
reconciles (e.g. after a Helm release upgrade, a pod restart, or K3s
ServiceLB stepping in), the validation rule fires and MetalLB withdraws
the IP.

### Permanent fix (pending)

Two changes need to land to make this go away:

1. **Disable K3s ServiceLB cluster-wide.** Requires adding
   `--disable=servicelb` to the K3s server install args. Documented in
   `k3s-cluster-bootstrap.md`. Restarting K3s causes ~10 seconds of API
   downtime, so plan it.

2. **Verify no Services have both an annotation and a spec.loadBalancerIP.**
   For new Services, always use the spec field via HelmChartConfig.

Until both are done, this failure can recur. The recovery procedure above
takes about a minute.
