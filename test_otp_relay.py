#!/usr/bin/env python3
"""
test_otp_relay.py — End-to-end test for the OTP Relay server.
Run on the Ubuntu server or any machine on the same LAN.

Usage:
    python3 /opt/otp-relay/test_otp_relay.py
    python3 /opt/otp-relay/test_otp_relay.py --host srvotp26.init-db.lan --port 8000
"""

import argparse, json, time, getpass, urllib.request, urllib.error

RESET="\033[0m"; BOLD="\033[1m"; GREEN="\033[92m"; YELLOW="\033[93m"
RED="\033[91m";  CYAN="\033[96m"; DIM="\033[2m"

def ok(m):      print(f"  {GREEN}✓{RESET}  {m}")
def fail(m):    print(f"  {RED}✗{RESET}  {m}")
def info(m):    print(f"  {CYAN}→{RESET}  {m}")
def warn(m):    print(f"  {YELLOW}⚠{RESET}  {m}")
def section(m): print(f"\n{BOLD}{m}{RESET}\n{'─'*50}")

def post(url, payload, headers=None):
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(url, data=data,
           headers={"Content-Type": "application/json", **(headers or {})}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read()), r.status

def get(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.loads(r.read()), r.status

def post_expect_error(url, payload, headers=None):
    try:
        return post(url, payload, headers)
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code

def test_reachable(base):
    section("1 — Server reachable")
    try:
        get(f"{base}/admin/queue"); ok("Server is up"); return True
    except Exception as e:
        fail(f"Cannot reach server: {e}")
        print(f"  {DIM}sudo systemctl status otp-relay{RESET}")
        return False

def test_users(base):
    section("2 — Users loaded from Excel")
    try:
        data, _ = get(f"{base}/admin/users")
        count = data.get("count", 0)
        if count == 0: fail("No users loaded — check users.xlsx"); return []
        ok(f"{count} users loaded")
        print()
        for u in data["users"]:
            print(f"  {DIM}{u['token']}{RESET}  {u['name']:<28}  {u['email']}")
        return data["users"]
    except Exception as e:
        fail(f"Error: {e}"); return []

def test_smtp(base):
    section("3 — Exchange SMTP")
    try:
        data, _ = get(f"{base}/admin/smtp-test")
        if data.get("status") == "ok":
            ok(f"Test email sent to {data['sent_to']}")
            info("Check that inbox now to confirm delivery before continuing.")
            input(f"\n  {YELLOW}Press Enter once you've confirmed the test email arrived...{RESET}")
            return True
        else:
            fail(f"SMTP error: {data.get('error')}"); return False
    except Exception as e:
        fail(f"Error: {e}"); return False

def test_bad_token(base):
    section("4 — Reject unknown token")
    data, status = post_expect_error(f"{base}/claim-otp", {"token": "ZZZ"})
    if status == 404: ok(f"Unknown token rejected (404): {data.get('detail')}")
    else: warn(f"Expected 404, got {status}: {data}")

def test_duplicate(base, token):
    section("5 — Duplicate claim protection")
    info(f"Claiming twice with '{token}'...")
    post(f"{base}/claim-otp", {"token": token})
    data, _ = post(f"{base}/claim-otp", {"token": token})
    if data.get("status") == "already_queued":
        ok(f"Duplicate detected at position #{data['position']}")
    else:
        warn(f"Unexpected: {data}")

def test_flow(base, token, secret):
    section("6 — Full flow: claim → SMS → email")
    info(f"Claiming for token '{token}'...")
    try:
        data, _ = post(f"{base}/claim-otp", {"token": token})
    except urllib.error.HTTPError as e:
        fail(f"Claim failed ({e.code}): {json.loads(e.read())}"); return False

    if data.get("status") in ("queued", "already_queued"):
        ok(f"Queued: {data['name']} at #{data['position']}")
    else:
        fail(f"Unexpected: {data}"); return False

    queue_data, _ = get(f"{base}/admin/queue")
    q = queue_data.get("queue", [])
    if any(c["token"] == token.upper() for c in q):
        ok(f"Confirmed in queue ({len(q)} total)")

    print(); info("Simulating iPhone SMS arrival...")
    fake = "Your login code is 482910. Valid for 5 minutes. Do not share."
    data, _ = post(f"{base}/sms-received", {"body": fake},
                   headers={"X-Secret-Token": secret})
    if data.get("status") == "delivered":
        ok(f"OTP delivered to: {data['recipient']}")
    elif data.get("status") == "smtp_error":
        fail(f"Queue OK but SMTP failed: {data.get('error')}"); return False
    else:
        warn(f"Unexpected: {data}")

    info("Polling claim status...")
    status_data, _ = get(f"{base}/claim-status/{token}")
    if status_data.get("status") == "delivered": ok("Claim status: delivered")
    else: warn(f"Claim status: {status_data}")
    return True

def test_bad_secret(base):
    section("7 — Reject wrong secret token")
    data, status = post_expect_error(
        f"{base}/sms-received", {"body": "OTP 000000"},
        headers={"X-Secret-Token": "wrong-token"})
    if status == 401: ok("Wrong secret correctly rejected (401)")
    else: warn(f"Expected 401, got {status}")

def test_unmatched(base, secret):
    section("8 — SMS with empty queue (waits 4s)")
    info("Sending SMS with no one in queue...")
    data, _ = post(f"{base}/sms-received", {"body": "Your OTP is 111222"},
                   headers={"X-Secret-Token": secret})
    if data.get("status") == "no_claimant": ok("Correctly logged as unmatched")
    else: warn(f"Unexpected: {data}")

def test_log(base, token):
    section("9 — Audit log")
    data, _ = get(f"{base}/admin/log?limit=20")
    entries  = data.get("entries", [])
    ok(f"{data.get('total',0)} total log entries")
    print()
    relevant = [e for e in entries if e.get("token") == token.upper() or not e.get("token")]
    for e in relevant[:8]:
        colour = {"info": DIM, "warn": YELLOW, "error": RED}.get(e["status"], "")
        print(f"  {colour}{e['ts']}  {e['event']:<25}  {e['token'] or '—':<6}  {e['detail'][:55]}{RESET}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host",   default="localhost")
    parser.add_argument("--port",   default="8000")
    parser.add_argument("--token",  default=None)
    parser.add_argument("--secret", default=None)
    args = parser.parse_args()
    base = f"http://{args.host}:{args.port}"

    print(f"\n{BOLD}OTP Relay — End-to-End Test{RESET}")
    print(f"{DIM}Target: {base}{RESET}")

    if not test_reachable(base): return
    users = test_users(base)
    if not users: return
    if not test_smtp(base):
        print(f"\n  {YELLOW}Fix SMTP in .env then restart before continuing.{RESET}"); return

    token = args.token
    if not token:
        available = ", ".join(u["token"] for u in users)
        token = input(f"\n  Enter a token for the flow test ({available}): ").strip().upper()

    secret = args.secret or getpass.getpass("  Enter SMS_SECRET_TOKEN from .env: ").strip()

    test_bad_token(base)
    test_duplicate(base, token)

    # drain any leftover claim
    try:
        post(f"{base}/sms-received", {"body": "drain"}, headers={"X-Secret-Token": secret})
        time.sleep(1)
    except Exception:
        pass

    test_flow(base, token, secret)
    test_bad_secret(base)
    test_unmatched(base, secret)
    test_log(base, token)

    section("Done")
    ok("All tests complete — check the email inbox for the test OTP")
    print(f"\n  {DIM}Admin: http://{args.host}:{args.port}/admin/log{RESET}\n")

if __name__ == "__main__":
    main()
