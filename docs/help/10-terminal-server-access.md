---
title: Terminal Server Access
section: Terminal Server
order: 10
slug: terminal-server-access
---

# User Manual: Terminal Server Access Guide

System: Ubuntu Terminal Server (`srvterminal`)  
Internal IP: `172.31.10.82`

<!-- wizard:password_reset -->
## Terminal Server when outside UAE

Use the Terminal Server if the RTA password reset link does not open directly from your location.

### Method 1: Web browser access

1. Open Chrome, Edge, or Firefox.
2. Go to `https://srvterminal.init-db.lan`.
3. If the browser shows a security warning, choose **Advanced** and continue to the site.
4. At the first login screen, use the local terminal account:
   - Username: `admin`
   - Password: `adminINIT+971`
5. After login, you are redirected to the RDP login page.
6. Enter your token and Active Directory credentials, for example `INIT\ABC`.
7. The Ubuntu desktop opens directly in the browser.
8. Open the RTA password reset link inside that remote browser session.

![Guacamole login page in the browser](assets/terminal-browser-login.png)

![Browser-based RDP login page after the first terminal server login](assets/terminal-browser-rdp-login.png)

![Ubuntu desktop opened directly in the browser](assets/terminal-browser-desktop.png)
<!-- /wizard -->

<!-- wizard:password_reset -->
## Standard Windows RDP option

Use this method if you prefer Windows Remote Desktop Connection.

1. Press the Windows key and open **Remote Desktop Connection**.
2. In the **Computer** field, enter `172.31.10.82` or `srvterminal`.
3. Click **Connect**.
4. At the login prompt, ensure the session is set to **Xorg**.
5. Enter your domain username and password.
6. Click **OK**.
7. Open the RTA password reset link inside the remote session.

![Remote Desktop Connection client with the terminal server target](assets/terminal-rdp-client.png)

![Xorg login prompt for the terminal server session](assets/terminal-xorg-login.png)

![Ubuntu desktop after connecting through Windows RDP](assets/terminal-rdp-desktop.png)
<!-- /wizard -->
