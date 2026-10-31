#!/usr/bin/env bash
# Update koydam-tiktok from GitHub (same as the "التحديثات" page in the panel).
# Usage: sudo bash /opt/koydam-tiktok/deploy/update.sh
set -Eeuo pipefail
APP_DIR="${APP_DIR:-/opt/koydam-tiktok}"
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)."; exit 1; }
[[ -d "$APP_DIR/.git" ]] || { echo "No git checkout in $APP_DIR. Run the install command from README."; exit 1; }
# The installer pulls the latest code, installs packages, builds and restarts. It keeps data/ and your nginx/HTTPS setup.
cd "$APP_DIR"
runuser -u tiktok -- git fetch --quiet origin
runuser -u tiktok -- git show "origin/$(runuser -u tiktok -- git rev-parse --abbrev-ref HEAD):deploy/install.sh" > /tmp/koydam-install.sh
exec env APP_DIR="$APP_DIR" bash /tmp/koydam-install.sh
