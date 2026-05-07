# Dockerfile — design notes

This document explains every decision in the `Dockerfile`. The goal is that
anyone touching it later understands not just what it does but why, so they
can change it confidently.

---

## Multi-stage build

The `Dockerfile` uses two stages: `builder` and `runtime`.

**Why:** The builder stage installs pip packages, which pulls in compilers,
headers, and other build tools that are not needed at runtime. By copying only
the finished virtualenv into the runtime stage, the final image contains none
of that build tooling. The result is a smaller image and a smaller attack
surface.

```
Stage 1 (builder)   →   installs packages, builds venv
Stage 2 (runtime)   →   copies venv + app, runs uvicorn
```

Only the `runtime` stage becomes the final image. The `builder` stage is
discarded after the build.

---

## Base image: `python:3.12-slim`

We use `python:3.12-slim` rather than `python:3.12-alpine`.

Alpine uses musl libc instead of glibc. Most Python packages work fine on
Alpine, but some have subtle compatibility issues that are hard to diagnose.
For a learning project, predictability matters more than image size. If image
size becomes a concern later, revisiting Alpine is a straightforward change.

`slim` is the official Debian-based minimal image. It is well understood,
widely used, and easy to debug.

---

## Non-root user

The container runs as `otprelay`, a system user with UID 999, no login shell,
and no home directory. The UID is pinned explicitly in the Dockerfile to match
the `runAsUser: 999` constraint in the Kubernetes pod security context.

Running as root inside a container is a security risk. If the application is
compromised, a root container has far more ability to cause damage on the host.
Kubernetes also allows — and some clusters enforce — restrictions on root
containers via `PodSecurityAdmission`.

The user is created in the runtime stage only. The builder stage runs as root
because pip install needs it.

---

## The `data/` directory

```dockerfile
RUN mkdir -p /app/data && chown otprelay:otprelay /app/data
```

The `data/` directory holds `users.xlsx` and `audit.log`. These files must
survive container restarts — they live on a `PersistentVolumeClaim` that
Kubernetes mounts at `/app/data` when the pod starts.

The image creates the directory and sets ownership, but never puts any files
into it. If the volume mount is missing (e.g. during local testing without
Kubernetes), the directory exists and the app starts, but data written there
will not persist across restarts. That is expected and acceptable for local
development.

---

## No nginx in the container

The current systemd deployment runs nginx as a reverse proxy in front of
uvicorn, handling TLS termination. In Kubernetes this responsibility moves to
the **ingress controller** — a cluster-level component that Jathin configures
once and that handles TLS for all services in the cluster.

Putting nginx inside the application pod would duplicate that responsibility
and add operational complexity. The container exposes port 8000 and speaks
plain HTTP. TLS is handled outside the pod.

---

## Why `python -m uvicorn` instead of calling uvicorn directly

This is a non-obvious gotcha in multi-stage Python builds that bit us during
testing. Worth understanding so it never wastes your time again.

When pip installs a package like uvicorn, it creates a small launcher script
in `venv/bin/uvicorn`. That script has a hardcoded shebang line at the top
pointing to the Python interpreter that was used to create the venv:

```
#!/build/venv/bin/python
```

In a single-stage build this is fine. In a multi-stage build, the venv is
created in the `builder` stage at `/build/venv/`, then copied into the
`runtime` stage at `/app/venv/`. The script moves, but the shebang still
points to `/build/venv/bin/python` — a path that does not exist in the
runtime image. The result is a cryptic error:

```
exec /app/venv/bin/uvicorn: no such file or directory
```

The fix is to bypass the script entirely and call uvicorn as a Python module:

```dockerfile
CMD ["/app/venv/bin/python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1"]
```

`python -m uvicorn` tells Python to find and run the uvicorn module directly.
No launcher script involved, no hardcoded path, no problem. This applies to
any tool installed via pip in a multi-stage build — if you hit the same error
with a different package, the same fix applies.

---

## Health check

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD /app/venv/bin/python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"
```

The `HEALTHCHECK` instruction tells Docker (and by extension Kubernetes) how
to determine whether the container is healthy. It polls `/healthz` every
30 seconds. If the app is up and the health endpoint responds, the container is
healthy.

Note that we use `/app/venv/bin/python` here for the same reason as the CMD
above — calling `python3` directly would use the system Python, which does not
have the app's dependencies installed.

The `--start-period=10s` gives uvicorn time to start before health checks
begin. Without it, the container would be marked unhealthy during normal
startup.

Note: Kubernetes also defines its own `livenessProbe` and `readinessProbe` in
the `Deployment` manifest. The `HEALTHCHECK` here is a Docker-level fallback,
useful when running the container locally without Kubernetes.

---

## One worker

The app uses an in-memory `deque` for the claim queue in Phase 1. Multiple
uvicorn workers would each have their own copy of the queue — the same problem
that breaks multi-replica deployments. One worker keeps the in-memory state
consistent within a single pod.

This constraint is resolved in Phase 2 when the queue moves to Redis.

---

## What is not in the image

| Item | Why it is excluded |
|---|---|
| `.env` file | Secrets come from Kubernetes `Secret` and `ConfigMap` objects, not from a file baked into the image |
| `data/users.xlsx` | Lives on the `PersistentVolumeClaim`, not in the image |
| `data/audit.log` | Same as above |
| `venv/` source | Rebuilt cleanly during `docker build` — never copy a local venv into an image |
| `monitor.py` | Separate process, runs in its own pod (`Dockerfile.monitor`) |
| `nginx/` | TLS termination is the ingress controller's job, not the app container's |
| `systemd/` | Irrelevant inside a container — Kubernetes manages the process lifecycle |
| `install.sh`, `update.sh` | Systemd deployment tools, not needed here |
| `test_otp_relay.py` | Could be included, but keeping the runtime image lean is preferred |

---

## Building and running locally

```bash
# Build the image (run from the repo root)
docker build -t otp-relay:latest -f k8s/Dockerfile .

# Run locally for quick testing (no Kubernetes needed)
# Secrets and config passed as environment variables
docker run --rm -p 8000:8000 \
  -e SMS_SECRET_TOKEN=dev-token \
  -e CLAIM_EXPIRY_SEC=90 \
  -e OTP_DISPLAY_SEC=285 \
  -e CONCURRENT_RISK_SEC=30 \
  -e USERS_EXCEL_PATH=data/users.xlsx \
  -e AUDIT_LOG_PATH=data/audit.log \
  otp-relay:latest
```

The app will be reachable at `http://localhost:8000`.

The `users.xlsx` warning on startup is expected when running locally without
a mounted data directory — the app starts fine, it just has no users loaded.
To test with real users, add a volume mount:

```bash
docker run --rm -p 8000:8000 \
  -e SMS_SECRET_TOKEN=dev-token \
  -e CLAIM_EXPIRY_SEC=90 \
  -e OTP_DISPLAY_SEC=285 \
  -e CONCURRENT_RISK_SEC=30 \
  -e USERS_EXCEL_PATH=data/users.xlsx \
  -e AUDIT_LOG_PATH=data/audit.log \
  -v ${PWD}/data:/app/data \
  otp-relay:latest
```

Note: on Windows always use `${PWD}` not `$(pwd)` in Git Bash.

---

## Updating the image

When application code changes:

```bash
docker build -t otp-relay:latest -f k8s/Dockerfile .
```

Docker layer caching means only the layers that changed are rebuilt. Because
the `COPY` of `main.py` comes after the pip install, changing `main.py` does
not trigger a full pip reinstall — only the copy and everything after it
rebuilds. This is intentional and is why the order of instructions in the
`Dockerfile` matters.

If you add a new Python package to `main.py`, add it to the `pip install`
block in the `Dockerfile` and rebuild with `--no-cache` to ensure a clean
install.
