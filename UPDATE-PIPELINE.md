# OTP Relay Portal — Update Pipeline Guide

This guide documents the deployment pipeline for the `SCH-INIT/otp-relay` `portal` branch.

The portal branch is designed for an **Ubuntu 24.04 VM / company server** running a **self-hosted GitHub Actions runner**. The live application directory is a deploy target only; it is not expected to remain a git working copy after installation.

---

## What this guide covers

This document explains:

- how the company-server self-hosted GitHub Actions runner is used
- how each update lane is separated to reduce deployment risk
- what files trigger each workflow
- what each deployment script is allowed to change
- how Help Docs and the RTA Wizard guide are generated and deployed
- how server config updates differ from UI and application code updates
- how nginx, systemd, and shell-script updates are applied safely
- what sudo access is required for the server-config workflow
- how to troubleshoot common deployment failures

---

<a id="fresh-target-deployment-sequence"></a>

## Fresh target deployment sequence

Use this sequence when preparing a new Ubuntu 24.04 VM / company-server target. This is the command sequence linked from `README.md`.

### 1. Clone the portal branch

```bash
sudo git clone -b portal git@github.com:SCH-INIT/otp-relay.git /opt/otp-relay
cd /opt/otp-relay
```

### 2. Configure the self-hosted GitHub Actions runner

Create a fresh runner registration token in GitHub:

```text
Repository -> Settings -> Actions -> Runners -> New self-hosted runner
```

Then run the setup script from the cloned repo:

```bash
sudo bash /opt/otp-relay/setup_action-runner.sh <RUNNER_TOKEN>
```

The setup script auto-detects the server architecture and registers the runner with the matching label, such as `self-hosted,Linux,X64` or `self-hosted,Linux,ARM64`.

If you need to override the runner account or architecture:

```bash
OTP_RELAY_RUNNER_USER=<runner-user> sudo -E bash /opt/otp-relay/setup_action-runner.sh <RUNNER_TOKEN>
sudo bash /opt/otp-relay/setup_action-runner.sh <RUNNER_TOKEN> x64
sudo bash /opt/otp-relay/setup_action-runner.sh <RUNNER_TOKEN> arm64
```

### 3. Run the installer once

```bash
sudo bash /opt/otp-relay/install.sh
```

`install.sh` installs packages, creates the service account and virtual environment, builds Help Docs output, configures nginx/TLS/systemd, removes `.git` from `/opt/otp-relay`, and assigns deploy-target ownership for the detected runner user.

After install, `/opt/otp-relay` is the live application directory, not a git working copy.

### 4. Configure the environment

```bash
sudo nano /opt/otp-relay/.env
```

At minimum, confirm or set:

```text
SERVER_HOSTNAME
SERVER_IP
SMS_SECRET_TOKEN
PHONE_IP
PHONE_INTERFACE
WHATSAPP_API_KEY
WHATSAPP_RECIPIENT
```

### 5. Start services

```bash
sudo systemctl start otp-relay
sudo systemctl start otp-monitor
sudo systemctl status otp-relay otp-monitor --no-pager
```

### 6. Deploy the user list

Place the Excel file in the server user's home directory as:

```bash
~/otp-relay-users.xlsx
```

Then run:

```bash
sudo bash /opt/otp-relay/deploy_users.sh
```

### 7. Add sudoers entries for server-config deployment

Application code, portal UI, and Help Docs deploy through runner-managed file ownership. Server-config deployment touches nginx/systemd targets and needs the limited sudoers entries documented in [Sudo model for server-config deploy](#9-sudo-model-for-server-config-deploy).

### 8. Verify the live portal

```bash
curl -sk -o /dev/null -w "root=%{http_code}\n" https://127.0.0.1/
curl -sk -o /dev/null -w "app=%{http_code}\n" https://127.0.0.1/app.jsx
curl -sk -o /dev/null -w "css=%{http_code}\n" https://127.0.0.1/style.css
curl -sk -o /dev/null -w "guide=%{http_code}\n" https://127.0.0.1/guide.html
curl -sk -o /dev/null -w "wizard=%{http_code}\n" https://127.0.0.1/help/wizard-guide.json
```

Expected:

```text
root=200
app=200
css=200
guide=200
wizard=200
```

### 9. Test runner-driven deployment

From GitHub, manually trigger or push changes for these workflows on the `portal` branch:

```text
Deploy Application Code
Deploy Portal UI
Deploy Help Docs
Deploy Server Config
```

Normal update flow after this point:

```text
maintainer edits the portal branch on GitHub
-> self-hosted runner checks out the repo
-> workflow deploys selected files into /opt/otp-relay
-> live portal updates
```

# 1. Architecture

The project has **four deployment lanes**:

1. **Application code deploy**
2. **Portal UI deploy**
3. **Help Docs / RTA Wizard guide deploy**
4. **Server config deploy**

This split exists so that changes in one area do **not** unintentionally redeploy or overwrite unrelated parts of the system.

---

# 2. Deployment model

## 2.1 GitHub repo — source of truth

The GitHub repo stores:

- backend runtime files such as `main.py` and `monitor.py`
- portal UI files such as `frontend/app.jsx`, `frontend/index.html`, `frontend/style.css`, and `frontend/guide.html`
- Help Docs / RTA Wizard guide source files under `docs/help/`
- server-managed files such as:
  - `install.sh`
  - `update.sh`
  - `deploy_users.sh`
  - `systemd/*.service`
  - `nginx/otp-relay.conf.template`
- deployment workflows under `.github/workflows/`
- deployment scripts under `scripts/`

## 2.2 Self-hosted runner on the company server

The self-hosted runner:

- checks out the repo into its temporary workspace
- runs only the workflow triggered by the changed file paths
- applies a narrow deploy script for that update lane

Typical runner workspace:

```bash
~/actions-runner/_work/otp-relay/otp-relay/
```

The exact username may vary by server. The installer detects the runner user and prepares runner-managed file permissions accordingly.

## 2.3 Live deployment target

The live application is served from:

```bash
/opt/otp-relay
```

Deployment scripts copy from the runner workspace into `/opt/otp-relay`, or into server-managed locations such as:

```bash
/etc/systemd/system/
/etc/nginx/sites-available/
```

`/opt/otp-relay` is the live app directory. It is not the source-of-truth git repo after installation.

---

# 3. Final operating model

The current recommended workflow is:

1. Edit files in the GitHub repo on the `portal` branch.
2. Commit/push the change.
3. GitHub Actions runs on the company-server self-hosted runner.
4. Only the matching workflow is triggered.
5. Only the allowed files for that workflow are updated on the server.

Normal updates should **not** require manually copying files into `/opt/otp-relay`.

Key server locations:

```bash
~/actions-runner
/opt/otp-relay
/etc/systemd/system
/etc/nginx/sites-available
```

---

# 4. Update lanes

## 4.1 Application code deploy

### Workflow

```bash
.github/workflows/deploy-application-code.yml
```

### Triggered by changes to

```text
main.py
monitor.py
scripts/deploy_application_code.py
.github/workflows/deploy-application-code.yml
```

### Deployment script

```bash
scripts/deploy_application_code.py
```

### What it does

- validates Python files before deployment
- compares repo files against live files in `/opt/otp-relay`
- copies only changed files
- restarts only the affected services

### What it does **not** manage

- UI files
- Help Docs
- nginx config
- systemd unit files
- shell installers or maintenance scripts

This lane is intentionally narrow and is only for runtime Python code.

---

## 4.2 Portal UI deploy

### Workflow

```bash
.github/workflows/deploy-portal-ui.yml
```

### Triggered by changes to

```text
frontend/app.jsx
frontend/index.html
frontend/style.css
frontend/guide.html
scripts/deploy_portal_ui.py
.github/workflows/deploy-portal-ui.yml
```

### Deployment script

```bash
scripts/deploy_portal_ui.py
```

### What it does

- compares repo UI files against live files in `/opt/otp-relay/frontend`
- copies only changed UI files
- deploys the pop-out RTA Wizard guide page at `/guide.html`
- does **not** restart backend services

### Why this split exists

Small UI fixes should not redeploy backend code, touch system services, or modify infrastructure files.

---

## 4.3 Help Docs / RTA Wizard guide deploy

### Workflow

```bash
.github/workflows/deploy-help-docs.yml
```

### Triggered by changes to

```text
docs/help/**
scripts/build_help_docs.py
.github/workflows/deploy-help-docs.yml
```

### What it manages

- source markdown pages in `docs/help/`
- screenshot and image assets in `docs/help/assets/`
- the Help Docs / wizard-guide build script
- generated `frontend/help/` output
- generated `frontend/help/wizard-guide.json` consumed by the RTA Wizard floating guide and the pop-out guide page
- generated `frontend/help/manifest.json` and `frontend/help/rendered/*.html` for optional reference/fallback Help pages
- deployed Help Docs and wizard-guide assets under `/opt/otp-relay/frontend/help/`

### What maintainers do

Maintainers edit only the repo source files and push:

```text
docs/help/*.md
docs/help/assets/*
```

The company-server self-hosted runner automatically checks out the repo, runs:

```bash
python3 scripts/build_help_docs.py
```

and syncs the generated `frontend/help/` output into:

```bash
/opt/otp-relay/frontend/help/
```

No maintainer should manually edit `frontend/help/` or `/opt/otp-relay/frontend/help/` for normal Help Docs / wizard-guide updates.

### Important rule

The RTA Wizard floating guide and pop-out guide are markdown-driven. User-facing guide text should be maintained in `docs/help/*.md` using explicit wizard step blocks, and screenshots should be maintained in `docs/help/assets/`.

The generated `frontend/help/wizard-guide.json` is build output and should not be hand-edited.

---

## 4.4 Server config deploy

### Workflow

```bash
.github/workflows/deploy-server-config.yml
```

### Triggered by changes to

```text
install.sh
update.sh
deploy_users.sh
systemd/*.service
nginx/otp-relay.conf.template
scripts/deploy_server_config.py
.github/workflows/deploy-server-config.yml
```

### Deployment script

```bash
scripts/deploy_server_config.py
```

### What it manages

- shell scripts copied into `/opt/otp-relay`
- systemd unit files copied into `/etc/systemd/system/`
- nginx template copied into `/opt/otp-relay/nginx/`
- rendered live nginx config written to `/etc/nginx/sites-available/otp-relay`

### What makes this lane different

This workflow touches **root-managed server files**, so it requires carefully limited `sudo` access for the GitHub runner user.

---

# 5. Why the deployment is split

The deployment lanes are separated for safety.

Without this split:

- a UI change could accidentally restart backend services
- a Python code change could accidentally overwrite nginx or systemd config
- a docs update could accidentally affect runtime code
- infrastructure updates could be mixed with routine UI work

The intended model is:

- **app code** updates only app code
- **UI** updates only UI
- **Help Docs** updates only docs output
- **server config** updates only server-managed files

---

# 6. Server config deployment behavior

The server-config pipeline should use **incremental exact updates**, not a broad full-server refresh.

## 6.1 Shell scripts

Managed files:

```text
install.sh
update.sh
deploy_users.sh
```

Behavior:

- validate each script with `bash -n`
- copy only changed files into `/opt/otp-relay`
- preserve executable permissions
- do **not** restart services unless some other changed file requires it

## 6.2 systemd unit files

Managed files:

```text
systemd/otp-relay.service
systemd/otp-monitor.service
```

Behavior:

- copy changed unit files into `/etc/systemd/system/`
- run `systemctl daemon-reload`
- restart only the services whose unit files changed
- verify the restarted services are active

## 6.3 nginx template

Managed file:

```text
nginx/otp-relay.conf.template
```

Behavior:

- copy the template into `/opt/otp-relay/nginx/otp-relay.conf.template`
- source `/opt/otp-relay/.env`
- read `SERVER_HOSTNAME` and `SERVER_IP`
- render the live nginx config with `envsubst`
- write the rendered config to:

```bash
/etc/nginx/sites-available/otp-relay
```

- run `nginx -t`
- reload nginx only if validation succeeds

---

# 7. Why the nginx template is deployed, not a static config

The repo uses a template file:

```bash
nginx/otp-relay.conf.template
```

This template includes environment placeholders such as:

```nginx
server_name ${SERVER_HOSTNAME} ${SERVER_IP};
```

Because those values are server-specific, the deployment pipeline should not copy a pre-rendered static config from GitHub.

Instead, it should:

1. deploy the template
2. load environment values from `/opt/otp-relay/.env`
3. render the live config on the server
4. validate the rendered nginx config
5. reload nginx

---

# 8. Timestamped logging

The server-config deployment script should emit timestamped logs like:

```text
[2026-04-21 14:32:01] Starting server config deployment
[2026-04-21 14:32:01] Validating shell script: /path/to/install.sh
[2026-04-21 14:32:01] RUN: bash -n /path/to/install.sh
[2026-04-21 14:32:02] Changed service files:
[2026-04-21 14:32:02] - systemd/otp-relay.service
[2026-04-21 14:32:02] RUN: sudo -n /usr/bin/systemctl daemon-reload
[2026-04-21 14:32:03] Service is active: otp-relay.service
[2026-04-21 14:32:03] Server config deployment completed successfully
```

This makes Actions logs easier to debug and confirms the exact order of operations.

---

# 9. Sudo model for server-config deploy

The service account `otprelay` exists to **run** the OTP Relay service, not to manage system infrastructure.

The self-hosted runner user is responsible for deployment automation. For server-config changes, it must have limited `sudo` permission for the exact commands the server-config workflow uses.

## Recommended sudoers entries

Replace `<runner-user>` with the actual account that runs the GitHub Actions runner.

```sudoers
<runner-user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart otp-relay.service
<runner-user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart otp-monitor.service
<runner-user> ALL=(root) NOPASSWD: /usr/bin/systemctl is-active --quiet otp-relay.service
<runner-user> ALL=(root) NOPASSWD: /usr/bin/systemctl is-active --quiet otp-monitor.service
<runner-user> ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload
<runner-user> ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx
<runner-user> ALL=(root) NOPASSWD: /usr/sbin/nginx -t
<runner-user> ALL=(root) NOPASSWD: /usr/bin/install
```

## Important rule

The deployment script should call the **exact same command paths** as the sudoers entries.

For example, if sudoers allows:

```sudoers
/usr/bin/systemctl restart otp-relay.service
```

then the script should call:

```bash
sudo -n /usr/bin/systemctl restart otp-relay.service
```

not a generic `sudo systemctl ...` or `/bin/systemctl ...`.

---

# 10. File and command ownership model

## Service runtime account

The `install.sh` process creates the `otprelay` system user. That user is intended to run the portal service safely with limited privileges.

## Runner account

The self-hosted GitHub Actions runner account is responsible for deployment automation. The installer detects this account and gives it ownership only of runner-managed live files.

Runner-managed live files include:

```text
/opt/otp-relay/main.py
/opt/otp-relay/monitor.py
/opt/otp-relay/frontend/index.html
/opt/otp-relay/frontend/style.css
/opt/otp-relay/frontend/app.jsx
/opt/otp-relay/frontend/guide.html
/opt/otp-relay/frontend/help/
```

## Root-managed targets

The following areas remain root-managed:

```bash
/etc/systemd/system/
/etc/nginx/sites-available/
```

That is why the server-config deploy must use tightly scoped sudo permissions.

---

# 11. Where files live

## Repo source

```bash
main.py
monitor.py
frontend/
docs/help/
systemd/
nginx/
scripts/
.github/workflows/
```

## Runner workspace

```bash
~/actions-runner/_work/otp-relay/otp-relay/
```

## Live app

```bash
/opt/otp-relay
```

## Root-managed live config

```bash
/etc/systemd/system/
/etc/nginx/sites-available/
```

---

# 12. Workflow summary

## Application code workflow

- validates Python files
- copies changed `main.py` / `monitor.py`
- restarts only affected services

## Portal UI workflow

- copies only allowed UI files
- deploys `frontend/guide.html`
- no service restart

## Help Docs / RTA Wizard guide workflow

- runs automatically when `docs/help/**`, `scripts/build_help_docs.py`, or the Help Docs workflow changes
- rebuilds optional rendered Help pages
- rebuilds `frontend/help/wizard-guide.json` for the RTA Wizard floating guide and pop-out guide
- copies `docs/help/assets/` into generated `frontend/help/assets/`
- syncs generated `frontend/help/` output to the live portal

## Server config workflow

- validates shell scripts
- copies changed server-managed files
- reloads systemd when needed
- validates and reloads nginx when needed
- restarts only services affected by changed unit files

---

# 13. Day-to-day usage

## Update backend runtime code

Edit:

```bash
main.py
monitor.py
```

Push to the `portal` branch.

## Update portal UI

Edit:

```bash
frontend/app.jsx
frontend/index.html
frontend/style.css
frontend/guide.html
```

Push to the `portal` branch.

## Update Help Docs / RTA Wizard guide content

Edit markdown guide content:

```bash
docs/help/*.md
```

Add or replace screenshots and guide images:

```bash
docs/help/assets/
```

Push to the `portal` branch.

The self-hosted runner automatically:

1. checks out the updated repo
2. installs the build dependencies if needed
3. runs `python3 scripts/build_help_docs.py`
4. generates `frontend/help/wizard-guide.json`
5. generates optional rendered Help reference pages
6. syncs `frontend/help/` to `/opt/otp-relay/frontend/help/`

Manual deployment is only needed for emergency/debug work. Normal maintainers should not SSH into the server to rebuild or copy Help Docs files.

## Update server-managed files

Edit:

```bash
install.sh
update.sh
deploy_users.sh
systemd/*.service
nginx/otp-relay.conf.template
scripts/deploy_server_config.py
```

Push to the `portal` branch.

---

# 14. Manual verification commands on the server

## Check runner workspace

```bash
ls -R ~/actions-runner/_work/otp-relay/otp-relay
```

## Check live app files

```bash
ls -R /opt/otp-relay
```

## Check live systemd units

```bash
ls -l /etc/systemd/system/otp-*.service
systemctl status otp-relay.service
systemctl status otp-monitor.service
```

## Check rendered nginx config

```bash
sudo cat /etc/nginx/sites-available/otp-relay
sudo nginx -t
```

## Check frontend and guide endpoints

```bash
curl -s -o /dev/null -w "root=%{http_code}\n" http://127.0.0.1:8000/
curl -s -o /dev/null -w "guide=%{http_code}\n" http://127.0.0.1:8000/guide.html
curl -s -o /dev/null -w "wizard=%{http_code}\n" http://127.0.0.1:8000/help/wizard-guide.json
```

Expected:

```text
root=200
guide=200
wizard=200
```

## Check Actions logs for timestamped deployment output

Open the relevant workflow run in GitHub Actions and inspect the deployment step.

---

# 15. Troubleshooting

## Problem: workflow ran but nothing changed

Check:

- whether the changed file path actually matches the workflow `paths:` filter
- whether the correct workflow triggered
- whether the deployment script found any file differences

## Problem: workflow cannot write to `/opt/otp-relay/main.py`

Cause:

- the live application-code files are not owned by the self-hosted runner user

Fix:

- run `install.sh` from the current `portal` branch, or repair ownership for runner-managed files
- confirm `/opt/otp-relay/main.py` and `/opt/otp-relay/monitor.py` are owned by the runner user

Verify:

```bash
ls -l /opt/otp-relay/main.py /opt/otp-relay/monitor.py
```

## Problem: workflow cannot write to `/opt/otp-relay/frontend/help/`

Cause:

- the generated Help Docs output folder is not owned by the self-hosted runner user

Fix:

- run `install.sh` from the current `portal` branch, or repair ownership for `/opt/otp-relay/frontend/help/`

Verify:

```bash
ls -ld /opt/otp-relay/frontend/help
```

## Problem: `/guide.html` returns `{"detail":"Not Found"}`

Check:

- `frontend/guide.html` exists in the repo
- `scripts/deploy_portal_ui.py` allows `frontend/guide.html`
- the Portal UI workflow has deployed it to `/opt/otp-relay/frontend/guide.html`
- `main.py` mounts the frontend using an absolute `FRONTEND_DIR`

Verify:

```bash
ls -l /opt/otp-relay/frontend/guide.html
curl -i http://127.0.0.1:8000/guide.html
```

## Problem: workflow cannot find the deployment script

Cause:

- the workflow refers to a filename that does not exist on the `portal` branch

Fix:

- ensure the workflow path and the committed script filename match exactly

## Problem: `sudo: a terminal is required` or `a password is required`

Cause:

- the runner user lacks `NOPASSWD` sudo permission for one of the required commands

Fix:

- add exact sudoers entries for the exact command paths used by the script

## Problem: `systemctl` restart works manually but fails in Actions

Cause:

- sudoers allows one exact path, but the script uses another path

Fix:

- align the script command path exactly with sudoers, for example `/usr/bin/systemctl`

## Problem: nginx reload fails

Check:

- whether `/opt/otp-relay/.env` contains `SERVER_HOSTNAME` and `SERVER_IP`
- whether the rendered config is valid
- whether `nginx -t` passes before reload

## Problem: service becomes inactive after deployment

Check:

```bash
systemctl status otp-relay.service
systemctl status otp-monitor.service
journalctl -u otp-relay.service -n 100
journalctl -u otp-monitor.service -n 100
```

## Problem: Help Docs or UI changed but backend also restarted

That indicates the wrong workflow or wrong deployment script was used. The intended model is lane separation.

## Problem: RTA Wizard guide text did not update after editing markdown

Check:

- the edited file is under `docs/help/`
- the markdown uses the correct wizard step block, for example `<!-- wizard:password_reset -->`
- the workflow `deploy-help-docs.yml` triggered after the push
- the Actions log shows `python3 scripts/build_help_docs.py` completed successfully
- `frontend/help/wizard-guide.json` was generated in the runner workspace
- `/opt/otp-relay/frontend/help/wizard-guide.json` exists on the server
- the browser is not showing cached portal data

Verify from the server:

```bash
curl -s http://127.0.0.1:8000/help/wizard-guide.json | python3 -m json.tool >/dev/null
```

## Problem: wizard screenshots did not update

Check:

- the screenshot was committed under `docs/help/assets/`
- the markdown references the image with `assets/`
- the build copied it to `frontend/help/assets/`
- the workflow synced it to `/opt/otp-relay/frontend/help/assets/`
- the public path returns HTTP 200:

```bash
curl -s -o /dev/null -w "asset=%{http_code}\n" http://127.0.0.1:8000/help/assets/<filename>
```

---

# 16. Operational rules

- GitHub repo is the source of truth.
- Runner workspace is temporary build space.
- `/opt/otp-relay` is the live application path.
- `/opt/otp-relay` should not be treated as a git working copy after install.
- `/etc/systemd/system/` and `/etc/nginx/sites-available/` are root-managed targets.
- Use separate workflows for app code, UI, docs, and server config.
- Do not use a broad full update process for routine incremental changes.
- Keep deployment scripts narrow and allowlist-based.
- Keep timestamped logs in server-config deployment output.

---

# 17. Summary

This project supports a safer multi-lane update pipeline:

- **Application code deploy** for Python runtime files
- **Portal UI deploy** for frontend files, including the pop-out guide page
- **Help Docs / RTA Wizard guide deploy** for markdown guide content, screenshots, and generated wizard-guide JSON
- **Server config deploy** for shell scripts, systemd units, and nginx template updates

The core principle is simple:

**Edit in GitHub → matching workflow runs on the company-server self-hosted runner → only the intended part of the system is updated.**

For Help Docs and RTA Wizard guide content, maintainers edit only `docs/help/*.md` and `docs/help/assets/`. The self-hosted runner handles the build and live sync automatically.
