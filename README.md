# OTP Relay
**Ubuntu 24.04 LTS · Company LAN · Exchange SMTP**
Server: `srvotp26.init-db.lan` · Portal: `https://srvotp26.init-db.lan`

---

## How It Works

```
iPhone 16 (company WiFi)
   ↓  iOS 26 Shortcut → HTTPS POST /sms-received
srvotp26 (Ubuntu 24.04 VM)
   ↓  pops first user from claim queue
Exchange SMTP (init-db.lan)
   ↓  sends HTML email with OTP
User's inbox
```

1. User opens the portal → enters their 2 or 3 character token → clicks the button
2. Server places them in a FIFO queue with a 5-minute expiry window
3. User immediately opens the platform and triggers the OTP SMS
4. iPhone receives SMS → Shortcut fires → POSTs to server over LAN
5. Server pops the first person in queue and emails them the OTP via Exchange
6. Portal auto-confirms delivery. Every step is written to `data/audit.log`.

---

## Repository Structure

```
otp-relay/
├── main.py                  # FastAPI application
├── install.sh               # Fresh install from this repo
├── update.sh                # git pull + restart (--no-restart flag available)
├── deploy_users.sh          # Hot-reload users.xlsx without restarting
├── test_otp_relay.py        # End-to-end test suite
├── .env.template            # Config template — copy to .env and fill in
├── .gitignore
├── README.md
├── frontend/
│   └── index.html           # Self-contained portal UI
├── nginx/
│   └── otp-relay.conf       # nginx reverse proxy config
├── scripts/
│   └── generate_sample_users.py
└── systemd/
    └── otp-relay.service    # systemd unit file
```

> `.env`, `venv/`, and `data/` are intentionally excluded from git.

---

## Deployment Details

| Item | Value |
|---|---|
| Server hostname | `srvotp26.init-db.lan` |
| Portal URL | `https://srvotp26.init-db.lan` |
| Service user | `otprelay` (system account, no login) |
| App directory | `/opt/otp-relay/` |
| Data directory | `/opt/otp-relay/data/` |
| Audit log | `/opt/otp-relay/data/audit.log` |
| User list | `/opt/otp-relay/data/users.xlsx` |
| Python venv | `/opt/otp-relay/venv/` (not in git — created by install.sh) |
| TLS certificate | `/etc/ssl/otp-relay/server.crt` |
| TLS key | `/etc/ssl/otp-relay/server.key` |
| nginx config | `/etc/nginx/sites-available/otp-relay` |
| systemd unit | `/etc/systemd/system/otp-relay.service` |
| Environment config | `/opt/otp-relay/.env` (not in git) |

---

## File Permissions

```
/opt/otp-relay/                  root:root         755
├── main.py                      root:root         644
├── install.sh                   root:root         755
├── update.sh                    root:root         755
├── deploy_users.sh              root:root         755
├── test_otp_relay.py            root:root         755
├── .env.template                root:root         644
├── .env                         root:otprelay     640  (not in git)
├── frontend/
│   └── index.html               root:root         644
├── nginx/
│   └── otp-relay.conf           root:root         644
├── systemd/
│   └── otp-relay.service        root:root         644
├── venv/                        root:root         755  (not in git)
└── data/                        otprelay:otprelay 700  (not in git)
    ├── users.xlsx               otprelay:otprelay 600
    └── audit.log                otprelay:otprelay 600
```

---

## Fresh Install (Ubuntu 24.04)

```bash
# Clone the repo into the install directory
sudo git clone git@github.com:SCH-INIT/otp-relay.git /opt/otp-relay
cd /opt/otp-relay

# Run the installer
sudo bash install.sh
```

`install.sh` creates the venv, sets permissions, generates the TLS cert, configures nginx and systemd — all in one shot. It will not overwrite an existing `.env`.

### After running the installer

Edit `.env`:

```bash
sudo nano /opt/otp-relay/.env
```

Key values to fill in:

| Variable | Notes |
|---|---|
| `SMS_SECRET_TOKEN` | Generate: `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `SMTP_HOST` | Exchange server hostname |
| `SMTP_PORT` | `587` (STARTTLS) or `25` |
| `SMTP_USER` | Full UPN format: `otp-relay@init-db.lan` |
| `SMTP_PASSWORD` | Mailbox password |

Then start the service:

```bash
sudo systemctl start otp-relay
sudo systemctl status otp-relay
```

Deploy the user list (place `otp-relay-users.xlsx` in your home directory first):

```bash
sudo bash /opt/otp-relay/deploy_users.sh
```

---

## Updating

```bash
sudo bash /opt/otp-relay/update.sh            # pull latest + restart
sudo bash /opt/otp-relay/update.sh --no-restart  # pull only
```

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
  - `X-Secret-Token` : *(paste value from SMS_SECRET_TOKEN in .env — no quotes, no $ substitution)*
  - `Content-Type` : `application/json`
- Request Body: **JSON**
  - Key: `body` → Value: output of Get Text from Input

**Action 3 — Suppress notification:**
- Add: **Stop and Output**

4. Tap **Done**

> If the Shortcut stops firing after an iOS update, check that **Run Immediately** is still ON — iOS sometimes resets this.

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

---

## Verify Exchange SMTP

```bash
curl -sk https://srvotp26.init-db.lan/admin/smtp-test | python3 -m json.tool
```

Expected: `{"status": "ok", "sent_to": "otp-relay@init-db.lan"}`

Exchange requires the full UPN format:
```
SMTP_USER=otp-relay@init-db.lan   ✓  correct
SMTP_USER=INIT-DB\otp-relay       ✗  does not work
SMTP_USER=otp-relay               ✗  does not work
```

---

## Simulate an SMS (for testing without the iPhone)

If the Shortcut isn't firing, you can inject an SMS manually:

```bash
# 1. First, claim a slot in the portal as normal
# 2. Then run this — paste the token literally, do not use $(...) substitution
curl -sk -X POST https://srvotp26.init-db.lan/sms-received \
  -H "Content-Type: application/json" \
  -H "X-Secret-Token: PASTE_TOKEN_LITERALLY_HERE" \
  -d '{"body": "Your login code is 482910. Valid for 5 minutes."}'
```

---

## Audit Log Events

Every event is appended to `/opt/otp-relay/data/audit.log` (one JSON object per line).

| Event | Status | Meaning |
|---|---|---|
| `server_start` | info | Service started, users loaded |
| `import_complete` | info/warn | Excel load finished — warn if any rows skipped |
| `import_skipped` | warn | A row was skipped — detail gives row number and reason |
| `claim_queued` | info | User joined the queue |
| `claim_duplicate` | warn | User clicked twice — second click ignored |
| `claim_rejected` | error | Unknown token submitted |
| `claim_expired` | warn | 5 min passed with no SMS — user removed from queue |
| `sms_received` | info | iPhone Shortcut fired successfully |
| `sms_unmatched` | warn | SMS arrived but queue was empty |
| `sms_rejected` | error | Wrong secret token — check Shortcut config |
| `otp_delivered` | info | Email sent successfully via Exchange |
| `otp_delivery_failed` | error | SMTP error — user automatically re-queued |
| `users_reloaded` | info | User list reloaded from Excel |

View in browser: `https://srvotp26.init-db.lan` → click **Admin ↗**

```bash
# Live service log
sudo journalctl -u otp-relay -f

# Last 50 audit entries
tail -50 /opt/otp-relay/data/audit.log | python3 -m json.tool

# Warnings and errors only
grep -E '"status": "(warn|error)"' /opt/otp-relay/data/audit.log

# Import issues only
grep import_skipped /opt/otp-relay/data/audit.log
```

> OTP values are never stored in the log. Only metadata is recorded.

---

## Day-to-Day Operations

```bash
# Service status
sudo systemctl status otp-relay

# Restart after config change
sudo systemctl restart otp-relay

# Update from git
sudo bash /opt/otp-relay/update.sh

# Update user list
sudo bash /opt/otp-relay/deploy_users.sh

# Run end-to-end tests
python3 /opt/otp-relay/test_otp_relay.py

# Current queue
curl -sk https://srvotp26.init-db.lan/admin/queue | python3 -m json.tool

# All loaded users
curl -sk https://srvotp26.init-db.lan/admin/users | python3 -m json.tool

# Test Exchange SMTP
curl -sk https://srvotp26.init-db.lan/admin/smtp-test | python3 -m json.tool
```

---

## User Instructions (send to your team)

> **How to get your OTP**
>
> 1. Go to `https://srvotp26.init-db.lan`
> 2. Enter your **2 or 3 character token** (ask IT if you don't have one)
> 3. Click **"I'm about to request my OTP"**
> 4. Immediately open the platform and trigger the OTP/SMS code
> 5. The code will arrive in your email inbox within seconds
> 6. The page confirms automatically once it has been sent
>
> ⚠️ Request the OTP on the platform **immediately** after clicking the button.
> Your slot expires after 5 minutes.
