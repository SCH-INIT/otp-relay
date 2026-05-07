---
title: Notes and Tips
section: Reference
order: 11
slug: notes-and-tips
---

# Notes and tips

<!-- wizard:install_vpn -->
## Usage and renewal tips

- When finished with the Ubuntu Terminal Server, use **Log Out** from the Ubuntu session. Do not just close the browser tab.
- For clipboard in browser-based Guacamole access, press `Ctrl + Alt + Shift` to open the Guacamole menu.
- The browser version resizes better when the browser window is maximized.
- VPN access, including RDP, SFTP, and PAM, expires after 90 days.
- RTA passwords also expire after 90 days.
- The system may not send reminders automatically.
- It can take roughly 2 to 3 weeks to obtain access to the RTA servers.
<!-- /wizard -->

<!-- wizard:install_vpn -->
## Test server and file-transfer flow

To connect to the test servers:

1. Connect to the RTA VPN.
2. Connect to the Jump Server through Remote Desktop.
3. From the Jump Server, connect to the required test server.

To copy files to the RTA environment:

1. Connect to the RTA VPN.
2. Use WinSCP from your local PC to connect to the RTA SFTP server.
3. Copy files from the local PC to the SFTP server.
4. Log in remotely to the target test or production server.
5. Use WinSCP on the remote side to connect to the SFTP server.
6. Copy files from the SFTP server to the target server.
<!-- /wizard -->
