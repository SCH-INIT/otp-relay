# OTP Relay Portal — Help Docs and RTA Wizard Guide Deployment

The RTA Wizard floating guide is markdown-driven.

Edit user-facing wizard guide content in:

```bash
docs/help/*.md
```

Put screenshots and images in:

```bash
docs/help/assets/
```

Then rebuild and deploy:

```bash
python3 scripts/build_help_docs.py
python3 scripts/deploy_portal_ui.py
sudo systemctl restart otp-relay
```

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
| Wizard behavior/loading logic | `frontend/app.jsx` | Edit only for UI behavior changes |
| Wizard styling/layout | `frontend/style.css` | Edit only for design changes |

---

## 2. Wizard block syntax

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

## 3. Current wizard step IDs

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

## 4. Generated files

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

---

## 5. Screenshot rules

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

## 6. Day-to-day update flow

### Update wizard guide wording

1. Edit the relevant `docs/help/*.md` file.
2. Keep the content inside the correct `<!-- wizard:step_id -->` block.
3. Run:

   ```bash
   python3 scripts/build_help_docs.py
   python3 scripts/deploy_portal_ui.py
   sudo systemctl restart otp-relay
   ```

### Add or replace a screenshot

1. Add the image to `docs/help/assets/`.
2. Reference it from the relevant markdown block using `assets/<filename>`.
3. Rebuild and deploy.

### Change overlay behavior

Edit:

```bash
frontend/app.jsx
```

Only do this for behavior/loading/interaction changes.

### Change overlay design

Edit:

```bash
frontend/style.css
```

Only do this for layout/design changes.

---

## 7. Verification commands

After build:

```bash
python3 scripts/build_help_docs.py
python3 -m json.tool frontend/help/wizard-guide.json >/dev/null
```

After deploy:

```bash
curl -s -o /dev/null -w "wizard=%{http_code}\n" http://127.0.0.1:8000/help/wizard-guide.json
curl -s -o /dev/null -w "app=%{http_code}\n" http://127.0.0.1:8000/app.jsx
curl -s -o /dev/null -w "css=%{http_code}\n" http://127.0.0.1:8000/style.css
```

To confirm maintainer/reference text is not leaking into the wizard:

```bash
grep -R "source of truth" frontend/help/wizard-guide.json || true
grep -R "frontend/app.jsx is the source" frontend/help/wizard-guide.json || true
```

Those commands should not return user-facing wizard content.

---

## 8. Important rule

Do not use `wizard_steps` to map one long document into several wizard steps unless the whole document is actually relevant to every mapped step.

Prefer explicit step blocks. This prevents admin-owned steps such as **RTA Account Creation** from showing the full onboarding checklist.
