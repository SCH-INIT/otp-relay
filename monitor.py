# OTP Relay Monitor — monitor.py
# Runs as a separate systemd service (otp-monitor).
# Two parallel tasks:
#   1. Phone watcher  — pings the iPhone on a fixed interval, writes
#                       phone_online / phone_offline events to the audit log
#   2. Alert forwarder — tails the audit log in real time and forwards
#                        entries at or above the configured ALERT_LEVEL
#                        to an IT contact via WhatsApp (CallMeBot API)
#
# All events — including phone_* — flow through the same alert filter,
# so ALERT_LEVEL controls everything uniformly.
#
# Message batching: events that arrive within BATCH_WINDOW_SEC of each
# other are grouped into a single WhatsApp message to avoid flooding.
# The first event in a batch is sent immediately; subsequent events
# that arrive before the window closes are appended to the same message.

import os, time, json, subprocess, threading, logging, urllib.request, urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

AUDIT_LOG_PATH        = os.getenv("AUDIT_LOG_PATH",        "data/audit.log")
WHATSAPP_API_KEY      = os.getenv("WHATSAPP_API_KEY",      "")
WHATSAPP_RECIPIENT    = os.getenv("WHATSAPP_RECIPIENT",     "")
ALERT_LEVEL           = os.getenv("ALERT_LEVEL",           "error").lower()
PHONE_IP              = os.getenv("PHONE_IP",              "")
PHONE_PING_INTERVAL   = int(os.getenv("PHONE_PING_INTERVAL",  "300"))
PHONE_OFFLINE_THRESHOLD = int(os.getenv("PHONE_OFFLINE_THRESHOLD", "2"))
_server_hostname = os.getenv("SERVER_HOSTNAME", "")
_server_ip       = os.getenv("SERVER_IP",       "")
PORTAL_URL       = (
    f"https://{_server_hostname}" if _server_hostname else
    f"https://{_server_ip}"       if _server_ip       else
    "https://srvotp26.init-db.lan"
)
PHONE_INTERFACE       = os.getenv("PHONE_INTERFACE",       "ens33")
BATCH_WINDOW_SEC      = int(os.getenv("BATCH_WINDOW_SEC",  "10"))

LEVEL_ORDER = {"info": 0, "warn": 1, "error": 2}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("otp-monitor")


# ── Audit log writer ──────────────────────────────────────────────────────────

def audit(event: str, detail: str = "", status: str = "info"):
    entry = {
        "ts":     datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "event":  event,
        "token":  "",
        "detail": detail,
        "status": status,
    }
    try:
        Path(AUDIT_LOG_PATH).parent.mkdir(parents=True, exist_ok=True)
        with open(AUDIT_LOG_PATH, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        logger.warning(f"Could not write audit log: {e}")
    level = {"info": logging.INFO, "warn": logging.WARNING,
             "error": logging.ERROR}.get(status, logging.INFO)
    logger.log(level, f"[{event}] {detail}")


# ── WhatsApp via CallMeBot ────────────────────────────────────────────────────

def send_whatsapp(message: str):
    if not WHATSAPP_API_KEY or not WHATSAPP_RECIPIENT:
        logger.warning("WhatsApp not configured — skipping alert")
        return
    try:
        params = urllib.parse.urlencode({
            "phone":   WHATSAPP_RECIPIENT,
            "text":    message,
            "apikey":  WHATSAPP_API_KEY,
        })
        url = f"https://api.callmebot.com/whatsapp.php?{params}"
        with urllib.request.urlopen(url, timeout=15) as r:
            body = r.read().decode()
            logger.info(f"WhatsApp sent — response: {body[:80]}")
    except Exception as e:
        logger.error(f"WhatsApp delivery failed: {e}")


# ── Batching dispatcher ───────────────────────────────────────────────────────
# Collects log entries for BATCH_WINDOW_SEC then sends them as one message.

_batch: list       = []
_batch_lock        = threading.Lock()
_batch_timer       = None


def _flush_batch():
    global _batch, _batch_timer
    with _batch_lock:
        entries  = _batch[:]
        _batch   = []
        _batch_timer = None

    if not entries:
        return

    if len(entries) == 1:
        e = entries[0]
        icon = "🔴" if e["status"] == "error" else "🟡"
        msg = (
            f"{icon} *OTP Relay Alert*\n"
            f"[{e['status']}] {e['event']}"
            + (f" | {e['token']}" if e.get("token") else "")
            + (f"\n{e['detail']}" if e.get("detail") else "")
            + f"\n\n🔗 {PORTAL_URL}/admin/log"
        )
    else:
        lines = []
        for e in entries:
            icon = "🔴" if e["status"] == "error" else "🟡"
            line = f"{icon} [{e['status']}] {e['event']}"
            if e.get("token"):
                line += f" | {e['token']}"
            if e.get("detail"):
                line += f"\n   {e['detail']}"
            lines.append(line)
        msg = (
            f"⚠️ *OTP Relay — {len(entries)} alerts*\n\n"
            + "\n\n".join(lines)
            + f"\n\n🔗 {PORTAL_URL}/admin/log"
        )

    send_whatsapp(msg)


def dispatch(entry: dict):
    """Add entry to batch; start flush timer if not already running."""
    global _batch_timer
    with _batch_lock:
        _batch.append(entry)
        if _batch_timer is None:
            _batch_timer = threading.Timer(BATCH_WINDOW_SEC, _flush_batch)
            _batch_timer.daemon = True
            _batch_timer.start()


def should_alert(status: str) -> bool:
    return LEVEL_ORDER.get(status, 0) >= LEVEL_ORDER.get(ALERT_LEVEL, 2)


# ── Log tailer ────────────────────────────────────────────────────────────────

def tail_audit_log():
    """
    Follows the audit log file from the end, exactly like `tail -f`.
    Forwards any entry whose status meets the alert threshold.
    Handles log file not yet existing gracefully.
    """
    log_path = Path(AUDIT_LOG_PATH)
    logger.info(f"Log tailer started — watching {log_path}")

    # Wait for the log file to appear (main service may not have started yet)
    while not log_path.exists():
        time.sleep(5)

    with open(log_path, "r") as f:
        f.seek(0, 2)  # seek to end — don't replay history on startup
        while True:
            line = f.readline()
            if not line:
                time.sleep(0.5)
                continue
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                status = entry.get("status", "info")
                event  = entry.get("event",  "")
                # Never alert on our own monitor_start event to avoid loops
                if event == "monitor_start":
                    continue
                if should_alert(status):
                    dispatch(entry)
            except json.JSONDecodeError:
                pass


# ── Phone watcher ─────────────────────────────────────────────────────────────

def ping(ip: str) -> bool:
    """Uses arping (layer 2 ARP) instead of ICMP ping.
    iOS responds reliably to ARP even in low-power WiFi sleep state,
    whereas ICMP ping is frequently filtered by iOS power management.
    -w 1 sets a hard 1-second deadline so arping never hangs if the
    interface is temporarily down."""
    try:
        result = subprocess.run(
            ["arping", "-c", "2", "-w", "1", "-I", PHONE_INTERFACE, ip],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return result.returncode == 0
    except Exception as e:
        logger.error(f"arping execution error: {e}")
        return False


def watch_phone():
    if not PHONE_IP:
        logger.warning("PHONE_IP not set — phone watcher disabled")
        return

    logger.info(f"Phone watcher started — target {PHONE_IP}, "
                f"interval {PHONE_PING_INTERVAL}s, "
                f"threshold {PHONE_OFFLINE_THRESHOLD} missed pings")

    # Verify the network interface exists before starting
    if not os.path.exists(f"/sys/class/net/{PHONE_INTERFACE}"):
        logger.critical(f"Network interface {PHONE_INTERFACE} not found — phone watcher disabled")
        audit("monitor_error",
              f"Interface {PHONE_INTERFACE} not found — check PHONE_INTERFACE in .env",
              "error")
        return

    consecutive_failures = 0
    phone_online         = True   # assume online at startup

    # Short delay before the first check — lets the network stack settle
    # after service start and avoids a false offline on boot.
    time.sleep(30)

    while True:
        if ping(PHONE_IP):
            if not phone_online:
                phone_online         = True
                consecutive_failures = 0
                audit("phone_online",
                      f"iPhone {PHONE_IP} is reachable again",
                      "error")
                logger.info(f"Phone {PHONE_IP} back online")
            else:
                consecutive_failures = 0
        else:
            consecutive_failures += 1
            # Only log up to the threshold — no point spamming after offline declared
            if consecutive_failures <= PHONE_OFFLINE_THRESHOLD:
                logger.info(f"ARP failed ({consecutive_failures}/{PHONE_OFFLINE_THRESHOLD})")

            if phone_online and consecutive_failures >= PHONE_OFFLINE_THRESHOLD:
                phone_online = False
                audit("phone_offline",
                      f"iPhone {PHONE_IP} unreachable after "
                      f"{PHONE_OFFLINE_THRESHOLD} consecutive ARP checks",
                      "error")
                logger.error(f"Phone {PHONE_IP} declared offline")

        time.sleep(PHONE_PING_INTERVAL)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("OTP Monitor starting")
    audit("monitor_start",
          f"alert_level={ALERT_LEVEL} phone_ip={PHONE_IP or 'not set'} "
          f"ping_interval={PHONE_PING_INTERVAL}s",
          "info")

    # Phone watcher runs in a daemon thread
    phone_thread = threading.Thread(target=watch_phone, daemon=True)
    phone_thread.start()

    # Log tailer runs in the main thread (blocks forever)
    tail_audit_log()
