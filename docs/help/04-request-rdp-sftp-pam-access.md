---
title: Request RDP, SFTP and PAM Access
section: Access Requests
order: 4
slug: request-rdp-sftp-pam-access
---

# Request access for RDP, SFTP and PAM

<!-- wizard:vpn_request -->
## Portal path

1. Log in to the **RTA Automation Portal**.
2. Type **VPN** in the search box and click **Search**.
3. Click **Apply** under **VPN Access Request**.
4. Choose **New VPN Access**.
5. Fill in the required form fields.
6. Add the required applications and services.
7. Attach a copy of your INIT ID card.
8. Submit the request and note the request ID.

![Search for VPN in the RTA Automation Portal](assets/vpn-search-request.png)

![Apply button under VPN Access Request](assets/vpn-apply-request.png)

![Select New VPN Access](assets/vpn-new-vpn-access.png)

![VPN request form details](assets/vpn-request-form-details.png)
<!-- /wizard -->

<!-- wizard:vpn_request -->
## Applications to request

Add these application/service entries to the VPN access request.

### RDP

- Application / Service Name: `RDP`
- IP Address / URL: `10.11.174.10` and `10.11.174.21`
- RDP Port: `3389`
- Note: `AVM Nextgen migration project system access. Risk ID: RSP-10378`

### PAM

- Application / Service Name: `PAM`
- IP Address / URL: `10.11.125.14:443`
- Port Number: leave blank

### SSH / SFTP

- Application / Service Name: `SSH`
- IP Address / URL: `10.11.174.40`
- Port Number: `122`
- Note: `SFTP Server. Risk ID: RSK-10378`

![Add PAM application or service](assets/vpn-add-pam-service.png)

![Add SSH or SFTP application or service](assets/vpn-add-ssh-service.png)
<!-- /wizard -->
