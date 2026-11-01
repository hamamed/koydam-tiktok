#!/usr/bin/env bash
# Reset a password if you are locked out.
# Usage:  sudo bash /opt/koydam-tiktok/deploy/reset-password.sh                        (owner, random password)
#         sudo bash /opt/koydam-tiktok/deploy/reset-password.sh 'MyNewPass123'         (owner, this password)
#         sudo bash /opt/koydam-tiktok/deploy/reset-password.sh 'MyNewPass123' user@x.com  (a specific user)
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/koydam-tiktok}"
USERS="$APP_DIR/data/users.json"
[[ -f "$USERS" ]] || { echo "Not found: $USERS (start the server once first)"; exit 1; }
NEWPW="${1:-$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")}"
NEWPW="$NEWPW" USERS="$USERS" WHO="${2:-}" node -e '
  const fs = require("fs"), crypto = require("crypto");
  const list = JSON.parse(fs.readFileSync(process.env.USERS, "utf8"));
  const who = String(process.env.WHO || "").trim().toLowerCase();
  const u = who ? list.find((x) => x.email === who) : list.find((x) => x.role === "owner");
  if (!u) { console.error("User not found: " + (who || "(owner)")); process.exit(1); }
  const salt = crypto.randomBytes(16).toString("hex");
  u.password = { salt, hash: crypto.scryptSync(process.env.NEWPW, salt, 64).toString("hex") };
  u.mustChangePassword = true; u.disabled = false;
  fs.writeFileSync(process.env.USERS, JSON.stringify(list, null, 2), { mode: 0o600 });
  console.log("Login reset:  " + u.email + "  /  " + process.env.NEWPW + "   (" + u.role + ")");
'
systemctl restart koydam-tiktok 2>/dev/null || true
