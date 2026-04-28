# Help and wizard guide assets

Place screenshots and images for the RTA Wizard guide overlay and optional generated Help pages in this folder.

These assets are copied into `frontend/help/assets/` by `scripts/build_help_docs.py` and are served by the portal from:

```text
/help/assets/<filename>
```

The RTA Wizard floating guide overlay in `frontend/app.jsx` also uses these files directly through `/help/assets/<filename>`.

## When adding or replacing wizard screenshots

1. Add the source PNG here.
2. Rebuild with:

   ```bash
   python3 scripts/build_help_docs.py
   ```

3. Reference the generated asset from `frontend/app.jsx` using:

   ```js
   '/help/assets/<filename>'
   ```

4. Do not manually edit or copy files into `frontend/help/assets/`; that folder is generated and may be overwritten.

## Suggested filenames

- otp-claim-slot.png
- otp-waiting-room.png
- otp-code-visible.png
- oracle-auth-qr.png
- vpn-search.png
- vpn-apply.png
- vpn-new-access.png
- vpn-form.png
- vpn-add-rdp.png
- vpn-add-pam.png
- vpn-add-ssh.png
- ivanti-add-connection.png
- renew-vpn-search.png
- renew-vpn-apply.png
- renew-vpn-extension.png
- renew-vpn-form.png
- winscp-login.png
- pam-search-account.png
- pam-psm-rdp.png
- helpdesk-section.png
- helpdesk-form.png
- terminal-browser-login.png
- terminal-browser-rdp-login.png
- terminal-browser-desktop.png
- terminal-rdp-client.png
- terminal-xorg-login.png
