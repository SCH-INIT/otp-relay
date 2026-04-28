---
title: RTA Servers Access Guide
section: Overview
order: 0
slug: overview
---

# RTA Servers Access Guide

The primary user-facing guide is now the **RTA Wizard** inside the portal.

The generated Help pages remain as reference/fallback material and as the source pipeline for screenshots served under `/help/assets/`.

For normal users, keep the RTA Wizard instructions in `frontend/app.jsx` aligned with these reference notes.

## Current user-facing flow

1. Open the portal.
2. Go to **RTA Wizard**.
3. Use **View guide** on each wizard step.
4. Follow the floating guide overlay without leaving the wizard.

## Reference topics

These generated pages can still be used as source/reference material:

- New user onboarding
- Reset RTA account password
- Configure Oracle Authenticator
- Request access for RDP, SFTP, and PAM
- Download and install the RTA VPN
- Renew VPN / RDP / SFTP / PAM access
- Download and install WinSCP
- How to use PAM
- Create a ticket for RTA IT Support
- Terminal Server access guide
- Important notes and tips

## Maintainers

Keep this page brief. Put detailed reference steps in the topic pages and keep screenshots in `docs/help/assets/`.

For user-facing wizard text, update `frontend/app.jsx`.
For wizard screenshots, add or replace images in `docs/help/assets/`, rebuild the generated output, and reference the files from `frontend/app.jsx` using `/help/assets/<filename>`.
