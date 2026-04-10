# OTP Relay — setup and operations guide

**For:** Jathin
**Level:** Beginner — every command is explained
**Server:** `srvk3s01.init-db.lan` — `172.31.9.10`

This guide walks you through deploying the OTP Relay application on your K3s
cluster, and operating it day to day. No prior Kubernetes experience assumed.

---

## A few concepts before we start

Kubernetes can feel like a lot of new words at once. Here are the only ones
you need for this guide:

**Pod** — the running application. Think of it as the container that actually
does the work. If something goes wrong, Kubernetes restarts the pod
automatically.

**Deployment** — the instruction sheet that tells Kubernetes how to run the
pod. How many copies, what image to use, how much memory it gets, when to
restart it.

**Service** — gives the pod a stable network address. Without a Service, the
pod's IP address changes every time it restarts. The Service stays fixed.

**ConfigMap** — a place to store configuration values (non-secret settings)
that the app reads at startup.

**Secret** — same as ConfigMap but for sensitive values like passwords and
tokens. Kubernetes stores these separately and handles them more carefully.

**PersistentVolumeClaim (PVC)** — a request for disk space. The app needs
somewhere to store the user list and audit log that survives pod restarts. The
PVC provides that.

**Namespace** — a way to group related resources together and keep them
separate from other things running on the cluster. All OTP Relay resources live
in the `otp-relay` namespace.

---

## Prerequisites

Before following this guide, you need:

- [ ] K3s installed and running on `srvk3s01.init-db.lan`
- [ ] MetalLB installed and configured with a LAN IP range
- [ ] `kubectl` available on the server (K3s includes this automatically)
- [ ] The repo cloned on the server — or at minimum the `k8s/manifests/`
      folder copied across
- [ ] The `secret.env` file created with the real token value (Christian
      provides this)
- [ ] The `otp-relay-latest.tar` image file from Christian, sitting in `/tmp/`

---

## Part 1 — first-time setup

Do this once when setting up the cluster for the first time.

### 1.1 — verify K3s is running

```bash
sudo k3s kubectl get nodes
```

You should see your node listed with status `Ready`. If it says `NotReady`,
K3s is still starting — wait 30 seconds and try again.

From here on, `kubectl` is the command you use to talk to Kubernetes.
K3s installs its own version. Run it as:

```bash
sudo k3s kubectl <command>
```

Or set up a shortcut so you can just type `kubectl`:

```bash
echo 'alias kubectl="sudo k3s kubectl"' >> ~/.bashrc
source ~/.bashrc
```

The rest of this guide uses `kubectl` for brevity — remember it means
`sudo k3s kubectl` on your system.

---

### 1.2 — import the container image

Christian has copied `otp-relay-latest.tar` to `/tmp/`. Import it into K3s:

```bash
sudo k3s ctr images import /tmp/otp-relay-latest.tar
```

This makes the image available to K3s without needing a registry. Verify it
arrived:

```bash
sudo k3s ctr images list | grep otp-relay
```

You should see `otp-relay:latest` in the output.

---

### 1.3 — create the namespace

The namespace is the logical home for everything OTP Relay. Create it first:

```bash
kubectl apply -f k8s/manifests/namespace.yaml
```

Verify:

```bash
kubectl get namespace otp-relay
```

You should see `otp-relay` with status `Active`.

---

### 1.4 — load the secret

The secret holds the SMS token. Christian provides you with a `secret.env`
file. Do not commit this file to git and do not share it.

```bash
kubectl create secret generic otp-relay-secrets \
  --from-env-file=k8s/manifests/secret.env \
  --namespace=otp-relay \
  --dry-run=client -o yaml | kubectl apply -f -
```

This command looks complicated but it is safe to run multiple times — it
creates the secret if it does not exist, and updates it if it does. The
`--dry-run=client -o yaml | kubectl apply -f -` part is just a safe way to
apply it without errors on re-runs.

Verify the secret exists (you cannot see the value, only that it is there):

```bash
kubectl get secret otp-relay-secrets -n otp-relay
```

---

### 1.5 — apply the remaining manifests

Apply them in this order:

```bash
kubectl apply -f k8s/manifests/configmap.yaml
kubectl apply -f k8s/manifests/pvc.yaml
kubectl apply -f k8s/manifests/deployment.yaml
kubectl apply -f k8s/manifests/service.yaml
```

Each command should respond with `created` or `configured`. If you see
`error`, paste the output and we will fix it.

---

### 1.6 — check everything is running

Check the pod:

```bash
kubectl get pods -n otp-relay
```

You should see something like:

```
NAME                         READY   STATUS    RESTARTS   AGE
otp-relay-6d4f9b8c7-xk2pq   1/1     Running   0          45s
```

`1/1` means one container running out of one expected. `Running` is what you
want. If you see `Pending` wait 30 seconds and check again. If you see
`CrashLoopBackOff` something went wrong — see the troubleshooting section.

Check the service and its LAN IP:

```bash
kubectl get service -n otp-relay
```

You should see a line with `TYPE: LoadBalancer` and an `EXTERNAL-IP` — that
is the LAN IP MetalLB has assigned. Open that IP in a browser and you should
see the OTP Relay portal.

---

## Part 2 — updating the app

Christian sends you a new `otp-relay-latest.tar`. Here is what you do:

### 2.1 — import the new image

```bash
sudo k3s ctr images import /tmp/otp-relay-latest.tar
```

### 2.2 — restart the deployment

Tell Kubernetes to restart the pod with the new image:

```bash
kubectl rollout restart deployment/otp-relay -n otp-relay
```

Kubernetes starts a new pod with the new image, waits until it is healthy,
then removes the old pod. The app stays available during the update.

### 2.3 — verify the update

```bash
kubectl rollout status deployment/otp-relay -n otp-relay
```

When it says `successfully rolled out`, the update is done.

---

## Part 3 — day to day operations

### Checking if the app is running

```bash
kubectl get pods -n otp-relay
```

`Running` and `1/1` — all good. Anything else — check the logs.

### Reading the application logs

```bash
kubectl logs -n otp-relay deployment/otp-relay
```

To follow the logs live (like `tail -f`):

```bash
kubectl logs -n otp-relay deployment/otp-relay -f
```

Press `Ctrl+C` to stop following.

### Restarting the app

```bash
kubectl rollout restart deployment/otp-relay -n otp-relay
```

This does a clean restart with zero downtime — Kubernetes starts the new pod
before stopping the old one.

### Uploading a new users.xlsx

The `users.xlsx` file lives on the PersistentVolumeClaim mounted at
`/app/data/` inside the pod. Copy a new file in with:

```bash
kubectl cp users.xlsx otp-relay/<pod-name>:/app/data/users.xlsx
```

Replace `<pod-name>` with the actual pod name from `kubectl get pods -n otp-relay`.

Then reload the user list without restarting:

```bash
kubectl exec -n otp-relay deployment/otp-relay -- \
  wget -qO- --method=POST http://localhost:8000/admin/reload-users
```

### Checking resource usage

```bash
kubectl top pod -n otp-relay
```

Shows CPU and memory usage for the pod. If memory is consistently near the
256Mi limit, tell Christian — the limit may need raising.

---

## Part 4 — troubleshooting

### Pod is in CrashLoopBackOff

The app is crashing on startup. Read the logs:

```bash
kubectl logs -n otp-relay deployment/otp-relay --previous
```

The `--previous` flag shows the logs from the crashed instance, not the
current (also crashing) one. Common causes:

- **Secret not found** — the `otp-relay-secrets` secret was not created.
  Run step 1.4 again.
- **Image not found** — the image was not imported. Run step 1.2 again.
- **Permission error on /app/data** — the PVC ownership does not match the
  container user. Tell Christian and share the log output.

### Pod is stuck in Pending

```bash
kubectl describe pod -n otp-relay <pod-name>
```

Look at the `Events` section at the bottom. Common causes:

- **No nodes available** — the cluster has no capacity. Check node status
  with `kubectl get nodes`.
- **PVC not bound** — the PersistentVolumeClaim could not find storage.
  Check with `kubectl get pvc -n otp-relay`.

### Service has no EXTERNAL-IP

MetalLB has not assigned an IP. Check that MetalLB is running and that its
IP pool is configured correctly. This is a MetalLB configuration issue, not
an app issue.

### The app is running but the portal does not load

Check the service:

```bash
kubectl get service -n otp-relay
```

If `EXTERNAL-IP` shows `<pending>`, MetalLB has not assigned an IP yet —
see above. If there is an IP, try curling it directly:

```bash
curl http://<external-ip>/admin/queue
```

If that returns JSON, the app is fine and the issue is the browser or network.

---

## Part 5 — useful commands at a glance

```bash
kubectl get pods -n otp-relay                          # is it running?
kubectl get service -n otp-relay                       # what IP is it on?
kubectl logs -n otp-relay deployment/otp-relay         # what is it saying?
kubectl logs -n otp-relay deployment/otp-relay -f      # follow logs live
kubectl rollout restart deployment/otp-relay -n otp-relay   # restart it
kubectl rollout status deployment/otp-relay -n otp-relay    # update status
kubectl top pod -n otp-relay                           # resource usage
kubectl describe pod -n otp-relay <pod-name>           # deep diagnostics
```

---

## Getting help

If something is not in this guide, the first place to look is:

```bash
kubectl describe <resource> -n otp-relay <name>
```

The `Events` section at the bottom of the output almost always tells you
what went wrong. Copy it and share it with Christian.
