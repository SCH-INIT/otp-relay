# OTP Relay Monitor — monitor.py
# Runs as a separate monitor process/container.
# Two parallel tasks:
#   1. Phone watcher  — uses ARP checks for iPhone presence and writes
#                       phone_online / phone_offline events to the audit log.
#                       Also exposes Prometheus metrics on port 9101.
#   2. Alert forwarder — tails the audit log and posts Telegram messages
#                        for iPhone state changes (phone_online/phone_offline).
#                        All other audit events are ignored here; they are
#                        the responsibility of Alertmanager, which sees the
#                        metric-driven view of the system.
#
# Telegram message grammar follows docs/dev/observability-design.md:
#   <subject><severity> <short text>
# This module emits 📱🔥 and 📱👍 only.

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
PHONE_IP = os.getenv("PHONE_IP", "")
PHONE_INTERFACE = os.getenv("PHONE_INTERFACE", "ens33")
PHONE_PING_INTERVAL = int(os.getenv("PHONE_PING_INTERVAL", "300"))
PHONE_OFFLINE_THRESHOLD = int(os.getenv("PHONE_OFFLINE_THRESHOLD", "2"))
METRICS_PORT = int(os.getenv("MONITOR_METRICS_PORT", "9101"))

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


# ── Grammar-based alert formatting ───────────────────────────────────────────
# Messages follow the design in docs/dev/observability-design.md:
#   <subject><severity> <short text>
# Subjects: 📱 iPhone, 🚪 portal, 👁️ monitor, 🖥️ node, 💾 storage, 🎛️ cluster.
# Severities: 🔥 critical, 👍 recovery, ⚠️ warning, ℹ️ info.
#
# This monitor process only sends iPhone state changes. Every other alert
# class (pod down, node down, claim spikes, cert expiring, etc.) is the
# responsibility of Alertmanager, which has the metrics to do it properly.
# Single audit events that are not iPhone-related fall through silently.


def _format_duration(seconds: float) -> str:
    """Compact human duration: '47s', '8m', '2h 14m'."""
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    hours, rest = divmod(seconds, 3600)
    minutes = rest // 60
    return f"{hours}h {minutes}m" if minutes else f"{hours}h"


# Tracks when phone_offline fired, so phone_online can quote the duration.
_phone_offline_at: Optional[float] = None


def _format_alert(entry: dict) -> Optional[str]:
    """
    Map an audit entry to a Telegram message in the grammar.
    Returns None if this event is not a monitor-side alert.
    """
    global _phone_offline_at
    event = entry.get("event", "")

    if event == "phone_offline":
        _phone_offline_at = time.time()
        return "📱🔥 iPhone offline. Last seen just now."

    if event == "phone_online":
        if _phone_offline_at is not None:
            dur = _format_duration(time.time() - _phone_offline_at)
            _phone_offline_at = None
            return f"📱👍 iPhone back. Was offline {dur}."
        # We never saw the offline event (monitor restarted while offline).
        return "📱👍 iPhone back."

    # Anything else: not the monitor's job. Alertmanager will handle it.
    return None


def dispatch(entry: dict):
    """Format the entry per the grammar; send if a message was produced."""
    msg = _format_alert(entry)
    if msg:
        send_telegram(msg)


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
                event = entry.get("event", "")
                # Never alert on our own monitor_start event to avoid loops.
                if event == "monitor_start":
                    continue
                # dispatch() decides whether the event warrants a Telegram
                # message; non-iPhone events are silently dropped here and
                # handled by Alertmanager downstream.
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
        f"phone_ip={PHONE_IP or 'not set'} "
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
