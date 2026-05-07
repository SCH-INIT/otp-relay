# GitHub Actions deployment for OTP Relay K3s

This is the recommended deployment path for the OTP Relay Kubernetes repository.

The GitHub Actions workflow runs on a self-hosted runner installed on the K3s server. The installer registers the runner before Docker/K3s deployment work starts. The runner builds the app and monitor images locally, imports them into K3s containerd, applies the Kubernetes manifests, and restarts the deployments.

This avoids Docker Hub, a private registry, SSH file copy, and manual image tar handoff.

---

## Deployment model

```text
git push to main
  -> GitHub Actions job starts
  -> self-hosted runner on the K3s server checks out the repo
  -> installer syncs /opt/otp-relay-k8s to origin/main
  -> installer builds otp-relay:latest and otp-monitor:latest
  -> installer imports both images into K3s
  -> installer applies manifests and waits for rollouts
```

The installer remains the source of truth. The workflow intentionally calls `install-otp-relay-k8s.sh` instead of duplicating deployment logic in YAML.

---

## One-time runner bootstrap

Create a self-hosted runner token in GitHub:

```text
Repository -> Settings -> Actions -> Runners -> New self-hosted runner
```

Then run this once on the K3s server. Runner setup happens first, before Docker and K3s deployment packages are installed:

```bash
sudo INSTALL_GITHUB_RUNNER=1 \
  GITHUB_RUNNER_URL="https://github.com/psi1703/k8s" \
  GITHUB_RUNNER_TOKEN="PASTE_RUNNER_TOKEN_HERE" \
  PHONE_IP="172.31.10.161" \
  PHONE_INTERFACE="eth0" \
  WHATSAPP_API_KEY="PASTE_WHATSAPP_API_KEY_HERE" \
  WHATSAPP_RECIPIENT="PASTE_WHATSAPP_RECIPIENT_HERE" \
  PORTAL_URL="http://SERVER_IP_OR_DNS" \
  NONINTERACTIVE=1 \
  bash install-otp-relay-k8s.sh
```

The installer does not assign a custom runner name or custom labels. GitHub's default runner name and default labels are used.

The workflow targets the default labels:

```text
self-hosted, Linux, X64
```

---

## Required GitHub Actions secrets

Create these repository secrets:

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

Required:

```text
PHONE_IP
PHONE_INTERFACE
WHATSAPP_API_KEY
WHATSAPP_RECIPIENT
PORTAL_URL
```

Example:

```text
PHONE_IP=172.31.10.161
PHONE_INTERFACE=eth0
PORTAL_URL=http://172.31.11.107
```

Do not commit WhatsApp credentials or runtime secrets into the repository.

---

## Normal deployment

After the runner is online and the secrets exist, deploy by pushing to `main`:

```bash
git add .
git commit -m "Add GitHub Actions K3s deployment"
git push origin main
```

You can also deploy manually from GitHub:

```text
Actions -> Deploy OTP Relay to K3s -> Run workflow
```

---

## What the workflow does

The workflow file is:

```text
.github/workflows/deploy-k3s.yml
```

It runs on:

- push to `main`
- manual `workflow_dispatch`

The workflow command is intentionally narrow:

```bash
sudo -E /usr/bin/bash /opt/otp-relay-k8s/install-otp-relay-k8s.sh
```

During runner bootstrap, the installer creates a restricted sudoers rule allowing the runner user to execute only that installer command with environment preservation.

---

## Operational checks

On the server:

```bash
sudo systemctl status actions.runner* --no-pager
sudo k3s kubectl get pods -n otp-relay
sudo k3s kubectl get svc,ingress -n otp-relay
sudo k3s kubectl logs -n otp-relay deployment/otp-relay --tail=100
sudo k3s kubectl logs -n otp-relay deployment/otp-monitor --tail=100
```

In GitHub:

```text
Repository -> Actions -> Deploy OTP Relay to K3s
```

A successful run should show the installer completing the app rollout and monitor rollout.

---

## Fallback deployment

If GitHub Actions is unavailable, run the installer directly on the server:

```bash
sudo PHONE_IP="172.31.10.161" \
  PHONE_INTERFACE="eth0" \
  WHATSAPP_API_KEY="PASTE_WHATSAPP_API_KEY_HERE" \
  WHATSAPP_RECIPIENT="PASTE_WHATSAPP_RECIPIENT_HERE" \
  PORTAL_URL="http://SERVER_IP_OR_DNS" \
  NONINTERACTIVE=1 \
  bash /opt/otp-relay-k8s/install-otp-relay-k8s.sh
```

The manual Docker image export process remains available as a last-resort fallback, but GitHub Actions is the preferred path.
