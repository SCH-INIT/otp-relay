from __future__ import annotations

import hashlib
import py_compile
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIVE_ROOT = Path("/opt/otp-relay")

# Cautious allowlist for application runtime code only.
# Phase 2 intentionally excludes nginx/, systemd/, shell installers, and docs.
DEPLOY_TARGETS = [
    {
        "source": Path("main.py"),
        "dest": Path("main.py"),
        "service": "otp-relay.service",
    },
    {
        "source": Path("monitor.py"),
        "dest": Path("monitor.py"),
        "service": "otp-monitor.service",
    },
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def files_differ(src: Path, dst: Path) -> bool:
    if not dst.exists():
        return True
    return sha256_file(src) != sha256_file(dst)


def validate_python_file(path: Path) -> None:
    py_compile.compile(str(path), doraise=True)


def copy_if_changed(src: Path, dst: Path) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not files_differ(src, dst):
        return False
    shutil.copy2(src, dst)
    return True


def restart_service(service_name: str) -> None:
    subprocess.run(
        ["sudo", "systemctl", "restart", service_name],
        check=True,
    )
   
def main() -> None:
    changed_services: set[str] = set()
    changed_files: list[str] = []

    # Validate all candidate source files before touching live files.
    for item in DEPLOY_TARGETS:
        src = ROOT / item["source"]
        if not src.exists():
            raise FileNotFoundError(f"Source file missing: {src}")
        validate_python_file(src)

    for item in DEPLOY_TARGETS:
        src = ROOT / item["source"]
        dst = LIVE_ROOT / item["dest"]

        if copy_if_changed(src, dst):
            changed_files.append(item["source"].as_posix())
            changed_services.add(item["service"])

    if not changed_files:
        print("No application code changes detected.")
        return

    print("Updated files:")
    for rel_path in changed_files:
        print(f" - {rel_path}")

    print("Restarting services:")
    for service in sorted(changed_services):
        print(f" - {service}")
        restart_service(service)

    print("Deployment completed successfully.")


if __name__ == "__main__":
    main()
