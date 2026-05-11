# OTP Relay — Deployment Guide

Step-by-step instructions for deploying OTP Relay on a fresh K3s cluster.
Run all `kubectl` commands on the master node as `initadmin` (or equivalent sudo user).

Throughout this guide, `kubectl` means `sudo k3s kubectl`.


## Prerequisites

A K3s cluster with at least one master and one worker node.
K3s must be installed with the built-in load balancer (servicelb/Klipper) disabled,
because we use MetalLB instead. If the cluster is already running with Klipper active,
fix it before proceeding:

    # /etc/rancher/k3s/config.yaml
    disable:
      - servicelb

Restart K3s after editing: `sudo systemctl restart k3s`.

Verify Klipper is gone: `kubectl get pods -A | grep svclb` should return nothing.


## 1. Install MetalLB

    kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.9/config/manifests/metallb-native.yaml

Wait for all pods to be Running:

    kubectl get pods -n metallb-system -w

Then apply the IP pool config:

    kubectl apply -f k8s/metallb-config.yaml

This assigns `172.31.10.83` to otp-relay and `172.31.10.84` to Traefik.
Adjust the addresses in `metallb-config.yaml` if your network uses different IPs.


## 2. Label a worker node

Pick one worker node to run the pods. Both otp-relay and otp-monitor must run on the
same node because they share a ReadWriteOnce PVC.

    kubectl label node <worker-node> otp-relay/storage=true

Example: `kubectl label node srvk3wrk01 otp-relay/storage=true`


## 3. Import container images

Build the images on your laptop (from the repo root):

    docker build -f k8s/Dockerfile -t otp-relay:latest .
    docker build -f k8s/Dockerfile.monitor -t otp-monitor:latest .
    docker save otp-relay:latest -o otp-relay.tar
    docker save otp-monitor:latest -o otp-monitor.tar

Copy the tar files to the labeled worker node (not the master, not any other worker):

    scp otp-relay.tar otp-monitor.tar initadmin@<worker-ip>:~/

SSH into the worker node and import:

    sudo k3s ctr images import ~/otp-relay.tar
    sudo k3s ctr images import ~/otp-monitor.tar


## 4. Run preflight check

Copy the k8s/ directory to the master node:

    scp -r k8s/ initadmin@<master-ip>:~/k8s/

Run the preflight script on the master:

    bash ~/k8s/preflight.sh

Fix any errors before continuing.


## 5. Create namespace

    kubectl apply -f ~/k8s/namespace.yaml


## 6. Create secret

    kubectl create secret generic otp-relay-secrets \
      --namespace=otp-relay \
      --from-literal=SMS_SECRET_TOKEN='<your-sms-token>' \
      --from-literal=TELEGRAM_BOT_TOKEN='<your-bot-token>' \
      --from-literal=TELEGRAM_CHAT_ID='<your-chat-id>' \
      --dry-run=client -o yaml | kubectl apply -f -

See `secret-example.env` for the key names. Never commit actual secret values.


## 7. Apply manifests

    kubectl apply -f ~/k8s/configmap.yaml
    kubectl apply -f ~/k8s/pvc.yaml
    kubectl apply -f ~/k8s/service.yaml
    kubectl apply -f ~/k8s/deployment.yaml
    kubectl apply -f ~/k8s/deployment-monitor.yaml


## 8. Verify

    kubectl get all -n otp-relay

Both pods should show `1/1 Running`. The service should show `172.31.10.83`
as EXTERNAL-IP.

Smoke test:

    curl http://172.31.10.83/readyz


## 9. Load users

Copy `users.xlsx` to the master node, then into the running pod:

    kubectl cp ~/users.xlsx otp-relay/<pod-name>:/app/data/users.xlsx

Set up the admin credential (first time only):

    curl -X POST http://172.31.10.83/admin/auth/setup \
      -H "Content-Type: application/json" \
      -d '{"credential": "<your-admin-password>"}'

Save the session token from the response, then reload users:

    curl -X POST http://172.31.10.83/admin/reload-users \
      -H "X-Admin-Session: <session-token>"

Verify: `curl http://172.31.10.83/readyz` should show a non-zero user count.


## 10. Configure iOS Shortcut

Update the Shortcut on the shared iPhone with:

    URL:    http://<METALLB_IP>/sms-received
    Method: POST
    Header: X-Secret-Token: <SMS_SECRET_TOKEN value>
    Body:   {"body": "<SMS text variable>"}

Test by triggering an OTP while a user is in the claim queue.


## Updating the deployment

After code changes, rebuild the affected image, export as tar, copy to the
labeled worker node, import, then restart:

    kubectl rollout restart deployment/otp-relay -n otp-relay
    kubectl rollout restart deployment/otp-monitor -n otp-relay

After ConfigMap changes, apply then restart the affected deployment(s).

After secret changes, re-run the `kubectl create secret` command (it's idempotent
with `--dry-run=client | kubectl apply`), then restart the affected deployment(s).


## Troubleshooting

**Pods stuck in Pending**: Check node labels (`kubectl get nodes --show-labels`)
and image availability on the target node.

**CreateContainerConfigError**: A secret or configmap key is missing. Check
`kubectl describe pod <pod> -n otp-relay` for the exact missing key.

**Service EXTERNAL-IP stuck at pending**: MetalLB not running, IP pool not configured,
or Klipper servicelb is competing. Run `preflight.sh` to diagnose.

**ARP checks failing**: Verify the network interface name in the ConfigMap matches
the physical interface on the worker node (`ip -br link show` on the worker).
The arping timeout (`-w 3`) must be long enough for two probes and responses.

**Telegram alerts not arriving**: Test the bot token and chat ID manually:
`curl "https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>&text=test"`
