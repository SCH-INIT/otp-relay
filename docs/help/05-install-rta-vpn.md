---
title: Install RTA VPN
section: Access Requests
order: 5
slug: install-rta-vpn
---

# Download and install RTA VPN (Ivanti Secure Access Client)

<!-- wizard:install_vpn -->
## Install Ivanti Secure Access Client

1. Download and install the Ivanti VPN client.
2. Open Ivanti Secure Access Client.
3. Click the **+** icon.
4. Enter the connection details:
   - Type: `Policy Secure (UAC)` or `Connect Secure (VPN)`
   - Name: `RTA VPN`
   - Server URL: `https://ettisal.rta.ae/vendors`
5. Click **Add**.
6. To connect, click **Connect**.

![Ivanti Secure Access Client add connection window](assets/ivanti-add-connection.png)
<!-- /wizard -->

<!-- wizard:install_vpn -->
## VPN authentication

The RTA VPN uses multi-factor authentication.

- First authentication: your RTA account `IITS_*USERNAME*` and password.
- Second authentication: the 6-digit TOTP configured in Oracle Authenticator.

Keep Oracle Authenticator available before testing VPN, PAM, or SFTP access.
<!-- /wizard -->
