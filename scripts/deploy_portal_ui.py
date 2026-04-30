from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIVE_ROOT = Path("/opt/otp-relay")

# Explicit allowlist for safe UI-only deployment.
ALLOWED_FILES = [
    Path("frontend/app.jsx"),
    Path("frontend/index.html"),
    Path("frontend/style.css"),
    Path("frontend/guide.html"),
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


def copy_if_changed(src: Path, dst: Path) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not files_differ(src, dst):
        return False
    shutil.copy2(src, dst)
    return True


def main() -> None:
    changed: list[str] = []

    for rel_path in ALLOWED_FILES:
        src = ROOT / rel_path
        dst = LIVE_ROOT / rel_path

        if not src.exists():
            raise FileNotFoundError(f"Source file missing: {src}")

        if copy_if_changed(src, dst):
            changed.append(rel_path.as_posix())

    if changed:
        print("Updated files:")
        for item in changed:
            print(f" - {item}")
    else:
        print("No UI file changes detected.")


if __name__ == "__main__":
    main()
