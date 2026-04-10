# Building and exporting the OTP Relay image

This is your side of the deployment workflow. You build the container image on
your Windows laptop and hand it to Jathin as a file. No registry, no dev tools
on the server.

---

## What you need on your laptop

- **Docker Desktop for Windows** — download from https://www.docker.com/products/docker-desktop
- **Git Bash** — you already have this
- The repo checked out on the `k8s` branch

Install Docker Desktop, start it, and make sure it is running (whale icon in
the system tray). You do not need to log in to Docker Hub.

---

## The workflow every time you update the app

### Step 1 — make sure you are on the k8s branch and up to date

```bash
git checkout k8s
git pull origin k8s
```

### Step 2 — build the image

Run this from the repo root (the folder that contains `Dockerfile` and `main.py`):

```bash
docker build -t otp-relay:latest -f k8s/Dockerfile .
```

The first build takes a few minutes — Docker is downloading the base image and
installing Python packages. Subsequent builds are much faster because Docker
caches the layers that have not changed.

You will see output like:
```
[+] Building 42.3s (12/12) FINISHED
```

If it says `FINISHED`, the image is built. If it fails, paste the error here
and we will fix it.

### Step 3 — verify the image exists

```bash
docker images otp-relay
```

You should see something like:
```
REPOSITORY    TAG       IMAGE ID       CREATED         SIZE
otp-relay     latest    a1b2c3d4e5f6   2 minutes ago   210MB
```

### Step 4 — export the image to a file

```bash
docker save otp-relay:latest -o otp-relay-latest.tar
```

This creates a file called `otp-relay-latest.tar` in your current folder.
It will be around 200MB. This is the file you hand to Jathin.

### Step 5 — copy the file to the K3s node

```bash
scp otp-relay-latest.tar jathin@srvk3s01.init-db.lan:/tmp/
```

Replace `jathin` with whatever username Jathin uses on the server. The file
lands in `/tmp/` on the server — Jathin imports it from there.

Tell Jathin the file is ready. He takes it from here.

---

## Quick reference — the four commands

```bash
docker build -t otp-relay:latest -f k8s/Dockerfile .
docker images otp-relay
docker save otp-relay:latest -o otp-relay-latest.tar
scp otp-relay-latest.tar jathin@srvk3s01.init-db.lan:/tmp/
```

---

## When only main.py or frontend changed

Docker layer caching means only the changed layers rebuild. The pip install
step is cached and skipped. A code-only rebuild typically takes under 10
seconds.

## When you add a new Python package to the app

The pip install layer is invalidated and rebuilds from scratch. This is normal
and expected. It takes the same time as the first build.

---

## Troubleshooting

**Docker Desktop is not running**
The `docker` command will fail with "Cannot connect to the Docker daemon".
Start Docker Desktop from the Start menu and wait for the whale icon to stop
animating before retrying.

**`scp` asks for a password every time**
Set up SSH key authentication to the server. Ask Jathin to add your public key
to his `~/.ssh/authorized_keys`.

**The image is missing after a Docker Desktop restart**
Docker Desktop on Windows stores images on disk — they survive restarts. If an
image is missing, just rebuild it with Step 2.
