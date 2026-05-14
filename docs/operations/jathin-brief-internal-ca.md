# Brief: Internal CA and wildcard cert for K3s services

**From:** Christian
**For:** Jathin
**Context:** We are tightening up TLS for the K3s cluster and adding more
internal HTTPS services (Grafana next, more later). This brief describes what
we need from you so the cluster side can be planned around it.

---

## What we need

### 1. Internal CA

A self-signed root CA that we trust on internal devices once and then forget
about.

- Tooling: your choice (`openssl`, `cfssl`, `step-ca`, whatever you are
  comfortable with).
- CA validity: long, e.g. 10 years. The CA only signs other certs; it does
  not serve traffic.
- Key type: RSA 4096 or ECDSA P-256. Either is fine.
- **CA private key storage:** encrypted, offline, not in the cluster, not in
  the repo, not on a shared drive. Your call where it lives; one location,
  documented, recoverable by you specifically.

### 2. Wildcard server cert

A single cert that covers every current and future service under
`*.init-db.lan`, plus one IP address.

- Common Name: `*.init-db.lan`
- Subject Alternative Names:
  - `DNS:*.init-db.lan`
  - `DNS:init-db.lan` (covers the apex, useful for some clients)
  - **`IP:172.31.10.84`** (see "Why the IP SAN" below)
- Validity: **1 year**, not 10. We want to keep the renewal workflow alive
  rather than discover it has rotted after a decade.
- Key type: RSA 2048 or ECDSA P-256.

We do **not** need per-service certs. The wildcard covers everything that
matters.

#### Why the IP SAN

The iPhone Shortcut that posts received SMS messages to the portal connects
by IP, not by DNS name. The reason is an iOS quirk: Shortcuts running in
background context have unreliable DNS resolution. A hardcoded IP is the only
reliable way for that client to reach the portal.

Because the Shortcut uses `https://172.31.10.84/...`, TLS validation
requires an IP SAN. A pure DNS wildcard cert is not enough for that client.

### 3. DNS entries

Please add the following A records on the company DNS server:

| Hostname | Points to |
|---|---|
| `rta.init-db.lan` | `172.31.10.84` |
| `grafana.init-db.lan` | (to be assigned from MetalLB pool, will confirm) |

Please also **remove** the old entry once we cut over:

| Hostname | Action |
|---|---|
| `srvotp26.init-db.lan` | Remove. Hard cutover. |

### 4. Delivery

We need from you:

- The CA public certificate (`.crt` or `.pem`), distributable to devices.
- The wildcard server cert (`fullchain.pem` or equivalent — including
  intermediates if any) and its private key (`privkey.pem`).
- Confirmation that the DNS entries are live.

The wildcard private key will live in a Kubernetes Secret in the `kube-system`
namespace, used by Traefik. We will create that Secret on the cluster side.

### 5. Traefik IP pinning

You confirmed you will add an explicit `loadBalancerIP: 172.31.10.84`
annotation (via a `HelmChartConfig` override) on the bundled K3s Traefik
LoadBalancer Service. This keeps `.84` permanently bound to Traefik so the
IP cannot drift to another Service. The cert's IP SAN depends on this being
stable.

### 6. iPhone trust

You mentioned you will handle the iPhone trust install yourself. To save a
round-trip:

- After installing the profile, the iPhone needs **General → About → Certificate
  Trust Settings → enable the CA**.
- Reboot the iPhone afterwards. iOS Shortcuts in background context do not
  pick up new TLS trust until reboot.

---

## Why this shape

- **One CA, one cert, many services.** Trust the CA once on each device, and
  every future internal service is covered without redistributing trust.
- **Wildcard rather than SAN list.** We do not want to re-issue every time we
  add a service.
- **1-year server cert, 10-year CA.** Server certs should rotate often
  enough that the workflow stays warm. The CA can be long-lived because
  rotating it means redistributing trust to every device — painful, so do it
  rarely.
- **One IP SAN, deliberately.** The iPhone client is the only exception to
  DNS-based addressing, and it exists for a documented technical reason. We
  do not generalise this to other clients.

---

## What we do on our side

Once you deliver the cert bundle and confirm DNS:

1. Install the wildcard cert as Traefik's default cert.
2. Update the OTP Relay IngressRoute to match `rta.init-db.lan` (drop the
   old hostname).
3. Reconfigure the OTP Relay Service to ClusterIP (it currently has a
   dedicated MetalLB IP `172.31.10.83` that is no longer needed).
4. Update the iPhone Shortcut URL to `https://172.31.10.84/sms-received`
   (same IP as today, now over HTTPS instead of HTTP).
5. Verify:
   - Users on the LAN can reach `https://rta.init-db.lan` without cert
     warnings (after they install the CA).
   - The iPhone can post to `https://172.31.10.84/sms-received` with TLS
     validation passing.

---

## Questions for you

1. Approximately when can you have the CA and wildcard cert ready? We can
   proceed with the observability work in parallel, but TLS has to land
   before we expose Grafana.
2. How do you want to distribute the CA certificate to user devices —
   email, shared drive, Intune, manual install? Affects the rollout plan.
3. Any of the above shape you would push back on?
