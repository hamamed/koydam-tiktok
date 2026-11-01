#!/usr/bin/env bash
# One-time setup for the panel's «فيديو ترويجي» page: ffmpeg, an emoji font, Chromium and its libraries.
# Usage:  sudo bash /opt/koydam-tiktok/deploy/install-video.sh
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/koydam-tiktok}"
APP_USER="${APP_USER:-tiktok}"
[[ $EUID -eq 0 ]] || { echo "Run with sudo"; exit 1; }
cd "$APP_DIR"
echo "▶ ffmpeg + fonts"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ffmpeg fonts-noto-color-emoji fonts-noto-core >/dev/null
elif command -v dnf >/dev/null; then
  dnf install -y ffmpeg google-noto-emoji-color-fonts || echo "⚠ install ffmpeg manually"
fi
echo "▶ playwright-core"
[[ -d node_modules/playwright-core ]] || sudo -u "$APP_USER" npm install --no-save --no-audit --no-fund playwright-core@1.63.0 >/dev/null
export PLAYWRIGHT_BROWSERS_PATH="$APP_DIR/.browsers"
echo "▶ Chromium libraries"
npx --yes playwright-core install-deps chromium >/dev/null 2>&1 || echo "⚠ could not install Chromium libraries automatically (non-Debian system?)"
echo "▶ Chromium (about 150 MB)"
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"; chown -R "$APP_USER": "$PLAYWRIGHT_BROWSERS_PATH"
sudo -u "$APP_USER" env PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" npx --yes playwright-core install chromium
echo "▶ check"
sudo -u "$APP_USER" env PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" node tools/promo-video.js --check
echo "✔ Video tools ready. Open the panel → «فيديو ترويجي»."
