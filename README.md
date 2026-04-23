# OTP Relay
**Ubuntu 24.04 LTS · Company LAN · On-screen OTP delivery**
Server: `srvotp26.init-db.lan` · Portal: `https://srvotp26.init-db.lan`

---

## How It Works

```
iPhone 16 (company WiFi)
   ↓  iOS 26 Shortcut → HTTPS POST /sms-received
srvotp26 (Ubuntu 24.04 VM)
   ↓  matches SMS to the active claimant
   ↓  stores OTP in memory (never on disk)
Portal (user's browser)
   ↓  polls /claim-status every 3 seconds
OTP appears on screen — no email involved

The same portal also hosts the **RTA Access Wizard**, **Help** section, and **Admin** views.
RTA onboarding progress is server-backed so reminders and progress persist across devices.
```

1. User opens the portal → enters their 2 or 3 character token → clicks **Claim my slot**
2. If the queue is empty, they become the active user immediately. If someone is ahead of them, they enter the waiting room and are told not to trigger their OTP yet.
3. Once active, the user opens the platform and triggers the OTP SMS. They have **90 seconds** before their slot is reclaimed.
4. iPhone receives SMS → Shortcut fires → POSTs to server over LAN
5. Server stores the OTP in memory (never logged, never written to disk) and unblocks the queue
6. The OTP appears on the user's screen. It stays visible for **4 minutes 45 seconds**, during which other users can already claim the next slot.
7. Every step is written to `data/audit.log`. OTP values are never recorded.

A second service (`otp-monitor`) runs alongside the main app. It pings the iPhone every few minutes using ARP and forwards error-level audit events to an IT contact via WhatsApp.

## Queue design

Only one user is active at a time. This is a deliberate safety constraint: because OTP SMS messages carry no user-identifying information, the server cannot match an incoming SMS to a specific person. Concurrent active users would cause mis-delivery. The 90-second slot window keeps wait times short — a normal flow completes in under 30 seconds.


---

## Update pipeline

Application code, portal UI, Help Docs, and server configuration are deployed through separate GitHub Actions workflows on the Raspberry Pi self-hosted runner.

See [UPDATE-PIPELINE.md](./UPDATE-PIPELINE.md) for deployment flow, workflow triggers, server-config deployment behavior, sudo requirements, and troubleshooting.
## Repository Structure

```

otp-relay/
├── main.py                        # FastAPI application
├── monitor.py                     # Phone watcher + WhatsApp alert forwarder
├── install.sh                     # Fresh install from this repo
├── update.sh                      # Full repo sync + package refresh + service restart
├── deploy_users.sh                # Hot-reload users.xlsx without restarting
├── setup_action-runner.sh         # Optional GitHub Actions runner setup helper
├── test_otp_relay.py              # End-to-end test suite
├── .env.template                  # Config template — copy to .env and fill in
├── .gitignore
├── README.md
├── UPDATE-PIPELINE.md
├── HELP-DOCS-DEPLOYMENT.md
├── frontend/
│   ├── index.html                 # Portal shell
│   ├── style.css                  # App styles
│   ├── app.jsx                    # React UI logic for OTP, Wizard, Help, and Admin views
│   └── help/                      # Generated Help Docs output
├── nginx/
│   └── otp-relay.conf.template    # nginx reverse proxy template rendered during install/deploy
├── scripts/
│   ├── build_help_docs.py         # Builds frontend/help from docs/help
│   ├── deploy_application_code.py # Incremental backend deploy helper
│   ├── deploy_portal_ui.py        # Incremental frontend deploy helper
│   ├── deploy_server_config.py    # Incremental server-config deploy helper
│   └── generate_sample_users.py   # Optional sample user generator
├── docs/
│   └── help/                      # Help Docs markdown source + assets
└── systemd/
    ├── otp-relay.service          # Main app systemd unit
    └── otp-monitor.service        # Monitor systemd unit
```

> `.env`, `venv/`, and `data/` are intentionally excluded from git.

---

## Deployment Details

| Item | Value |
|---|---|
| Server hostname | `srvotp26.init-db.lan` |
| Portal URL | `https://srvotp26.init-db.lan` |
| Service user | `otprelay` (system account, no login) |
| Monitor user | `root` (kept as root because ARP probing requires it) |
| App directory | `/opt/otp-relay/` |
| Data directory | `/opt/otp-relay/data/` |
| Audit log | `/opt/otp-relay/data/audit.log` |
| User list | `/opt/otp-relay/data/users.xlsx` |
| Wizard progress store | `/opt/otp-relay/data/wizard_progress.json` |
| Admin auth store | `/opt/otp-relay/data/admin_auth.json` |
| Python venv | `/opt/otp-relay/venv/` (not in git — created by install.sh) |
| TLS certificate | `/etc/ssl/otp-relay/server.crt` |
| TLS key | `/etc/ssl/otp-relay/server.key` |
| nginx config | `/etc/nginx/sites-available/otp-relay` |
| systemd units | `/etc/systemd/system/otp-relay.service`, `otp-monitor.service` |
| Environment config | `/opt/otp-relay/.env` (not in git) |

---

## File Permissions

```
/opt/otp-relay/                  root:root         755
├── main.py                      root:root         644
├── monitor.py                   root:root         755
├── install.sh                   root:root         755
├── update.sh                    root:root         755
├── deploy_users.sh              root:root         755
├── test_otp_relay.py            root:root         755
├── .env.template                root:root         644
├── .env                         root:otprelay     640  (not in git)
├── frontend/
│   ├── index.html               root:root         644
│   ├── style.css                root:root         644
│   └── app.jsx                  root:root         644
├── nginx/
│   └── otp-relay.conf.template  root:root         644
├── systemd/
│   ├── otp-relay.service        root:root         644
│   └── otp-monitor.service      root:root         644
├── venv/                        root:root         755  (not in git)
└── data/                        otprelay:otprelay 700  (not in git)
    ├── users.xlsx               otprelay:otprelay 600
    ├── audit.log                otprelay:otprelay 600
    ├── wizard_progress.json     otprelay:otprelay 600
    └── admin_auth.json          otprelay:otprelay 600
```

---

## Fresh Install (Ubuntu 24.04)

```bash
# Clone the repo into the install directory
sudo git clone git@github.com:psi1703/otp-relay-psi.git /opt/otp-relay
cd /opt/otp-relay

# Run the installer
sudo bash install.sh
```

`install.sh` creates the venv, sets permissions, generates the TLS cert, configures nginx and both systemd services — all in one shot. It will not overwrite an existing `.env`.

## Optional: GitHub Actions runner setup

If this server should also act as the self-hosted GitHub Actions runner for this repo, you can configure it after the main install completes.

### Before you start

You will need a **fresh GitHub runner registration token**.

Get it from:

1. Open the repository on GitHub: `psi1703/otp-relay-psi`
2. Go to **Settings**
3. Open **Actions**
4. Open **Runners**
5. Click **New self-hosted runner**
6. Copy the temporary registration token GitHub shows

**Important:**
- the token is temporary
- it expires after a short time
- if the script says the token is invalid or expired, go back to GitHub and generate a new one

### Run the setup script

```bash
sudo bash /opt/otp-relay/setup_action-runner.sh <RUNNER_TOKEN>
```

The script will:

- ask you to choose the platform (`ARM64` or `X64`)
- download the correct GitHub Actions runner package
- configure the runner for this repo
- install the runner as a system service
- start the runner automatically

After running the installer, disable the default nginx site which would otherwise interfere:

```bash
sudo rm /etc/nginx/sites-enabled/default
sudo systemctl reload nginx
```

### Manual Help Docs build (only if needed)

Help Docs are normally deployed automatically by the GitHub Actions workflow.  
If you ever need to build them manually on the server, use the app venv Python, not plain `python3`:

```bash
cd /opt/otp-relay
./venv/bin/python scripts/build_help_docs.py
```

### After running the installer

Edit `.env`:

```bash
sudo nano /opt/otp-relay/.env
```

Key values to fill in:

| Variable | Notes |
|---|---|
| `SERVER_HOSTNAME` | e.g. `srvotp26.init-db.lan` — used for nginx config, TLS cert, and portal URL |
| `SERVER_IP` | Server LAN IP — added to TLS cert SAN so the iPhone Shortcut can connect by IP if needed |
| `SMS_SECRET_TOKEN` | Generate: `python3 -c "import secrets; print(secrets.token_hex(32))"` — paste into Shortcut |
| `CLAIM_EXPIRY_SEC` | Seconds the active user has to trigger their OTP before being evicted (default: `90`) |
| `OTP_DISPLAY_SEC` | Seconds the OTP stays visible on screen after arrival (default: `285` = 4 min 45 sec) |
| `WHATSAPP_API_KEY` | From CallMeBot registration (see Monitor & Alerts section) |
| `WHATSAPP_RECIPIENT` | IT contact number in full international format: `+971501234567` |
| `PHONE_IP` | Static IP of the company iPhone — ask IT to set a DHCP reservation |
| `PHONE_INTERFACE` | Network interface name — check with `ip link` (typically `ens33`) |

SMTP settings are only needed if you use `/admin/smtp-test` for Exchange diagnostics. They play no role in OTP delivery.

Then start the services:

```bash
sudo systemctl start otp-relay
sudo systemctl start otp-monitor
sudo systemctl status otp-relay otp-monitor
```

### Post-install verification

Run these checks after a fresh install:

```bash
sudo systemctl status otp-relay --no-pager
sudo systemctl status otp-monitor --no-pager
sudo nginx -t
cd /opt/otp-relay
./venv/bin/python -c "import bcrypt; print('bcrypt OK')"
./venv/bin/python -c "import markdown, yaml; print('help docs deps OK')"
ls -l /opt/otp-relay/data
```

Deploy the user list (place `otp-relay-users.xlsx` in your home directory first):

```bash
sudo bash /opt/otp-relay/deploy_users.sh
```

---

## Updating

```bash
sudo bash /opt/otp-relay/update.sh               # full sync + package refresh + restart both services
sudo bash /opt/otp-relay/update.sh --no-restart  # full sync without restart
```

> **Warning**
> `update.sh` does a hard reset of `/opt/otp-relay` to `origin/main`.
> Do not use it if you have uncommitted local changes in the live repo that you need to keep.

`update.sh` automatically detects changes to systemd unit files and re-copies them to `/etc/systemd/system/`, so unit changes deploy without manual steps.

---

## Monitor & Alerts

`monitor.py` runs as the `otp-monitor` systemd service and does two things in parallel:

**Phone watcher** — sends ARP requests to the iPhone every `PHONE_PING_INTERVAL` seconds. ARP is used instead of ICMP ping because iOS filters ping in low-power state but must respond to ARP to maintain network presence. If `PHONE_OFFLINE_THRESHOLD` consecutive checks fail, a `phone_offline` event is written to the audit log and a WhatsApp alert is sent. Recovery is detected and alerted the same way.

**Log forwarder** — tails the audit log in real time. Any entry at or above `ALERT_LEVEL` is forwarded to the IT contact via WhatsApp (CallMeBot). Multiple events arriving within `BATCH_WINDOW_SEC` are grouped into a single message to avoid flooding.

### CallMeBot registration (one time per recipient)

1. Add `+34 644 64 90 27` to WhatsApp contacts as "CallMeBot"
2. Send this exact message to that number on WhatsApp: `I allow callmebot to send me messages`
3. You will receive an API key within a few minutes
4. Add it to `.env` as `WHATSAPP_API_KEY`

### Alert level

`ALERT_LEVEL` in `.env` controls the minimum severity that triggers a WhatsApp message:

| Value | What gets sent |
|---|---|
| `error` | Errors only — default, recommended for normal operation |
| `warn` | Warnings and errors — useful when troubleshooting |
| `info` | Everything — use only for active debugging sessions |

Change it in `.env` and restart `otp-monitor` to apply.

---

## iPhone Shortcut Setup (iOS 26)

1. Open **Shortcuts** → **Automation** → **+** → **New Automation**
2. Trigger: **Message Received**
   - From: the OTP sender number (exactly as it appears in Messages)
   - Run Immediately: **ON**
   - Notify When Run: **OFF**
3. Add actions:

**Action 1 — Get plain text from message:**
- Add: **Shortcut Input**
- Add: **Get Text from Input** → input: Shortcut Input

**Action 2 — POST to server:**
- Add: **Get Contents of URL**
- URL: `https://srvotp26.init-db.lan/sms-received`
- Method: **POST**
- Headers:
  - `X-Secret-Token` : *(paste value from SMS_SECRET_TOKEN in .env — no quotes)*
- Request Body: **JSON**
  - Key: `body` → Value: select the **Get text from** variable (the output of Action 1 — tap the variable picker, do not use "Shortcut Input" directly)

**Action 3 — Suppress notification:**
- Add: **Stop and Output**

4. Tap **Done**

> If the Shortcut stops firing after an iOS update, check that **Run Immediately** is still ON — iOS sometimes resets this.

### Troubleshooting the Shortcut

If the Shortcut fires but you see no `sms_received` event in the log, the most common causes are:

- iPhone dropped off the company WiFi — check Settings → WiFi, reconnect if needed. DNS for `.lan` only resolves on the internal network.
- The secret token in the Shortcut header doesn't match `SMS_SECRET_TOKEN` in `.env` — look for `sms_rejected` in the audit log.
- iOS cached stale DNS — toggle WiFi off and back on to flush.
- Certificate error in Shortcut despite Safari working — reboot the iPhone. Shortcuts runs in a background context that requires a reboot to pick up new certificate trust settings.
- "Automation failed / Last attempt to run your Shortcut failed" — check that the automation trigger has **Run Immediately: ON**. iOS sometimes resets this after updates.

### Trust the self-signed certificate on iPhone

```bash
# On server — temporarily expose cert for download
sudo cp /etc/ssl/otp-relay/server.crt /opt/otp-relay/frontend/srvotp26.crt
```

On iPhone:
1. Safari → `http://srvotp26.init-db.lan/srvotp26.crt`
2. **Settings → General → VPN & Device Management** → Install profile
3. **Settings → General → About → Certificate Trust Settings** → toggle ON

```bash
# Remove cert from web root once installed
sudo rm /opt/otp-relay/frontend/srvotp26.crt
```

> ⚠️ **Reboot the iPhone after trusting the certificate.** iOS Shortcuts runs in a background context that does not pick up new certificate trust settings until after a reboot. Safari will work immediately, but the Shortcut will keep failing with a certificate error until the phone is restarted.

### Push certificate to company PCs (IT task)

Deploy `/etc/ssl/otp-relay/server.crt` as a trusted root CA via Group Policy:

1. Copy `server.crt` to a domain share
2. Group Policy → Computer Configuration → Windows Settings → Security Settings
   → Public Key Policies → Trusted Root Certification Authorities → Import

---

## Updating the User List

Place the updated Excel file in your home directory as `~/otp-relay-users.xlsx`, then:

```bash
sudo bash /opt/otp-relay/deploy_users.sh
```

This copies the file, sets correct permissions, and reloads the user list in the running service — no restart needed.

### Excel format

| Column | Rules |
|---|---|
| `token` | 2 or 3 characters, letters and digits only, unique per person |
| `name` | Display name, free text |
| `email` | Must contain `@`, must not be empty |

Rows that fail validation are skipped and written to the audit log as `import_skipped` events with the exact row number and reason.


## RTA Wizard Storage (server-backed)

The RTA Access Wizard stores profile fields and progress on the server so data follows the user across devices.

Stored in `/opt/otp-relay/data/wizard_progress.json`:
- token
- display name
- `IITS_*` username
- `ADM_*` username
- password reset dates / reminder dates
- VPN reminder date
- step completion state
- last updated timestamp

Admin authentication is stored separately in `/opt/otp-relay/data/admin_auth.json`.

> These files are runtime data and are intentionally not tracked in git.


---

## Exchange SMTP (diagnostics only)

OTP delivery no longer uses email. The SMTP configuration is retained solely for the `/admin/smtp-test` endpoint, which lets you verify Exchange connectivity independently of OTP delivery.

```bash
curl -sk https://srvotp26.init-db.lan/admin/smtp-test | python3 -m json.tool
```

Expected: `{"status": "ok", "sent_to": "otp-relay@init-db.lan"}`

This installation uses anonymous relay on port 25:

```
SMTP_PORT=25
SMTP_AUTH=false
SMTP_USE_TLS=false
SMTP_PASSWORD=          (leave empty)
```

If you ever need authenticated SMTP (port 587), Exchange requires the full UPN format:
```
SMTP_USER=otp-relay@init-db.lan   ✓  correct
SMTP_USER=INIT-DB\otp-relay       ✗  does not work
SMTP_USER=otp-relay               ✗  does not work
```

---

## Simulate an SMS (for testing without the iPhone)

```bash
# 1. Claim a slot in the portal as normal — the OTP will appear on that browser tab
# 2. Inject a fake SMS from the server
curl -sk -X POST https://srvotp26.init-db.lan/sms-received \
  -H "Content-Type: application/json" \
  -H "X-Secret-Token: PASTE_YOUR_SMS_SECRET_TOKEN_HERE" \
  -d '{"body": "Your login code is 482910. Valid for 5 minutes."}'
```

The OTP (`482910`) will appear on the portal immediately. It is not stored anywhere on the server.

---

## Audit Log Events

Every event is appended to `/opt/otp-relay/data/audit.log` (one JSON object per line).
OTP values are never recorded — only metadata.

| Event | Status | Meaning |
|---|---|---|
| `server_start` | info | Service started, users loaded |
| `import_complete` | info/warn | Excel load finished — warn if any rows were skipped |
| `import_skipped` | warn | A row was skipped — detail gives row number and reason |
| `claim_queued` | info | User joined the queue |
| `claim_duplicate` | warn | User clicked twice — second click ignored, remaining time returned |
| `claim_rejected` | error | Unknown token submitted |
| `claim_expired` | warn | 90 seconds passed with no SMS — user evicted from slot 1 |
| `claim_cancelled` | info | User abandoned their queue slot via the Retry button |
| `concurrent_risk` | warn | A second claim arrived within 30 s of the active one — no action taken, logged for IT visibility |
| `sms_received` | info | iPhone Shortcut fired successfully |
| `sms_unmatched` | warn | SMS arrived but queue was empty — discarded |
| `sms_rejected` | error | Wrong secret token — check Shortcut configuration |
| `otp_delivered` | info | OTP stored in memory and ready for display — queue unblocked |
| `otp_display_expired` | info | OTP display window closed after 4 min 45 sec — purged from memory |
| `otp_discarded` | info | User clicked Send again — OTP removed from memory before expiry |
| `users_reloaded` | info | User list reloaded from Excel |
| `monitor_start` | info | Monitor service started |
| `monitor_error` | error | Monitor configuration error (e.g. network interface not found) |
| `phone_offline` | error | iPhone unreachable after consecutive ARP failures — WhatsApp alert sent |
| `phone_online` | error | iPhone reachable again after offline period — WhatsApp alert sent |

> `phone_offline` and `phone_online` use `error` status so they pass through the alert filter at default `ALERT_LEVEL=error`.

View in browser: `https://srvotp26.init-db.lan` → click **Admin**

```bash
# Live service log
sudo journalctl -u otp-relay -f

# Live monitor log
sudo journalctl -u otp-monitor -f

# Last 50 audit entries
tail -50 /opt/otp-relay/data/audit.log | python3 -m json.tool

# Warnings and errors only
grep -E '"status": "(warn|error)"' /opt/otp-relay/data/audit.log

# Import issues only
grep import_skipped /opt/otp-relay/data/audit.log
```

---

## Day-to-Day Operations

```bash
# Service status
sudo systemctl status otp-relay
sudo systemctl status otp-monitor

# Restart after config change
sudo systemctl restart otp-relay
sudo systemctl restart otp-monitor

# Update from git
sudo bash /opt/otp-relay/update.sh

# Update user list
sudo bash /opt/otp-relay/deploy_users.sh

# Run end-to-end tests
python3 /opt/otp-relay/test_otp_relay.py

# Current queue and pending OTP count
curl -sk https://srvotp26.init-db.lan/admin/queue | python3 -m json.tool

# All loaded users
curl -sk https://srvotp26.init-db.lan/admin/users | python3 -m json.tool

# Server-backed RTA wizard progress (admin-auth protected)
curl -sk https://srvotp26.init-db.lan/admin/wizard

# Test Exchange SMTP connectivity
curl -sk https://srvotp26.init-db.lan/admin/smtp-test | python3 -m json.tool
```

---

## User Instructions (send to your team)

> **How to get your OTP**
>
> 1. Go to `https://srvotp26.init-db.lan`
> 2. Enter your **2 or 3 character token** (ask IT if you don't have one)
> 3. Click **Claim my slot**
> 4. **If you see a waiting room:** someone is ahead of you — do not touch the platform yet. The page will tell you when it's your turn.
> 5. **When you see "Go trigger your OTP now":** open the platform and request the SMS code immediately. You have 90 seconds.
> 6. The OTP code appears on this page within seconds. Use it directly — no email needed.
>
> ⚠️ Do not trigger the OTP on the platform until the page tells you to.
> Doing so while someone else is active will disrupt their session.
