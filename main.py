# OTP Relay Server — main.py
# Stack: FastAPI + Python 3.12 + Exchange SMTP (internal only)
# No external APIs. Runs entirely on your company LAN.

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

CLAIM_EXPIRY_SEC = int(os.getenv("CLAIM_EXPIRY_SEC", "300"))
USERS_EXCEL_PATH = os.getenv("USERS_EXCEL_PATH", "data/users.xlsx")
AUDIT_LOG_PATH   = os.getenv("AUDIT_LOG_PATH", "data/audit.log")

# ── State ─────────────────────────────────────────────────────────────────────
users: dict        = {}
claim_queue: deque = deque()

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
    seen_tokens = {}  # token → first row number, for duplicate detection

    for row_num, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if all(v is None for v in row):
            continue

        row_dict = dict(zip(raw_headers, row))
        token = str(row_dict.get("token", "") or "").strip().upper()
        name  = str(row_dict.get("name",  "") or "").strip()
        email = str(row_dict.get("email", "") or "").strip()

        # ── Validation ────────────────────────────────────────────────────────
        if len(token) == 0:
            audit("import_skipped", detail=f"Row {row_num}: empty token — name={repr(name)} email={repr(email)}", status="warn")
            skipped += 1
            continue

        if not (2 <= len(token) <= 3):
            audit("import_skipped", token=token, detail=f"Row {row_num}: token must be 2 or 3 characters, got {len(token)} ({repr(token)})", status="warn")
            skipped += 1
            continue

        if not re.match(r'^[A-Z0-9]+$', token):
            audit("import_skipped", token=token, detail=f"Row {row_num}: token contains invalid characters ({repr(token)}) — only letters and digits allowed", status="warn")
            skipped += 1
            continue

        if not email:
            audit("import_skipped", token=token, detail=f"Row {row_num}: missing email address for {repr(name)}", status="warn")
            skipped += 1
            continue

        if "@" not in email:
            audit("import_skipped", token=token, detail=f"Row {row_num}: invalid email address {repr(email)}", status="warn")
            skipped += 1
            continue

        if token in seen_tokens:
            audit("import_skipped", token=token, detail=f"Row {row_num}: duplicate token — already defined at row {seen_tokens[token]}", status="warn")
            skipped += 1
            continue

        # ── All good — add user ───────────────────────────────────────────────
        seen_tokens[token] = row_num
        users[token] = {
            "token": token,
            "name":  name,
            "email": email,
        }
        loaded += 1

    logger.info(f"Loaded {loaded} users from {path} ({skipped} rows skipped)")
    if skipped > 0:
        audit("import_complete", detail=f"{loaded} users loaded, {skipped} rows skipped — check import_skipped entries above", status="warn")
    else:
        audit("import_complete", detail=f"{loaded} users loaded, no issues")
    return loaded


# ── Audit log (persistent, one JSON line per event) ───────────────────────────
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


# ── Queue helpers ─────────────────────────────────────────────────────────────
def purge_expired():
    now = datetime.utcnow()
    while claim_queue:
        age = (now - claim_queue[0]["claimed_at"]).total_seconds()
        if age > CLAIM_EXPIRY_SEC:
            expired = claim_queue.popleft()
            audit("claim_expired", expired["token"],
                  f"No OTP arrived within {CLAIM_EXPIRY_SEC}s", "warn")
        else:
            break


def extract_otp(text: str) -> str:
    match = re.search(r'\b\d{4,8}\b', text)
    return match.group() if match else "—"


# ── Email via Exchange SMTP ───────────────────────────────────────────────────
def send_email(to_email: str, name: str, sms_body: str, otp: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Your OTP: {otp}"
    msg["From"]    = f"{FROM_NAME} <{FROM_EMAIL}>"
    msg["To"]      = to_email

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px">
      <div style="background:#0f172a;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px">
        <span style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:2px">One-Time Password</span>
        <div style="font-size:48px;font-weight:800;letter-spacing:14px;color:#38bdf8;margin-top:12px;font-family:monospace">{otp}</div>
      </div>
      <p style="color:#334155;font-size:14px">Hi <strong>{name}</strong>,</p>
      <p style="color:#334155;font-size:14px;margin-top:8px">
        Your OTP has been automatically forwarded from the shared company phone.
      </p>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-top:16px">
        <p style="color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Full SMS text</p>
        <p style="color:#475569;font-size:13px;font-family:monospace">{sms_body}</p>
      </div>
      <p style="color:#94a3b8;font-size:11px;margin-top:24px;text-align:center">
        ⚠️ Never share this OTP with anyone — not even IT.
      </p>
    </div>"""

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


# ── Endpoints ─────────────────────────────────────────────────────────────────

async def background_purge():
    """Runs every 60 seconds to expire stale queue entries on time,
    regardless of whether any requests are coming in."""
    while True:
        await asyncio.sleep(60)
        purge_expired()


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

    # Already queued?
    for i, claim in enumerate(claim_queue):
        if claim["token"] == token:
            audit("claim_duplicate", token, f"Already at position {i+1}", "warn")
            return {"status": "already_queued", "position": i + 1, "expires_in": CLAIM_EXPIRY_SEC}

    purge_expired()

    claim_queue.append({
        "token":      token,
        "name":       users[token]["name"],
        "email":      users[token]["email"],
        "claimed_at": datetime.utcnow(),
    })

    position = len(claim_queue)
    audit("claim_queued", token, f"Queue position {position}")
    return {"status": "queued", "position": position, "name": users[token]["name"], "expires_in": CLAIM_EXPIRY_SEC}


@app.get("/claim-status/{token}")
async def claim_status(token: str):
    token = token.upper()
    for i, claim in enumerate(claim_queue):
        if claim["token"] == token:
            age = (datetime.utcnow() - claim["claimed_at"]).seconds
            return {"status": "waiting", "position": i + 1,
                    "expires_in": max(0, CLAIM_EXPIRY_SEC - age)}
    # Check log for recent delivery or expiry
    for e in read_audit_log(500):
        if e.get("token") == token:
            if e["event"] == "otp_delivered":  return {"status": "delivered"}
            if e["event"] == "claim_expired":   return {"status": "expired"}
            break
    return {"status": "unknown"}


@app.post("/sms-received")
async def sms_received(request: Request):
    if request.headers.get("X-Secret-Token", "") != SMS_SECRET_TOKEN:
        audit("sms_rejected", detail="Wrong secret token", status="error")
        raise HTTPException(status_code=401)

    data     = await request.json()
    sms_body = str(data.get("body", "")).strip()
    audit("sms_received", detail=f"SMS arrived ({len(sms_body)} chars)")

    purge_expired()

    if not claim_queue:
        await asyncio.sleep(4)   # absorb race-condition claims
        purge_expired()
        if not claim_queue:
            audit("sms_unmatched", detail="No claimant — SMS not delivered", status="warn")
            return {"status": "no_claimant"}

    recipient = claim_queue.popleft()
    otp       = extract_otp(sms_body)

    try:
        send_email(recipient["email"], recipient["name"], sms_body, otp)
        audit("otp_delivered", recipient["token"], f"Sent to {recipient['email']}")
        return {"status": "delivered", "recipient": recipient["name"]}
    except Exception as e:
        err = str(e)
        audit("otp_delivery_failed", recipient["token"], f"SMTP error: {err}", status="error")
        # Re-queue so user can retry
        claim_queue.appendleft({**recipient, "claimed_at": datetime.utcnow()})
        return {"status": "smtp_error", "error": err}


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
        "expires_in": max(0, CLAIM_EXPIRY_SEC - (now - c["claimed_at"]).seconds),
    } for c in claim_queue]}


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
    """Sends a test email to the relay account — use after setup to verify Exchange connectivity."""
    try:
        send_email(FROM_EMAIL, "OTP Relay", "Test message — system is working correctly.", "000000")
        return {"status": "ok", "sent_to": FROM_EMAIL}
    except Exception as e:
        return {"status": "error", "error": str(e)}


# Serve frontend — must be last
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
