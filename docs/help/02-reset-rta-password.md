---
title: Reset RTA Password
section: Accounts & Authentication
order: 2
slug: reset-rta-password
---

# Reset RTA account password

<!-- wizard:password_reset -->
## Password reset overview

Reset the password for the available RTA accounts:

- `IITS_*USERNAME*`
- `ADM_*USERNAME*`, once the ADM account exists

Important notes:

1. The RTA password reset link works only inside the UAE region.
2. If you are outside the UAE, connect through the Terminal Server first.
3. Open the OTP Relay portal before triggering any OTP from the RTA website.
4. Continue with Oracle Authenticator setup immediately after the password reset.
<!-- /wizard -->

<!-- wizard:password_reset -->
## OTP Relay sequence

1. Open the OTP Relay portal in a new browser tab.
2. Enter your INIT 2 or 3 character token.
3. Claim your OTP slot.
4. If you see a waiting room, wait. Do not request the OTP on the RTA page yet.
5. When the OTP portal says to trigger the OTP, switch to the RTA tab immediately.
6. Enter your RTA username, such as `IITS_*`, and request the OTP.
7. The code should arrive in the relay portal within seconds.
8. Enter the OTP on the RTA page and click **Verify**.

Do not trigger the OTP on the RTA website until the OTP Relay portal tells you to do so.
<!-- /wizard -->

<!-- wizard:password_reset -->
## Password rules

Use a strong password that follows the RTA requirements:

1. Length must exceed 10 characters.
2. Include at least one number, one uppercase letter, and one special character.
3. Do not include first name, last name, employee ID, or obvious words.
4. Do not reuse the last three passwords.
5. Avoid dictionary words.
6. Do not include month names, year names, weekday names, or country names.
7. Avoid sequences such as `123`, `456`, `abc`, or `xyz`.
8. Avoid repeated numbers or repeated character sequences such as `111` or `aaa`.
9. Keep the password complex and unique.

Example dummy formats from the original guide:

- `CzrTNQ@210`
- `KzrTEQ@348`
<!-- /wizard -->
