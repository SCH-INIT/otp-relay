# OTP Relay Server — main.py
# Stack: FastAPI + Python 3.12 + Exchange SMTP (internal only)
# No external APIs. Runs entirely on your company LAN.
#
# Delivery model: OTP is displayed on-screen via polling. Email is NOT used
# for OTP delivery. SMTP config and /admin/smtp-test are retained for
# diagnostics only.

import os, re, asyncio, logging, smtplib, json
from collections import deque
from datetime import datetime
from typing import Optional
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import openpyxl
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="OTP Relay")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # safe — server is LAN-only
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Config ────────────────────────────────────────────────────────────────────
SMS_SECRET_TOKEN = os.getenv("SMS_SECRET_TOKEN", "changeme")

SMTP_HOST        = os.getenv("SMTP_HOST", "mail.company.local")
SMTP_PORT        = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER        = os.getenv("SMTP_USER", "otp-relay@company.com")
SMTP_PASSWORD    = os.getenv("SMTP_PASSWORD", "")
SMTP_USE_TLS     = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
SMTP_AUTH        = os.getenv("SMTP_AUTH", "true").lower() == "true"
FROM_EMAIL       = os.getenv("FROM_EMAIL", SMTP_USER)
FROM_NAME        = os.getenv("FROM_NAME", "OTP Relay")

# How long the active user has to trigger their OTP before being evicted.
# Other users wait until this window expires or OTP is delivered.
CLAIM_EXPIRY_SEC  = int(os.getenv("CLAIM_EXPIRY_SEC", "90"))

# How long the delivered OTP stays visible on-screen before being purged.
OTP_DISPLAY_SEC   = int(os.getenv("OTP_DISPLAY_SEC", "285"))   # 4 min 45 sec

# If two claims arrive within this window, log a concurrent_risk event.
CONCURRENT_RISK_SEC = int(os.getenv("CONCURRENT_RISK_SEC", "30"))

USERS_EXCEL_PATH = os.getenv("USERS_EXCEL_PATH", "data/users.xlsx")
AUDIT_LOG_PATH   = os.getenv("AUDIT_LOG_PATH", "data/audit.log")

# ── State ─────────────────────────────────────────────────────────────────────
# Queue: max depth 1 enforced at claim time. Others wait and poll.
users: dict        = {}
claim_queue: deque = deque()

# Delivered OTPs held in memory only — never written to disk or logs.
# Structure: { token: { "otp": str, "arrived_at": datetime } }
pending_otps: dict = {}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("otp-relay")


# ── User loading ──────────────────────────────────────────────────────────────
def load_users_from_excel(path: str) -> int:
    """
    Reads users.xlsx. Expected columns (row 1 = headers):
      token  — 2 or 3 character unique string, e.g. AH or AHM
      name   — display name
      email  — company email address
    Column names are case-insensitive.
    Skipped rows are written to the audit log so IT can fix them.
    """
    wb = openpyxl.load_workbook(path)
    ws = wb.active
    raw_headers = [
        str(c.value).strip().lower() if c.value else ""
        for c in next(ws.iter_rows(min_row=1, max_row=1))
    ]

    loaded   = 0
    skipped  = 0
    seen_tokens = {}

    for row_num, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if all(v is None for v in row):
            continue

        row_dict = dict(zip(raw_headers, row))
        token = str(row_dict.get("token", "") or "").strip().upper()
        name  = str(row_dict.get("name",  "") or "").strip()
        email = str(row_dict.get("email", "") or "").strip()

        if len(token) == 0:
            audit("import_skipped", detail=f"Row {row_num}: empty token — name={repr(name)} email={repr(email)}", status="warn")
            skipped += 1; continue

        if not (2 <= len(token) <= 3):
            audit("import_skipped", token=token, detail=f"Row {row_num}: token must be 2 or 3 characters, got {len(token)} ({repr(token)})", status="warn")
            skipped += 1; continue

        if not re.match(r'^[A-Z0-9]+$', token):
            audit("import_skipped", token=token, detail=f"Row {row_num}: token contains invalid characters ({repr(token)}) — only letters and digits allowed", status="warn")
            skipped += 1; continue

        if not email:
            audit("import_skipped", token=token, detail=f"Row {row_num}: missing email address for {repr(name)}", status="warn")
            skipped += 1; continue

        if "@" not in email:
            audit("import_skipped", token=token, detail=f"Row {row_num}: invalid email address {repr(email)}", status="warn")
            skipped += 1; continue

        if token in seen_tokens:
            audit("import_skipped", token=token, detail=f"Row {row_num}: duplicate token — already defined at row {seen_tokens[token]}", status="warn")
            skipped += 1; continue

        seen_tokens[token] = row_num
        users[token] = {"token": token, "name": name, "email": email}
        loaded += 1

    logger.info(f"Loaded {loaded} users from {path} ({skipped} rows skipped)")
    if skipped > 0:
        audit("import_complete", detail=f"{loaded} users loaded, {skipped} rows skipped — check import_skipped entries above", status="warn")
    else:
        audit("import_complete", detail=f"{loaded} users loaded, no issues")
    return loaded


# ── Audit log ─────────────────────────────────────────────────────────────────
def audit(event: str, token: Optional[str] = None, detail: str = "", status: str = "info"):
    entry = {
        "ts":     datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "event":  event,
        "token":  token or "",
        "detail": detail,
        "status": status,
    }
    try:
        Path(AUDIT_LOG_PATH).parent.mkdir(parents=True, exist_ok=True)
        with open(AUDIT_LOG_PATH, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        logger.warning(f"Could not write audit log: {e}")
    level = {"info": logging.INFO, "warn": logging.WARNING, "error": logging.ERROR}.get(status, logging.INFO)
    logger.log(level, f"[{event}] token={token or '—'}  {detail}")


def read_audit_log(limit: int = 200) -> list:
    try:
        lines = Path(AUDIT_LOG_PATH).read_text().strip().splitlines()
        entries = [json.loads(l) for l in lines if l.strip()]
        return list(reversed(entries))[:limit]
    except FileNotFoundError:
        return []
    except Exception as e:
        logger.warning(f"Could not read audit log: {e}")
        return []


# ── Queue and OTP state helpers ───────────────────────────────────────────────
def purge_expired():
    """Evict the front-of-queue claim if it has exceeded CLAIM_EXPIRY_SEC."""
    now = datetime.utcnow()
    while claim_queue:
        age = (now - claim_queue[0]["claimed_at"]).total_seconds()
        if age > CLAIM_EXPIRY_SEC:
            expired = claim_queue.popleft()
            audit("claim_expired", expired["token"],
                  f"No OTP arrived within {CLAIM_EXPIRY_SEC}s — evicted from slot 1", "warn")
        else:
            break


def purge_stale_otps():
    """Remove delivered OTPs that have exceeded OTP_DISPLAY_SEC."""
    now = datetime.utcnow()
    stale = [
        tok for tok, v in pending_otps.items()
        if (now - v["arrived_at"]).total_seconds() > OTP_DISPLAY_SEC
    ]
    for tok in stale:
        del pending_otps[tok]
        audit("otp_display_expired", tok, f"OTP display window closed after {OTP_DISPLAY_SEC}s")


def extract_otp(text: str) -> str:
    match = re.search(r'\b\d{4,8}\b', text)
    return match.group() if match else "—"


# ── Email (diagnostics only — not used for OTP delivery) ─────────────────────
def send_email(to_email: str, name: str, subject: str, html: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"{FROM_NAME} <{FROM_EMAIL}>"
    msg["To"]      = to_email
    msg.attach(MIMEText(html, "html"))

    if SMTP_USE_TLS:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.ehlo()
        server.starttls()
    else:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)

    if SMTP_AUTH:
        server.login(SMTP_USER, SMTP_PASSWORD)

    server.sendmail(FROM_EMAIL, to_email, msg.as_string())
    server.quit()


# ── Background task ───────────────────────────────────────────────────────────
async def background_purge():
    """Runs every 15 seconds to expire stale queue entries and OTP display windows."""
    while True:
        await asyncio.sleep(15)
        purge_expired()
        purge_stale_otps()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    if os.path.exists(USERS_EXCEL_PATH):
        count = load_users_from_excel(USERS_EXCEL_PATH)
        audit("server_start", detail=f"{count} users loaded")
    else:
        logger.warning(f"users.xlsx not found at {USERS_EXCEL_PATH}")
        audit("server_start", detail="No users.xlsx — POST /admin/reload-users after adding it", status="warn")
    asyncio.create_task(background_purge())


@app.post("/claim-otp")
async def claim_otp(request: Request):
    data  = await request.json()
    token = str(data.get("token", "")).strip().upper()

    if token not in users:
        audit("claim_rejected", token, "Unknown token", "error")
        raise HTTPException(status_code=404, detail="Token not recognised. Check with your IT department.")

    purge_expired()
    purge_stale_otps()

    # Already queued — return current status without re-queuing
    for i, claim in enumerate(claim_queue):
        if claim["token"] == token:
            age = (datetime.utcnow() - claim["claimed_at"]).total_seconds()
            remaining = max(0, int(CLAIM_EXPIRY_SEC - age))
            audit("claim_duplicate", token, f"Already at position {i+1}", "warn")
            return {
                "status":     "already_queued",
                "position":   i + 1,
                "expires_in": remaining,
                "queue_depth": len(claim_queue),
            }

    # Already has a delivered OTP waiting on-screen
    if token in pending_otps:
        age = (datetime.utcnow() - pending_otps[token]["arrived_at"]).total_seconds()
        remaining = max(0, int(OTP_DISPLAY_SEC - age))
        return {"status": "otp_ready", "expires_in": remaining}

    # Queue depth = 1 enforced: only one active user at a time.
    # Others are allowed to join the queue and wait — they are NOT allowed to
    # trigger their OTP on the platform until they reach position 1.
    now = datetime.utcnow()

    # Concurrent risk detection: warn if a second claim arrives close behind
    # the current front-of-queue (they could race to trigger OTPs).
    if claim_queue:
        front_age = (now - claim_queue[0]["claimed_at"]).total_seconds()
        if front_age < CONCURRENT_RISK_SEC:
            audit("concurrent_risk", token,
                  f"New claim while {claim_queue[0]['token']} has been active for only {int(front_age)}s",
                  "warn")

    claim_queue.append({
        "token":      token,
        "name":       users[token]["name"],
        "email":      users[token]["email"],
        "claimed_at": now,
    })

    position   = len(claim_queue)
    queue_depth = len(claim_queue)

    # Worst-case wait: each person ahead of them gets the full CLAIM_EXPIRY_SEC.
    # Position 1 = active now, position 2 = up to 1×90s, etc.
    wait_estimate = max(0, (position - 1) * CLAIM_EXPIRY_SEC)

    audit("claim_queued", token, f"Queue position {position} of {queue_depth}")
    return {
        "status":        "queued",
        "position":      position,
        "name":          users[token]["name"],
        "expires_in":    CLAIM_EXPIRY_SEC,
        "queue_depth":   queue_depth,
        "wait_estimate": wait_estimate,   # seconds, worst case
    }


@app.get("/claim-status/{token}")
async def claim_status(token: str):
    token = token.upper()

    purge_expired()
    purge_stale_otps()

    # OTP is ready and waiting on-screen
    if token in pending_otps:
        age = (datetime.utcnow() - pending_otps[token]["arrived_at"]).total_seconds()
        remaining = max(0, int(OTP_DISPLAY_SEC - age))
        return {
            "status":     "delivered",
            "otp":        pending_otps[token]["otp"],
            "expires_in": remaining,
        }

    # Still in the claim queue
    for i, claim in enumerate(claim_queue):
        if claim["token"] == token:
            age       = (datetime.utcnow() - claim["claimed_at"]).total_seconds()
            remaining = max(0, int(CLAIM_EXPIRY_SEC - age))
            # Worst-case wait for users behind position 1
            wait_estimate = max(0, i * CLAIM_EXPIRY_SEC)
            return {
                "status":        "waiting",
                "position":      i + 1,
                "expires_in":    remaining,
                "queue_depth":   len(claim_queue),
                "wait_estimate": wait_estimate,
            }

    # Not in queue, not delivered — check log for recent terminal events
    for e in read_audit_log(500):
        if e.get("token") == token:
            if e["event"] in ("otp_delivered", "otp_display_expired"):
                return {"status": "done"}
            if e["event"] == "claim_expired":
                return {"status": "idle_expired"}
            break

    return {"status": "unknown"}


@app.delete("/claim-otp/{token}")
async def cancel_claim(token: str):
    """
    Discard a delivered OTP and re-queue the user (Retry / Send again flow).
    Also used when user explicitly abandons their slot.
    """
    token = token.upper()

    if token in pending_otps:
        del pending_otps[token]
        audit("otp_discarded", token, "User requested retry — OTP discarded from memory")

    # Remove from queue if present (e.g. user changed their mind while waiting)
    global claim_queue
    before = len(claim_queue)
    claim_queue = deque(c for c in claim_queue if c["token"] != token)
    if len(claim_queue) < before:
        audit("claim_cancelled", token, "Removed from queue by user")

    return {"status": "ok"}


@app.post("/sms-received")
async def sms_received(request: Request):
    if request.headers.get("X-Secret-Token", "") != SMS_SECRET_TOKEN:
        audit("sms_rejected", detail="Wrong secret token", status="error")
        raise HTTPException(status_code=401)

    data     = await request.json()
    sms_body = str(data.get("body", "")).strip()
    audit("sms_received", detail=f"SMS arrived ({len(sms_body)} chars)")

    purge_expired()
    purge_stale_otps()

    if not claim_queue:
        # Brief wait to absorb a race-condition claim that's in-flight
        await asyncio.sleep(4)
        purge_expired()
        if not claim_queue:
            audit("sms_unmatched", detail="No claimant in queue — SMS discarded", status="warn")
            return {"status": "no_claimant"}

    recipient = claim_queue.popleft()
    otp       = extract_otp(sms_body)

    # Store OTP in memory only — never logged, never written to disk.
    pending_otps[recipient["token"]] = {
        "otp":        otp,
        "arrived_at": datetime.utcnow(),
    }

    # Audit record: token and timestamp only, OTP value deliberately omitted.
    audit("otp_delivered", recipient["token"],
          f"OTP ready for display — queue unblocked")

    return {"status": "delivered", "recipient": recipient["name"]}


@app.get("/admin/log")
async def get_log(limit: int = 200):
    entries = read_audit_log(limit)
    return {"entries": entries, "total": len(entries)}


@app.get("/admin/queue")
async def get_queue():
    now = datetime.utcnow()
    return {"queue": [{
        "token":      c["token"],
        "name":       c["name"],
        "email":      c["email"],
        "claimed_at": c["claimed_at"].strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_in": max(0, int(CLAIM_EXPIRY_SEC - (now - c["claimed_at"]).total_seconds())),
        "position":   i + 1,
    } for i, c in enumerate(claim_queue)]}


@app.get("/admin/users")
async def list_users():
    return {"count": len(users),
            "users": [{"token": u["token"], "name": u["name"], "email": u["email"]}
                      for u in users.values()]}


@app.post("/admin/reload-users")
async def reload_users():
    if not os.path.exists(USERS_EXCEL_PATH):
        raise HTTPException(status_code=404, detail=f"Not found: {USERS_EXCEL_PATH}")
    users.clear()
    count = load_users_from_excel(USERS_EXCEL_PATH)
    audit("users_reloaded", detail=f"{count} users loaded")
    return {"status": "ok", "users_loaded": count}


@app.get("/admin/smtp-test")
async def smtp_test():
    """Sends a test email to the relay account — use to verify Exchange connectivity."""
    html = """<div style="font-family:Arial,sans-serif;padding:24px">
      <p>OTP Relay SMTP test — if you can read this, Exchange is working. 🎉</p>
    </div>"""
    try:
        send_email(FROM_EMAIL, "OTP Relay", "OTP Relay — SMTP connectivity test", html)
        return {"status": "ok", "sent_to": FROM_EMAIL}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# Serve frontend — must be last
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
