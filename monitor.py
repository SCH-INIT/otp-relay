# OTP Relay Monitor — monitor.py
# Runs as a separate monitor process/container.
# Two parallel tasks:
#   1. Phone watcher  — uses ARP checks for iPhone presence and writes
#                       phone_online / phone_offline events to the audit log
#   2. Alert forwarder — tails the audit log in real time and forwards
#                        entries at or above ALERT_LEVEL to Telegram
#                        via Bot API.
#
# All events — including phone_* — flow through the same alert filter,
# so ALERT_LEVEL controls everything uniformly.
#
# Message batching: events that arrive within BATCH_WINDOW_SEC are grouped
# into one Telegram message to avoid flooding.

import json
import logging
import os
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from prometheus_client import Counter, Gauge, Histogram, start_http_server

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _resolve_runtime_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else BASE_DIR / path


# ── Config ────────────────────────────────────────────────────────────────────
DATA_DIR = _resolve_runtime_path(os.getenv("OTP_RELAY_DATA_DIR", "data"))
AUDIT_LOG_PATH = str(
    _resolve_runtime_path(
        os.getenv("AUDIT_LOG_PATH", str(DATA_DIR / "audit.log"))
    )
)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
ALERT_LEVEL = os.getenv("ALERT_LEVEL", "error").lower()
PHONE_IP = os.getenv("PHONE_IP", "")
PHONE_INTERFACE = os.getenv("PHONE_INTERFACE", "ens33")
PHONE_PING_INTERVAL = int(os.getenv("PHONE_PING_INTERVAL", "300"))
PHONE_OFFLINE_THRESHOLD = int(os.getenv("PHONE_OFFLINE_THRESHOLD", "2"))
BATCH_WINDOW_SEC = int(os.getenv("BATCH_WINDOW_SEC", "10"))
METRICS_PORT = int(os.getenv("MONITOR_METRICS_PORT", "9101"))

# Prefer an explicit URL for Kubernetes, where Service/Ingress naming may differ.
_explicit_portal_url = os.getenv("PORTAL_URL", "").strip()
_server_hostname = os.getenv("SERVER_HOSTNAME", "").strip()
_server_ip = os.getenv("SERVER_IP", "").strip()
PORTAL_URL = (
    _explicit_portal_url or
    (f"https://{_server_hostname}" if _server_hostname else "") or
    (f"https://{_server_ip}" if _server_ip else "") or
    "https://srvotp26.init-db.lan"
)

LEVEL_ORDER = {"info": 0, "warn": 1, "error": 2}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("otp-monitor")


# ── Prometheus metrics ────────────────────────────────────────────────────────
# Five metrics describing the iPhone-watching role of this process.
# All use the otp_ prefix per docs/dev/naming-conventions.md.

otp_iphone_present = Gauge(
    "otp_iphone_present",
    "Whether the iPhone is currently reachable (1) or absent (0).",
)
otp_iphone_absence_seconds = Gauge(
    "otp_iphone_absence_seconds",
    "Seconds since the iPhone went absent. 0 while present.",
)
otp_iphone_absence_events_total = Counter(
    "otp_iphone_absence_events_total",
    "Total number of present-to-absent transitions.",
)
otp_iphone_absence_duration_seconds = Histogram(
    "otp_iphone_absence_duration_seconds",
    "Distribution of absence durations, observed when the iPhone returns.",
    buckets=(30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, float("inf")),
)
otp_monitor_arp_last_success_timestamp_seconds = Gauge(
    "otp_monitor_arp_last_success_timestamp_seconds",
    "Unix timestamp of the last successful ARP probe.",
)

# Initial state: assume present until proven otherwise. Updated by watch_phone().
otp_iphone_present.set(1)
otp_iphone_absence_seconds.set(0)


# Internal state to drive otp_iphone_absence_seconds at scrape time.
# Set when the iPhone transitions present -> absent; cleared on return.
_absence_started_at: Optional[float] = None


def _current_absence_seconds() -> float:
    if _absence_started_at is None:
        return 0.0
    return max(0.0, time.time() - _absence_started_at)


otp_iphone_absence_seconds.set_function(_current_absence_seconds)


# ── Audit log writer ──────────────────────────────────────────────────────────
def audit(event: str, detail: str = "", status: str = "info"):
    entry = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "event": event,
        "token": "",
        "detail": detail,
        "status": status,
    }
    try:
        Path(AUDIT_LOG_PATH).parent.mkdir(parents=True, exist_ok=True)
        with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        logger.warning(f"Could not write audit log: {e}")

    level = {"info": logging.INFO, "warn": logging.WARNING, "error": logging.ERROR}.get(status, logging.INFO)
    logger.log(level, f"[{event}] {detail}")


# ── Telegram Bot API ──────────────────────────────────────────────────────────
def send_telegram(message: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning("Telegram not configured — skipping alert")
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = urllib.parse.urlencode({
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
        }).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        with urllib.request.urlopen(req, timeout=15) as response:
            body = response.read().decode(errors="replace")
            logger.info(f"Telegram sent — response: {body[:80]}")
    except Exception as e:
        logger.error(f"Telegram delivery failed: {e}")


# ── Batching dispatcher ───────────────────────────────────────────────────────
_batch = []
_batch_lock = threading.Lock()
_batch_timer = None


def _flush_batch():
    global _batch, _batch_timer
    with _batch_lock:
        entries = _batch[:]
        _batch = []
        _batch_timer = None

    if not entries:
        return

    if len(entries) == 1:
        e = entries[0]
        icon = "🔴" if e.get("status") == "error" else "🟡"
        msg = (
            f"{icon} OTP Relay Alert\n"
            f"[{e.get('status', 'info')}] {e.get('event', '')}"
            + (f" | {e.get('token')}" if e.get("token") else "")
            + (f"\n{e.get('detail')}" if e.get("detail") else "")
            + f"\n\n🔗 {PORTAL_URL}/admin/log"
        )
    else:
        lines = []
        for e in entries:
            icon = "🔴" if e.get("status") == "error" else "🟡"
            line = f"{icon} [{e.get('status', 'info')}] {e.get('event', '')}"
            if e.get("token"):
                line += f" | {e.get('token')}"
            if e.get("detail"):
                line += f"\n   {e.get('detail')}"
            lines.append(line)
        msg = (
            f"⚠️ OTP Relay — {len(entries)} alerts\n\n"
            + "\n\n".join(lines)
            + f"\n\n🔗 {PORTAL_URL}/admin/log"
        )

    send_telegram(msg)


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
    Follows the audit log file from the end, like `tail -f`.
    Forwards any entry whose status meets the alert threshold.
    Handles the log file not existing yet.
    """
    log_path = Path(AUDIT_LOG_PATH)
    logger.info(f"Log tailer started — watching {log_path}")

    while not log_path.exists():
        time.sleep(5)

    with open(log_path, "r", encoding="utf-8") as f:
        f.seek(0, 2)
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
                event = entry.get("event", "")
                # Never alert on our own monitor_start event to avoid loops.
                if event == "monitor_start":
                    continue
                if should_alert(status):
                    dispatch(entry)
            except json.JSONDecodeError:
                continue


# ── Phone watcher ─────────────────────────────────────────────────────────────
def ping(ip: str) -> bool:
    """Use ARP instead of ICMP ping for iPhone presence detection."""
    try:
        result = subprocess.run(
            ["arping", "-c", "2", "-w", "3", "-I", PHONE_INTERFACE, ip],
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

    logger.info(
        f"Phone watcher started — target {PHONE_IP}, "
        f"interface {PHONE_INTERFACE}, "
        f"interval {PHONE_PING_INTERVAL}s, "
        f"threshold {PHONE_OFFLINE_THRESHOLD} missed pings"
    )

    if not os.path.exists(f"/sys/class/net/{PHONE_INTERFACE}"):
        logger.critical(f"Network interface {PHONE_INTERFACE} not found — phone watcher disabled")
        audit(
            "monitor_error",
            f"Interface {PHONE_INTERFACE} not found — check PHONE_INTERFACE / hostNetwork settings",
            "error",
        )
        return

    consecutive_failures = 0
    phone_online = True

    # Short delay before first check to let networking settle after start.
    time.sleep(30)

    while True:
        if ping(PHONE_IP):
            otp_monitor_arp_last_success_timestamp_seconds.set(time.time())
            if not phone_online:
                # Present-after-absent transition: record the absence duration
                # and reset absence state.
                global _absence_started_at
                if _absence_started_at is not None:
                    duration = max(0.0, time.time() - _absence_started_at)
                    otp_iphone_absence_duration_seconds.observe(duration)
                _absence_started_at = None
                otp_iphone_present.set(1)

                phone_online = True
                consecutive_failures = 0
                audit("phone_online", f"iPhone {PHONE_IP} is reachable again", "error")
                logger.info(f"Phone {PHONE_IP} back online")
            else:
                consecutive_failures = 0
        else:
            consecutive_failures += 1
            if consecutive_failures <= PHONE_OFFLINE_THRESHOLD:
                logger.info(f"ARP failed ({consecutive_failures}/{PHONE_OFFLINE_THRESHOLD})")

            if phone_online and consecutive_failures >= PHONE_OFFLINE_THRESHOLD:
                # Online-to-absent transition: count the event and start the
                # absence timer. The gauge updates on demand via set_function.
                _absence_started_at = time.time()
                otp_iphone_absence_events_total.inc()
                otp_iphone_present.set(0)

                phone_online = False
                audit(
                    "phone_offline",
                    f"iPhone {PHONE_IP} unreachable after {PHONE_OFFLINE_THRESHOLD} consecutive ARP checks",
                    "error",
                )
                logger.error(f"Phone {PHONE_IP} declared offline")

        time.sleep(PHONE_PING_INTERVAL)


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logger.info("OTP Monitor starting")
    audit(
        "monitor_start",
        f"alert_level={ALERT_LEVEL} phone_ip={PHONE_IP or 'not set'} "
        f"interface={PHONE_INTERFACE} ping_interval={PHONE_PING_INTERVAL}s",
        "info",
    )

    # Start the Prometheus metrics endpoint on its own port.
    # Binds 0.0.0.0:9101; on the monitor pod (hostNetwork: true) this means
    # the node's LAN-facing interface. Accepted exposure — metrics carry no
    # secrets and the cluster is on the company LAN.
    start_http_server(METRICS_PORT)
    logger.info(f"Prometheus metrics on :{METRICS_PORT}/metrics")

    phone_thread = threading.Thread(target=watch_phone, daemon=True)
    phone_thread.start()

    tail_audit_log()
