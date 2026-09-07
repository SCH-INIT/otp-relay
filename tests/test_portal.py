import json
import tempfile
import unittest
from collections import deque
from datetime import timedelta
from io import BytesIO
from pathlib import Path

import openpyxl
from fastapi.testclient import TestClient

import main


class PortalRegressionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        data_dir = Path(self.temp_dir.name)

        main.DATA_DIR = data_dir
        main.AUTH_FILE = data_dir / "admin_auth.json"
        main.CONFIG_FILE = data_dir / "admin_config.json"
        main.ADMIN_PROFILES_FILE = data_dir / "admin_profiles.json"
        main.LEGACY_WIZARD_FILE = data_dir / "wizard_progress.json"
        main.USERS_EXCEL_PATH = str(data_dir / "users.xlsx")
        main.AUDIT_LOG_PATH = str(data_dir / "audit.log")
        main.redis_client = None

        main.users.clear()
        main.users.update(
            {
                "SCH": {"token": "SCH", "name": "Christian", "email": "sch@example.com"},
                "USR": {"token": "USR", "name": "Regular User", "email": "usr@example.com"},
                "TWO": {"token": "TWO", "name": "Second User", "email": "two@example.com"},
            }
        )
        main.claim_queue = deque()
        main.pending_otps.clear()
        main.ADMIN_SESSIONS.clear()
        main.ADMIN_LOGIN_ATTEMPTS.clear()
        main.ADMIN_RESET_CODES.clear()
        main._write_json(main.CONFIG_FILE, {"admin_tokens": ["SCH", "AMD"]})

        self.client = TestClient(main.app)

    def tearDown(self):
        self.temp_dir.cleanup()

    def setup_admin(self, token="SCH", pin="1234"):
        response = self.client.post(
            "/admin/auth/setup",
            json={"token": token, "credential": pin},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["session"]

    def test_otp_queue_delivery_and_admin_log(self):
        session = self.setup_admin()

        login = self.client.post("/user/login", json={"token": "USR"})
        self.assertEqual(login.status_code, 200)
        self.assertNotIn("requires_pin", login.json())

        first = self.client.post("/claim-otp", json={"token": "USR"})
        second = self.client.post("/claim-otp", json={"token": "TWO"})
        self.assertEqual((first.json()["position"], second.json()["position"]), (1, 2))

        queue = self.client.get("/admin/queue", headers={"X-Admin-Session": session})
        self.assertEqual([row["token"] for row in queue.json()["queue"]], ["USR", "TWO"])

        rejected = self.client.post(
            "/sms-received",
            headers={"X-Secret-Token": "wrong"},
            json={"body": "Your OTP is 654321"},
        )
        self.assertEqual(rejected.status_code, 401)

        delivered = self.client.post(
            "/sms-received",
            headers={"X-Secret-Token": main.SMS_SECRET_TOKEN},
            json={"body": "Your OTP is 654321"},
        )
        self.assertEqual(delivered.status_code, 200)
        self.assertEqual(delivered.json()["recipient"], "Regular User")

        status = self.client.get("/claim-status/USR")
        self.assertEqual(status.json()["status"], "delivered")
        self.assertEqual(status.json()["otp"], "654321")

        queue = self.client.get("/admin/queue", headers={"X-Admin-Session": session})
        self.assertEqual([row["token"] for row in queue.json()["queue"]], ["TWO"])

        cancelled = self.client.delete("/claim-otp/TWO")
        self.assertEqual(cancelled.status_code, 200)
        self.assertEqual(
            self.client.get("/admin/queue", headers={"X-Admin-Session": session}).json()["queue"],
            [],
        )

        self.client.post("/claim-otp", json={"token": "TWO"})
        main.claim_queue[0]["claimed_at"] -= timedelta(seconds=main.CLAIM_EXPIRY_SEC + 1)
        expired = self.client.get("/claim-status/TWO")
        self.assertEqual(expired.json()["status"], "idle_expired")

        log = self.client.get("/admin/log", headers={"X-Admin-Session": session})
        events = {row["event"] for row in log.json()["entries"]}
        self.assertTrue(
            {
                "claim_queued",
                "claim_cancelled",
                "claim_expired",
                "sms_rejected",
                "sms_received",
                "otp_delivered",
            }.issubset(events)
        )
        self.assertNotIn("654321", Path(main.AUDIT_LOG_PATH).read_text(encoding="utf-8"))

    def test_admin_profile_is_private_and_migrates_only_retained_fields(self):
        main.LEGACY_WIZARD_FILE.write_text(
            json.dumps(
                {
                    "SCH": {
                        "display_name": "Chris",
                        "iits_username": "IITS_CHRIS",
                        "adm_username": "ADM_CHRIS",
                        "iits_pw_date": "2026-08-18T00:00:00Z",
                        "adm_pw_date": None,
                        "vpn_date": "2026-07-22T00:00:00Z",
                        "completed": ["legacy-step"],
                    },
                    "USR": {"iits_username": "MUST_NOT_MIGRATE"},
                }
            ),
            encoding="utf-8",
        )
        session = self.setup_admin()

        self.assertEqual(self.client.get("/admin/profile").status_code, 401)
        profile = self.client.get("/admin/profile", headers={"X-Admin-Session": session})
        self.assertEqual(profile.status_code, 200, profile.text)
        self.assertEqual(profile.json()["iits_username"], "IITS_CHRIS")

        stored = json.loads(main.ADMIN_PROFILES_FILE.read_text(encoding="utf-8"))
        self.assertIn("SCH", stored)
        self.assertNotIn("USR", stored)
        self.assertNotIn("completed", stored["SCH"])

        saved = self.client.post(
            "/admin/profile",
            headers={"X-Admin-Session": session},
            json={
                "display_name": "Christian",
                "iits_username": "IITS_SCH",
                "adm_username": "ADM_SCH",
                "iits_pw_date": "2026-09-01T00:00:00Z",
                "adm_pw_date": "2026-09-02T00:00:00Z",
                "vpn_date": "2026-09-03T00:00:00Z",
            },
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["token"], "SCH")
        self.assertNotIn("password", main.ADMIN_PROFILES_FILE.read_text(encoding="utf-8").lower())

    def test_admin_pin_reset_peer_reset_and_config_remain_available(self):
        session = self.setup_admin()
        main.users["AMD"] = {"token": "AMD", "name": "Amer", "email": "amd@example.com"}
        self.setup_admin("AMD", "5678")

        wrong_login = self.client.post(
            "/admin/auth/login",
            json={"token": "SCH", "credential": "wrong"},
        )
        self.assertEqual(wrong_login.status_code, 401)
        login = self.client.post(
            "/admin/auth/login",
            json={"token": "SCH", "credential": "1234"},
        )
        self.assertEqual(login.status_code, 200, login.text)
        login_session = login.json()["session"]
        self.assertEqual(
            self.client.post(
                "/admin/auth/logout",
                headers={"X-Admin-Session": login_session},
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(
                "/admin/log",
                headers={"X-Admin-Session": login_session},
            ).status_code,
            401,
        )

        reset_request = self.client.post("/admin/auth/reset-request", json={"token": "SCH"})
        self.assertEqual(reset_request.status_code, 200, reset_request.text)
        reset_code = main.ADMIN_RESET_CODES["SCH"]["code"]
        reset_confirm = self.client.post(
            "/admin/auth/reset-confirm",
            json={"token": "SCH", "credential": reset_code},
        )
        self.assertEqual(reset_confirm.status_code, 200, reset_confirm.text)

        needs_setup = self.client.post("/user/login", json={"token": "SCH"})
        self.assertTrue(needs_setup.json()["requires_pin"])
        self.assertTrue(needs_setup.json()["needs_setup"])

        peer_reset = self.client.post(
            "/admin/auth/reset-peer",
            headers={"X-Admin-Session": session},
            json={"token": "AMD"},
        )
        self.assertEqual(peer_reset.status_code, 200, peer_reset.text)

        config = self.client.get("/admin/config", headers={"X-Admin-Session": session})
        self.assertEqual(config.status_code, 200)
        self.assertEqual(config.json()["admin_tokens"], ["SCH", "AMD"])

    def test_removed_admin_cannot_keep_or_reopen_admin_access(self):
        session = self.setup_admin()

        changed = self.client.post(
            "/admin/config",
            headers={"X-Admin-Session": session},
            json={"admin_tokens": ["AMD"]},
        )
        self.assertEqual(changed.status_code, 200, changed.text)

        old_session = self.client.get(
            "/admin/log",
            headers={"X-Admin-Session": session},
        )
        self.assertEqual(old_session.status_code, 403, old_session.text)

        direct_login = self.client.post(
            "/admin/auth/login",
            json={"token": "SCH", "credential": "1234"},
        )
        self.assertEqual(direct_login.status_code, 401, direct_login.text)

    def test_xlsx_upload_and_removed_routes(self):
        session = self.setup_admin()
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.append(["Token", "Name", "Email"])
        sheet.append(["NEW", "New User", "new@example.com"])
        content = BytesIO()
        workbook.save(content)

        uploaded = self.client.post(
            "/admin/users/upload",
            headers={"X-Admin-Session": session},
            files={"file": ("users.xlsx", content.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        self.assertEqual(uploaded.json()["users_loaded"], 1)
        status = self.client.get("/admin/users/status", headers={"X-Admin-Session": session})
        self.assertEqual(status.status_code, 200)
        self.assertTrue(status.json()["exists"])
        reloaded = self.client.post("/admin/reload-users", headers={"X-Admin-Session": session})
        self.assertEqual(reloaded.status_code, 200, reloaded.text)
        self.assertEqual(reloaded.json()["users_loaded"], 1)
        users = self.client.get("/admin/users", headers={"X-Admin-Session": session})
        self.assertEqual(users.json()["users"][0]["token"], "NEW")

        removed = (
            ("get", "/wizard/progress/SCH"),
            ("post", "/wizard/progress"),
            ("get", "/admin/wizard"),
            ("post", "/api/onboard/notify"),
            ("get", "/guide.html"),
        )
        for method, path in removed:
            response = self.client.post(path, json={}) if method == "post" else self.client.get(path)
            self.assertIn(response.status_code, (404, 405), f"{method.upper()} {path}: {response.text}")


if __name__ == "__main__":
    unittest.main()
