# OTP Relay Portal — Help Docs and RTA Wizard Guide Deployment

The RTA Wizard floating guide is markdown-driven and deployed automatically by the Raspberry Pi self-hosted GitHub Actions runner.

For normal guide updates, maintainers only edit source files and push to `main`:

```bash
docs/help/*.md
docs/help/assets/*
```

The runner then rebuilds and deploys the generated help output automatically. Manual build/deploy commands are only needed for local testing or emergency recovery.

The portal loads the generated wizard guide from:

```text
/help/wizard-guide.json
```

This means normal guide-text updates do **not** require editing the large `frontend/app.jsx` file.

---

## 1. Source of truth

| Content type | Source of truth | Notes |
|---|---|---|
| User-facing RTA Wizard guide text | `docs/help/*.md` | Use explicit `<!-- wizard:step_id -->` blocks |
| Wizard screenshots | `docs/help/assets/` | Served after build as `/help/assets/<filename>` |
| Optional rendered Help reference pages | `docs/help/*.md` | Generated into `frontend/help/rendered/*.html` |
| Generated wizard data | `frontend/help/wizard-guide.json` | Generated; do not hand-edit |
| Generated help manifest | `frontend/help/manifest.json` | Generated; do not hand-edit |
| Generated help assets | `frontend/help/assets/` | Generated; do not hand-edit |
| Live deployed help output | `/opt/otp-relay/frontend/help/` | Synced by the Pi runner; do not hand-edit |
| Wizard behavior/loading logic | `frontend/app.jsx` | Edit only for UI behavior changes |
| Wizard styling/layout | `frontend/style.css` | Edit only for design changes |
| Help Docs deployment workflow | `.github/workflows/deploy-help-docs.yml` | Runs automatically on matching changes |

---

## 2. Automatic deployment flow

The normal deployment flow is:

```text
Maintainer edits docs/help/*.md or docs/help/assets/*
        ↓
Maintainer commits and pushes to main
        ↓
GitHub Actions triggers deploy-help-docs.yml
        ↓
Self-hosted Raspberry Pi runner checks out the repo
        ↓
Runner installs/uses Python build dependencies
        ↓
Runner runs python3 scripts/build_help_docs.py
        ↓
Build generates frontend/help/wizard-guide.json, manifest, rendered docs, and assets
        ↓
Runner syncs frontend/help/ to /opt/otp-relay/frontend/help/
        ↓
Live portal serves /help/wizard-guide.json and /help/assets/*
```

Maintainers should not normally run deployment commands on the Pi after a docs-only change. Push the change and let the runner execute the workflow.

---

## 3. Workflow trigger paths

The Help Docs / RTA Wizard guide workflow should trigger when these files change:

```yaml
on:
  push:
    branches: [ main ]
    paths:
      - "docs/help/**"
      - "scripts/build_help_docs.py"
      - ".github/workflows/deploy-help-docs.yml"
  workflow_dispatch:
```

This ensures that guide text, screenshot changes, build-script changes, and workflow changes are deployed by the self-hosted runner.

If `frontend/app.jsx` or `frontend/style.css` changes, that is application/UI code and should be handled by the application deployment workflow, not by the Help Docs-only workflow.

---

## 4. Wizard block syntax

Each wizard step should receive only the content relevant to that step. Do not map a whole long markdown page to multiple wizard steps.

Use explicit blocks:

```md
<!-- wizard:account_creation -->
## RTA account creation

This is an admin-owned waiting step.

1. Jathin applies for your RTA account in the RTA system.
2. Wait until Jathin confirms that the account has been created.
3. The expected username format is `IITS_*USERNAME*`.
<!-- /wizard -->
```

A block can map to more than one step:

```md
<!-- wizard:vpn_request install_vpn -->
## Renewal path

Renew VPN / RDP / SFTP / PAM access before the 90-day expiry.
<!-- /wizard -->
```

The heading inside the block becomes the wizard overlay tab title.

---

## 5. Current wizard step IDs

Use these IDs in `<!-- wizard:... -->` blocks:

| Wizard step ID | Portal step |
|---|---|
| `form` | Submit the RTA Access Form |
| `account_creation` | RTA Account Creation |
| `save_iits` | Save Your IITS Username |
| `adm_request` | Request ADM Account & PAM Onboarding |
| `save_adm` | Save Your ADM Username |
| `password_reset` | Reset RTA Passwords |
| `oracle_auth` | Configure Oracle Authenticator |
| `vpn_request` | Request VPN / PAM / SFTP Access |
| `email_support` | Email RTA IT Support |
| `install_vpn` | Install Ivanti and Test Access |

---

## 6. Generated files

`scripts/build_help_docs.py` generates:

```text
frontend/help/manifest.json
frontend/help/rendered/*.html
frontend/help/assets/*
frontend/help/wizard-guide.json
```

The rendered HTML pages are optional reference/fallback docs.

The live wizard overlay uses `frontend/help/wizard-guide.json` after it is deployed and served as:

```text
/help/wizard-guide.json
```

Generated files should not be hand-edited. Any manual change under `frontend/help/` or `/opt/otp-relay/frontend/help/` can be overwritten by the next runner deployment.

---

## 7. Screenshot rules

All source screenshots must live in:

```bash
docs/help/assets/
```

Reference screenshots inside markdown like this:

```md
![VPN request form](assets/vpn-request-form-details.png)
```

The build rewrites that path to:

```text
/help/assets/vpn-request-form-details.png
```

Do not manually maintain screenshots in:

```text
frontend/help/assets/
/opt/otp-relay/frontend/help/assets/
```

Those are generated/deployed outputs and may be overwritten.

---

## 8. Day-to-day maintainer workflow

### Update wizard guide wording

1. Edit the relevant `docs/help/*.md` file.
2. Keep the content inside the correct `<!-- wizard:step_id -->` block.
3. Commit and push to `main`.
4. Wait for the Pi self-hosted runner to complete the Help Docs workflow.
5. Refresh the portal and open the RTA Wizard guide.

No manual `build_help_docs.py`, `deploy_portal_ui.py`, or `systemctl restart` is normally required for markdown-only guide updates.

### Add or replace a screenshot

1. Add the image to `docs/help/assets/`.
2. Reference it from the relevant markdown block using `assets/<filename>`.
3. Commit and push to `main`.
4. Wait for the Pi runner workflow to complete.

Keep screenshot filenames stable when possible. If a filename changes, update every markdown reference that uses it.

### Change overlay behavior

Edit:

```bash
frontend/app.jsx
```

Only do this for behavior/loading/interaction changes, such as guide drag behavior, keyboard shortcuts, JSON loading, or link handling.

Application-code changes should be deployed by the application deployment/update pipeline, not by the Help Docs-only workflow.

### Change overlay design

Edit:

```bash
frontend/style.css
```

Only do this for layout/design changes, such as floating guide sizing, tab spacing, screenshot grid layout, or responsive behavior.

Application-style changes should be deployed by the application deployment/update pipeline, not by the Help Docs-only workflow.

---

## 9. Local test commands

Use these commands only when testing locally or diagnosing a failed workflow.

Build generated output locally:

```bash
python3 scripts/build_help_docs.py
python3 -m json.tool frontend/help/wizard-guide.json >/dev/null
```

Inspect generated wizard content:

```bash
python3 -m json.tool frontend/help/wizard-guide.json | less
```

Confirm maintainer/reference text is not leaking into the wizard:

```bash
grep -R "source of truth" frontend/help/wizard-guide.json || true
grep -R "frontend/app.jsx is the source" frontend/help/wizard-guide.json || true
grep -R "floating guide overlay is generated" frontend/help/wizard-guide.json || true
```

Those commands should not return user-facing wizard content.

---

## 10. Live verification on the Pi

After the GitHub Actions workflow completes, verify the live portal output from the Pi:

```bash
curl -s -o /dev/null -w "wizard=%{http_code}\n" http://127.0.0.1:8000/help/wizard-guide.json
curl -s -o /dev/null -w "manifest=%{http_code}\n" http://127.0.0.1:8000/help/manifest.json
curl -s -o /dev/null -w "asset=%{http_code}\n" http://127.0.0.1:8000/help/assets/<filename>
```

Check the live deployed files:

```bash
ls -R /opt/otp-relay/frontend/help
python3 -m json.tool /opt/otp-relay/frontend/help/wizard-guide.json >/dev/null
```

Check the runner workspace if the live output does not match the repo:

```bash
ls -R ~/actions-runner/_work/otp-relay-pi-os/otp-relay-pi-os/frontend/help
```

---

## 11. Workflow verification

Check the GitHub Actions run first. A successful docs deployment should show steps equivalent to:

```text
Checkout repo
Use system Python
Install build dependencies
Build help docs and wizard guide
Confirm generated files
Sync built help output to live portal
```

The workflow should sync generated output with a command equivalent to:

```bash
rsync -rltvz --delete --no-group --no-owner frontend/help/ /opt/otp-relay/frontend/help/
```

`--delete` is intentional. It keeps the live `/help/` folder identical to the generated output, removing stale renamed files and old screenshots.

---

## 12. Permissions required for runner deployment

The runner user, normally `initbox`, must be able to write into:

```bash
/opt/otp-relay/frontend/help/
```

If the workflow fails with `Permission denied`, `Operation not permitted`, or `rsync error code 23`, restore permissions:

```bash
sudo chown -R initbox:initbox /opt/otp-relay/frontend/help
find /opt/otp-relay/frontend/help -type d -exec chmod 755 {} \;
find /opt/otp-relay/frontend/help -type f -exec chmod 644 {} \;
```

Then re-run the workflow from GitHub Actions.

---

## 13. Troubleshooting

### Markdown changed but wizard text did not change

Check:

1. The edit is inside the correct `<!-- wizard:step_id -->` block.
2. The change was pushed to `main`.
3. The Help Docs workflow ran and completed successfully.
4. `frontend/help/wizard-guide.json` in the runner workspace contains the change.
5. `/opt/otp-relay/frontend/help/wizard-guide.json` contains the change.
6. The browser is not serving cached content.

### Admin-owned steps show a long onboarding checklist

Cause: a whole markdown document was mapped into a step instead of using a narrow wizard block.

Fix:

1. Move step-specific content into an explicit block such as `<!-- wizard:account_creation -->`.
2. Keep only the admin-waiting content in that block.
3. Rebuild locally or push to let the runner rebuild.
4. Confirm `frontend/help/wizard-guide.json` no longer contains broad onboarding headings such as `High-level process` under admin-owned steps.

### Screenshot changed but portal still shows the old image

Check:

1. The new image is committed under `docs/help/assets/`.
2. The markdown references the correct `assets/<filename>`.
3. The workflow copied it into `frontend/help/assets/`.
4. The workflow synced it into `/opt/otp-relay/frontend/help/assets/`.
5. The browser cache is cleared or the filename was changed intentionally.

### Generated JSON is invalid

Run:

```bash
python3 scripts/build_help_docs.py
python3 -m json.tool frontend/help/wizard-guide.json >/dev/null
```

If invalid, inspect the markdown block that was edited most recently.

### Runner shows Offline in GitHub

Check the runner service on the Pi:

```bash
sudo systemctl status actions.runner.*.service
sudo journalctl -u actions.runner.*.service -n 50
```

Restart if needed:

```bash
sudo systemctl restart actions.runner.*.service
```

Then re-run the workflow from GitHub Actions.

---

## 14. Important rules

- Maintainers normally edit only `docs/help/*.md` and `docs/help/assets/*` for guide content updates.
- Use `<!-- wizard:step_id -->` blocks for user-facing wizard content.
- Do not map one long document into several wizard steps unless the whole document is actually relevant to every mapped step.
- Do not put maintainer instructions, deployment notes, or source-of-truth explanations inside wizard blocks.
- `00-overview.md` should remain reference-only unless it contains user-facing onboarding content.
- Do not hand-edit `frontend/help/wizard-guide.json`, `frontend/help/manifest.json`, `frontend/help/rendered/*`, or `frontend/help/assets/*`.
- Do not hand-edit `/opt/otp-relay/frontend/help/*`; it is runner-deployed output.
- Edit `frontend/app.jsx` only for guide behavior/loading changes.
- Edit `frontend/style.css` only for guide layout/design changes.

---

## 15. Summary

For normal guide updates:

```text
Edit docs/help/*.md and docs/help/assets/*
        ↓
Push to main
        ↓
Pi self-hosted runner rebuilds help output
        ↓
Runner syncs frontend/help/ to /opt/otp-relay/frontend/help/
        ↓
Portal reads /help/wizard-guide.json and /help/assets/*
```

Manual commands are for local validation and troubleshooting. The production Help Docs / RTA Wizard guide deployment is runner-driven.
