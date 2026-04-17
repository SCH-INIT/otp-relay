# ── Stage 1: build ────────────────────────────────────────────────────────────
# Install dependencies in a separate stage so they don't need to be rebuilt
# every time application code changes.
FROM python:3.12-slim AS builder

WORKDIR /build

COPY main.py .
COPY frontend/ ./frontend/

RUN python -m venv /build/venv && \
    /build/venv/bin/pip install --no-cache-dir \
        fastapi \
        uvicorn \
        openpyxl \
        python-dotenv

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Create a non-root user — the container should not run as root
RUN useradd --system --no-create-home --shell /usr/sbin/nologin otprelay

WORKDIR /app

# Copy venv and application files from the builder stage
COPY --from=builder /build/venv ./venv
COPY --from=builder /build/main.py .
COPY --from=builder /build/frontend ./frontend

# Create the data directory — the PersistentVolumeClaim mounts here.
# The directory must exist in the image; the actual files live on the volume.
RUN mkdir -p /app/data && chown otprelay:otprelay /app/data

USER otprelay

EXPOSE 8000

# Use python -m uvicorn instead of the venv script directly.
# The uvicorn script in venv/bin/ has a hardcoded shebang pointing to the
# builder stage path (/build/venv/bin/python) which does not exist at runtime.
# Calling via python -m uvicorn bypasses the script entirely.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD /app/venv/bin/python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/admin/queue')"

CMD ["/app/venv/bin/python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1"]
