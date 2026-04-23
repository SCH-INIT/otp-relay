#!/usr/bin/env python3

import filecmp
import subprocess
import sys
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
APP_ROOT = Path("/opt/otp-relay")
SYSTEMD_DIR = Path("/etc/systemd/system")
NGINX_TEMPLATE_DEST = APP_ROOT / "nginx" / "otp-relay.conf.template"
NGINX_RENDERED_DEST = Path("/etc/nginx/sites-available/otp-relay")

SHELL_FILES = [
    "install.sh",
    "update.sh",
    "deploy_users.sh",
    "setup_action-runner.sh",
]

SERVICE_FILES = [
    "systemd/otp-relay.service",
    "systemd/otp-monitor.service",
]

NGINX_FILES = [
    "nginx/otp-relay.conf.template",
]

SUDO = "sudo"
SYSTEMCTL = "/usr/bin/systemctl"
INSTALL = "/usr/bin/install"
NGINX = "/usr/sbin/nginx"


def ts():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(msg):
    print(f"[{ts()}] {msg}", flush=True)


def fail(msg, code=1):
    log(f"ERROR: {msg}")
    sys.exit(code)


def run(cmd, check=True):
    log(f"RUN: {' '.join(str(x) for x in cmd)}")
    subprocess.run([str(x) for x in cmd], check=check)


def file_changed(src: Path, dst: Path) -> bool:
    if not dst.exists():
        return True
    return not filecmp.cmp(src, dst, shallow=False)


def validate_shell_script(path: Path):
    log(f"Validating shell script: {path}")
    run(["bash", "-n", path])


def copy_with_sudo(src: Path, dst: Path):
    run([SUDO, "-n", INSTALL, "-m", "0644", src, dst])


def copy_executable_with_sudo(src: Path, dst: Path):
    run([SUDO, "-n", INSTALL, "-m", "0755", src, dst])


def render_nginx_template():
    if not NGINX_TEMPLATE_DEST.exists():
        fail(f"Nginx template not found at {NGINX_TEMPLATE_DEST}")

    cmd = (
        "set -euo pipefail; "
        "source /opt/otp-relay/.env; "
        ': "${SERVER_HOSTNAME:?SERVER_HOSTNAME is required}"; '
        ': "${SERVER_IP:?SERVER_IP is required}"; '
        "export SERVER_HOSTNAME SERVER_IP; "
        f"envsubst '${{SERVER_HOSTNAME}} ${{SERVER_IP}}' "
        f"< {NGINX_TEMPLATE_DEST} "
        "> /tmp/otp-relay.nginx.rendered; "
        f"{SUDO} -n {INSTALL} -m 0644 /tmp/otp-relay.nginx.rendered {NGINX_RENDERED_DEST}; "
        "rm -f /tmp/otp-relay.nginx.rendered"
    )
    run(["bash", "-lc", cmd])


def validate_nginx():
    run([SUDO, "-n", NGINX, "-t"])


def reload_nginx():
    run([SUDO, "-n", SYSTEMCTL, "reload", "nginx"])


def daemon_reload():
    run([SUDO, "-n", SYSTEMCTL, "daemon-reload"])


def restart_service(service_name: str):
    run([SUDO, "-n", SYSTEMCTL, "restart", service_name])
    run([SUDO, "-n", SYSTEMCTL, "is-active", "--quiet", service_name])
    log(f"Service is active: {service_name}")


def main():
    changed_shell = []
    changed_services = []
    changed_nginx = []

    log("Starting Phase 3 server config deployment")

    for rel in SHELL_FILES:
        src = REPO_ROOT / rel
        if not src.exists():
            fail(f"Missing source file: {src}")
        validate_shell_script(src)

    for rel in SHELL_FILES:
        src = REPO_ROOT / rel
        dst = APP_ROOT / rel
        if file_changed(src, dst):
            changed_shell.append((src, dst))

    for rel in SERVICE_FILES:
        src = REPO_ROOT / rel
        dst = SYSTEMD_DIR / Path(rel).name
        if not src.exists():
            fail(f"Missing source file: {src}")
        if file_changed(src, dst):
            changed_services.append((src, dst))

    for rel in NGINX_FILES:
        src = REPO_ROOT / rel
        dst = APP_ROOT / rel
        if not src.exists():
            fail(f"Missing source file: {src}")
        if file_changed(src, dst):
            changed_nginx.append((src, dst))

    if not changed_shell and not changed_services and not changed_nginx:
        log("No server config changes detected. Nothing to do.")
        return

    if changed_shell:
        log("Changed shell files:")
        for src, _ in changed_shell:
            log(f" - {src.relative_to(REPO_ROOT)}")

    if changed_services:
        log("Changed service files:")
        for src, _ in changed_services:
            log(f" - {src.relative_to(REPO_ROOT)}")

    if changed_nginx:
        log("Changed nginx files:")
        for src, _ in changed_nginx:
            log(f" - {src.relative_to(REPO_ROOT)}")

    for src, dst in changed_shell:
        copy_executable_with_sudo(src, dst)

    services_to_restart = []
    if changed_services:
        for src, dst in changed_services:
            copy_with_sudo(src, dst)
            services_to_restart.append(dst.name)

        daemon_reload()

    if changed_nginx:
        for src, dst in changed_nginx:
            copy_with_sudo(src, dst)

        render_nginx_template()
        validate_nginx()
        reload_nginx()
        log("Nginx configuration reloaded successfully")

    if services_to_restart:
        log("Restarting changed services:")
        for svc in services_to_restart:
            log(f" - {svc}")
            restart_service(svc)

    log("Phase 3 server config deployment completed successfully")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        fail(f"Command failed with exit code {e.returncode}: {' '.join(str(x) for x in e.cmd)}")
    except Exception as e:
        fail(str(e))
