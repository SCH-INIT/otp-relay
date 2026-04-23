---
title: Request RDP, SFTP and PAM Access
section: Access Requests
order: 4
slug: request-rdp-sftp-pam-access
---

# Request access for RDP, SFTP and PAM

## Steps

1. Log in to the **RTA Automation Portal**.
2. Search for **VPN**.
3. Click **Apply** under **VPN Access Request**.
4. Choose **New VPN Access**.
5. Fill in the required form fields.
6. Add the required applications and services.

## Application / service entries

### RDP
- Name: `RDP`
- IP / URL: `10.11.174.10` and `10.11.174.21`
- Port: `3389`
- Note: `AVM Nextgen migration project system access. Risk ID: RSP-10378`

### PAM
- Name: `PAM`
- IP / URL: `10.11.125.14:443`
- Port: blank

### SSH / SFTP
- Name: `SSH`
- IP / URL: `10.11.174.40`
- Port: `122`
- Note: `SFTP Server. Risk ID: RSK-10378`

## Attachments

- Attach a copy of your INIT ID card.

## Screenshots

### Search and open the request

![Search for VPN in the RTA Automation Portal](assets/vpn-search-request.png)

![Apply button under VPN Access Request](assets/vpn-apply-request.png)

### Start a new VPN access request

![Select New VPN Access](assets/vpn-new-vpn-access.png)

![VPN request form details](assets/vpn-request-form-details.png)

### Add PAM and SSH services

![Add PAM application or service](assets/vpn-add-pam-service.png)

![Add SSH or SFTP application or service](assets/vpn-add-ssh-service.png)
