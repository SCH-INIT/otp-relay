# Building and deploying OTP Relay images

The recommended build path is now GitHub Actions with a self-hosted runner on the K3s server. Runner setup is performed first in the installer, before Docker/K3s deployment work.

The previous laptop build/export workflow is kept below as a manual fallback only.

---

## Recommended path: GitHub Actions self-hosted runner

Use this path for normal deployments.

```text
git push to main
  -> GitHub Actions job runs on the K3s server
  -> app and monitor images build locally
  -> images are imported into K3s containerd
  -> Kubernetes manifests are applied
  -> app and monitor deployments are restarted
```

The workflow is stored at:

```text
.github/workflows/deploy-k3s.yml
```

The full setup guide is stored at:

```text
docs/operations/github-actions-deploy.md
```

This path avoids Docker Hub, a private registry, SCP, and manual image tar transfer.

---

## Manual fallback: build and export from your laptop

Use this only if the self-hosted GitHub runner is unavailable.

### What you need on your laptop

- Docker Desktop for Windows
- Git Bash
- The repo checked out on the deployment branch

Install Docker Desktop, start it, and make sure it is running. You do not need to log in to Docker Hub.

---

## Laptop fallback workflow

### Step 1 - update your checkout

```bash
git checkout main
git pull origin main
```

### Step 2 - build the app image

Run this from the repo root:

```bash
docker build -t otp-relay:latest -f k8s/Dockerfile .
```

### Step 3 - build the monitor image

```bash
docker build -t otp-monitor:latest -f k8s/Dockerfile.monitor .
```

### Step 4 - verify the images exist

```bash
docker images otp-relay
docker images otp-monitor
```

### Step 5 - export the images

```bash
docker save otp-relay:latest -o otp-relay-latest.tar
docker save otp-monitor:latest -o otp-monitor-latest.tar
```

### Step 6 - copy the files to the K3s node

```bash
scp otp-relay-latest.tar otp-monitor-latest.tar jathin@srvk3s01.init-db.lan:/tmp/
```

Replace `jathin` and the host name with the correct server login details.

### Step 7 - import images on the server

```bash
sudo k3s ctr images import /tmp/otp-relay-latest.tar
sudo k3s ctr images import /tmp/otp-monitor-latest.tar
sudo k3s kubectl rollout restart deployment/otp-relay -n otp-relay
sudo k3s kubectl rollout restart deployment/otp-monitor -n otp-relay
sudo k3s kubectl rollout status deployment/otp-relay -n otp-relay --timeout=180s
sudo k3s kubectl rollout status deployment/otp-monitor -n otp-relay --timeout=180s
```

---

## Quick reference: preferred deployment

```bash
git add .
git commit -m "Update OTP Relay Kubernetes deployment"
git push origin main
```

Then watch:

```text
GitHub -> Actions -> Deploy OTP Relay to K3s
```

---

## Troubleshooting

**GitHub job says no runner is available**

Check that the self-hosted runner service is running on the K3s server. The workflow uses GitHub default labels `self-hosted`, `Linux`, and `X64`:

```bash
sudo systemctl status actions.runner* --no-pager
```

**GitHub job fails at sudo**

Re-run the installer once with `INSTALL_GITHUB_RUNNER=1` so it creates the restricted sudoers rule for the runner user.

**Docker build fails**

Open the failed GitHub Actions run and inspect the build step output. For local fallback builds, confirm Docker Desktop is running.

**Kubernetes rollout fails**

Check pod status and logs:

```bash
sudo k3s kubectl get pods -n otp-relay
sudo k3s kubectl logs -n otp-relay deployment/otp-relay --tail=100
sudo k3s kubectl logs -n otp-relay deployment/otp-monitor --tail=100
```
