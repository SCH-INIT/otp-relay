#!/usr/bin/env bash
# deploy_users.sh — update the user list without restarting the service
# Usage: sudo bash /opt/otp-relay/deploy_users.sh

set -euo pipefail

SRC="/opt/otp-relay/users.xlsx"
DEST="/opt/otp-relay/data/users.xlsx"

[[ "$EUID" -ne 0 ]] && { echo "✗  Run with sudo"; exit 1; }
[[ ! -f "$SRC"  ]] && { echo "✗  File not found: $SRC"; exit 1; }

echo "→  Copying $SRC → $DEST"
cp "$SRC" "$DEST"
chown otprelay:otprelay "$DEST"
chmod 600 "$DEST"
echo ""
ls -lh "$DEST"
echo ""

echo "→  Reloading user list..."
RELOAD=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/admin/reload-users)

if [[ "$RELOAD" == "200" ]]; then
  COUNT=$(curl -s http://localhost:8000/admin/users | python3 -c 'import sys,json; print(json.load(sys.stdin)["count"])')
  echo "✓  Done — $COUNT users now active"
else
  echo "⚠  Could not auto-reload (HTTP $RELOAD). Restart manually: sudo systemctl restart otp-relay"
fi
