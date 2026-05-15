# ── Stage 1: frontend build ───────────────────────────────────────────────────
# Transpile JSX to JS and minify. Node is only needed at build time.
FROM node:20-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./frontend/
RUN npx babel frontend/app.jsx --presets @babel/preset-react --out-file frontend/app.js && \
    rm frontend/app.jsx
# ── Stage 2: Python build ────────────────────────────────────────────────────
# Install Python dependencies and build help docs.
FROM python:3.12-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN python -m venv /build/venv && \
    /build/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY main.py .
COPY --from=frontend /build/frontend/ ./frontend/
COPY docs/help/ ./docs/help/
COPY scripts/build_help_docs.py ./scripts/build_help_docs.py
# Build help docs: converts docs/help/*.md into frontend/help/wizard-guide.json
# and frontend/help/rendered/*.html.
RUN /build/venv/bin/python scripts/build_help_docs.py
# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime
# Create a non-root user — the container should not run as root
RUN useradd --system --uid 999 --no-create-home --shell /usr/sbin/nologin otprelay
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
    CMD /app/venv/bin/python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')"
CMD ["/app/venv/bin/python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1"]
