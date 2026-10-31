#!/usr/bin/env bash
# Reset the admin password if you are locked out.
# Usage:  sudo bash /opt/koydam-tiktok/deploy/reset-password.sh             (random password)
#         sudo bash /opt/koydam-tiktok/deploy/reset-password.sh 'MyNewPass123'
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/koydam-tiktok}"
SETTINGS="$APP_DIR/data/settings.json"
[[ -f "$SETTINGS" ]] || { echo "Not found: $SETTINGS"; exit 1; }
NEWPW="${1:-$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")}"
NEWPW="$NEWPW" SETTINGS="$SETTINGS" node -e '
  const fs = require("fs"), crypto = require("crypto");
  const s = JSON.parse(fs.readFileSync(process.env.SETTINGS, "utf8"));
  const salt = crypto.randomBytes(16).toString("hex");
  s.password = { salt, hash: crypto.scryptSync(process.env.NEWPW, salt, 64).toString("hex") };
  s.mustChangePassword = true;
  fs.writeFileSync(process.env.SETTINGS, JSON.stringify(s, null, 2), { mode: 0o600 });
  console.log("Admin login reset:  " + (s.adminEmail || "admin") + "  /  " + process.env.NEWPW);
'
systemctl restart koydam-tiktok 2>/dev/null || true
