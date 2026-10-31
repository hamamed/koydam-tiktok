#!/usr/bin/env bash
# =============================================================================
#  koydam-tiktok · تحدي المليون: installer / updater for a Linux VPS
#
#  One-line install (as root):
#    curl -fsSL https://raw.githubusercontent.com/hamamed/koydam-tiktok/main/deploy/install.sh | sudo bash
#  With options:
#    curl -fsSL https://raw.githubusercontent.com/hamamed/koydam-tiktok/main/deploy/install.sh \
#      | sudo DOMAIN=tiktok.koydam.com EMAIL=admin@koydam.com ADMIN_EMAIL=admin@koydam.com bash
#
#  Options (environment variables):
#    DOMAIN=tiktok.koydam.com      Public hostname
#    EMAIL=admin@koydam.com        Let's Encrypt contact email
#    ADMIN_EMAIL=admin@koydam.com  Admin login email (first install)
#    PORT=                         Internal port (localhost only). Default: first free in 3077-3199
#    APP_DIR=/opt/koydam-tiktok    Install folder
#    REPO=https://github.com/hamamed/koydam-tiktok.git   BRANCH=main
#    PROXY=auto|nginx|apache|caddy|none
#
#  Safe to run again: it updates the code and keeps data/ (scores, config, keys, login).
#  Never opens a public port and never touches your other websites:
#  the app listens on 127.0.0.1 only; nginx/Apache get ONE new site file for DOMAIN.
# =============================================================================
set -Eeuo pipefail
# Remember the last failing command; report it only if the installer actually stops on it.
ERR_LINE=""; ERR_CMD=""; DIED=0
trap 'ERR_LINE=$LINENO; ERR_CMD=$BASH_COMMAND' ERR
trap 'rc=$?; if (( rc != 0 && DIED == 0 )) && [[ -n $ERR_LINE ]]; then printf "\033[31m✖ install.sh stopped at line %s: %s\033[0m\n" "$ERR_LINE" "$ERR_CMD" >&2; fi' EXIT

# Everything is inside main() so `curl | bash` reads the whole script before running it.
main() {
DOMAIN="${DOMAIN:-tiktok.koydam.com}"
EMAIL="${EMAIL:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@koydam.com}"
PORT_REQUESTED="${PORT:-}"
APP_DIR="${APP_DIR:-/opt/koydam-tiktok}"
REPO="${REPO:-https://github.com/hamamed/koydam-tiktok.git}"
BRANCH="${BRANCH:-main}"
PROXY="${PROXY:-auto}"
SERVICE="koydam-tiktok"
APP_USER="tiktok"
EXPECTED_IP="46.224.86.198"
OLD_DIR="/opt/tiktok-scoreboard"          # earlier non-git version
OLD_SERVICE="tiktok-scoreboard"

c_ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
c_info() { printf '\033[36m➜ %s\033[0m\n' "$*"; }
c_warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }
die()    { DIED=1; printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
as_app() { runuser -u "$APP_USER" -- env HOME="$APP_DIR" NEXT_TELEMETRY_DISABLED=1 "$@"; }
g()      { as_app git -c safe.directory="$APP_DIR" -C "$APP_DIR" "$@"; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo)."
if command -v apt-get >/dev/null; then PKG=apt
elif command -v dnf >/dev/null; then PKG=dnf
else die "Unsupported OS: need apt (Debian/Ubuntu) or dnf (RHEL/Alma/Rocky)."; fi
pkg_install() { if [[ $PKG == apt ]]; then DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" </dev/null; else dnf install -y "$@" </dev/null; fi; }

# --- 1. Tools: git, curl, Node.js 22 -------------------------------------------
command -v git >/dev/null && command -v curl >/dev/null || { [[ $PKG == apt ]] && apt-get update </dev/null; pkg_install git curl ca-certificates; }
node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' || echo 0; }
if (( $(node_major) < 20 )); then
  c_info "Installing Node.js 22..."
  if [[ $PKG == apt ]]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash - </dev/null; else curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - </dev/null; fi
  pkg_install nodejs
fi
c_ok "Node $(node -v), git $(git --version | awk '{print $3}')"

MEM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)
if (( MEM_MB + SWAP_MB < 1500 )); then
  c_warn "Only ${MEM_MB} MB RAM and ${SWAP_MB} MB swap. Building the site may fail. Consider adding swap (2 GB)."
fi

# --- 2. App user + code from GitHub ---------------------------------------------
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  c_info "Updating code in $APP_DIR..."
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  if [[ -n "$(g status --porcelain || true)" ]]; then
    c_warn "Local file changes found. Saving them with git stash before updating."
    g stash push --include-untracked -m "install.sh $(date -u +%FT%TZ)"
  fi
  g fetch --quiet origin "$BRANCH"
  g checkout --quiet "$BRANCH"
  g merge --ff-only --quiet "origin/$BRANCH"
else
  c_info "Downloading $REPO ($BRANCH)..."
  KEEP=""
  if [[ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]]; then   # folder exists but is not a git checkout
    KEEP="$(mktemp -d)"; mv "$APP_DIR"/* "$APP_DIR"/.[!.]* "$KEEP"/ 2>/dev/null || true
  fi
  chown "$APP_USER:$APP_USER" "$APP_DIR"
  as_app git -c safe.directory="$APP_DIR" clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
  [[ -n "$KEEP" && -d "$KEEP/data" ]] && mv "$KEEP/data" "$APP_DIR/data"
fi
mkdir -p "$APP_DIR/data"

# Bring over scores/config/login from the earlier /opt/tiktok-scoreboard install.
if [[ -d "$OLD_DIR/data" && ! -f "$APP_DIR/data/settings.json" ]]; then
  c_info "Importing data from $OLD_DIR/data..."
  cp -a "$OLD_DIR/data/." "$APP_DIR/data/" || true
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 700 "$APP_DIR/data"
c_ok "Code: $(g log -1 --pretty='%h %s')"

# --- 3. Dependencies + build ------------------------------------------------------
c_info "Installing npm packages..."
( cd "$APP_DIR" && as_app npm ci --no-audit --no-fund --loglevel=error </dev/null )
c_info "Building the website (Next.js), about 1 minute..."
( cd "$APP_DIR" && as_app npm run build </dev/null ) || die "Build failed. Check the output above."
c_ok "Website built"

# --- 4. Internal port: localhost only, never a port another program uses -----------
port_free() { node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen($1,'127.0.0.1',()=>s.close(()=>process.exit(0)))"; }
public_port_free() { node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen($1,'0.0.0.0',()=>s.close(()=>process.exit(0)))"; }
unit_port() { sed -n 's/^Environment=PORT=\([0-9]\+\)$/\1/p' "/etc/systemd/system/$1.service" 2>/dev/null | head -1 || true; }
OUR_PORT="$(unit_port "$SERVICE")"
OLD_PORT="$(unit_port "$OLD_SERVICE")"
if systemctl cat "$OLD_SERVICE" >/dev/null 2>&1; then
  c_info "Stopping the old $OLD_SERVICE service (replaced by $SERVICE)..."
  systemctl disable --now "$OLD_SERVICE" >/dev/null 2>&1 || true
fi
if [[ -n "$PORT_REQUESTED" ]]; then
  PORT="$PORT_REQUESTED"
  [[ "$PORT" == "$OUR_PORT" ]] || port_free "$PORT" || die "Port $PORT is used by another program. Pick another: PORT=xxxx"
elif [[ -n "$OUR_PORT" ]]; then PORT="$OUR_PORT"
elif [[ -n "$OLD_PORT" ]] && port_free "$OLD_PORT"; then PORT="$OLD_PORT"
else
  PORT=""
  for p in $(seq 3077 3199); do if port_free "$p"; then PORT="$p"; break; fi; done
  [[ -n "$PORT" ]] || die "No free port between 3077 and 3199. Set one: PORT=xxxx"
fi
c_ok "Internal port: 127.0.0.1:$PORT (not reachable from the internet)"

# --- 5. systemd service ----------------------------------------------------------
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=koydam-tiktok · تحدي المليون ($DOMAIN)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) $APP_DIR/server/index.js
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=PUBLIC_URL=https://$DOMAIN
Environment=ADMIN_EMAIL=$ADMIN_EMAIL
Environment=HOME=$APP_DIR
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=PATH=$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin
# The panel's restart/update buttons exit the process; systemd starts it again.
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 1; done
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 40 --no-pager; die "Service failed to start"; }
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && c_ok "App running on 127.0.0.1:$PORT" || c_warn "App started but /health did not answer yet"

# --- 6. Reverse proxy + HTTPS (adds one site; your other sites are untouched) ---------
PANEL=""
[[ -d /usr/local/psa ]] && PANEL="Plesk"
[[ -d /usr/local/cpanel ]] && PANEL="cPanel"
[[ -d /www/server/panel ]] && PANEL="aaPanel"
[[ -d /home/clp ]] && PANEL="CloudPanel"
[[ -d /usr/local/CyberCP ]] && PANEL="CyberPanel"
[[ -d /usr/local/hestia ]] && PANEL="HestiaCP"
if [[ $PROXY == auto ]]; then
  if [[ -n $PANEL ]]; then PROXY=none
  elif systemctl is-active --quiet nginx 2>/dev/null; then PROXY=nginx
  elif systemctl is-active --quiet apache2 2>/dev/null || systemctl is-active --quiet httpd 2>/dev/null; then PROXY=apache
  elif public_port_free 80 && public_port_free 443; then PROXY=caddy
  else PROXY=none; fi
fi

SERVER_IP="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || echo "$EXPECTED_IP")"
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
DNS_OK=0
if [[ "$DNS_IP" == "$SERVER_IP" ]]; then DNS_OK=1; c_ok "DNS: $DOMAIN -> $DNS_IP"
else c_warn "DNS: $DOMAIN resolves to '${DNS_IP:-nothing}', this server is $SERVER_IP. Add an A record: tiktok -> $SERVER_IP"; fi

certbot_flags() { if [[ -n $EMAIL ]]; then echo "-m $EMAIL"; else echo "--register-unsafely-without-email"; fi; }
open_firewall() {
  if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi
  if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then firewall-cmd --permanent --add-service=http --add-service=https >/dev/null; firewall-cmd --reload >/dev/null; fi
}

case $PROXY in
  nginx)
    c_info "Configuring nginx (one new site: $DOMAIN)..."
    CONF=/etc/nginx/conf.d/$DOMAIN.conf
    [[ -d /etc/nginx/sites-enabled ]] && CONF=/etc/nginx/sites-available/$DOMAIN.conf
    if [[ ! -f "$CONF" ]] || ! grep -q "listen 443" "$CONF"; then   # keep certbot's HTTPS edits on re-runs
      cat > "$CONF" <<EOF
# koydam-tiktok: $DOMAIN -> 127.0.0.1:$PORT (HTTP + WebSocket)
map \$http_upgrade \$koydam_upgrade { default upgrade; '' close; }
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 5m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$koydam_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
EOF
    else
      sed -i "s#proxy_pass http://127.0.0.1:[0-9]*;#proxy_pass http://127.0.0.1:$PORT;#" "$CONF"
    fi
    [[ -d /etc/nginx/sites-enabled ]] && ln -sf "$CONF" /etc/nginx/sites-enabled/
    nginx -t && systemctl reload nginx
    open_firewall
    if (( DNS_OK )) && ! grep -q "listen 443" "$CONF"; then
      command -v certbot >/dev/null || pkg_install certbot python3-certbot-nginx
      certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect $(certbot_flags) </dev/null && c_ok "HTTPS enabled"
    elif (( ! DNS_OK )); then c_warn "Skipped HTTPS. When DNS points here: certbot --nginx -d $DOMAIN --redirect"; fi
    ;;
  apache)
    c_info "Configuring Apache (one new site: $DOMAIN)..."
    if [[ $PKG == apt ]]; then a2enmod proxy proxy_http proxy_wstunnel rewrite headers >/dev/null; CONF=/etc/apache2/sites-available/$DOMAIN.conf; SVC=apache2
    else CONF=/etc/httpd/conf.d/$DOMAIN.conf; SVC=httpd; fi
    cat > "$CONF" <<EOF
<VirtualHost *:80>
    ServerName $DOMAIN
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "%{REQUEST_SCHEME}s"
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:$PORT/\$1 [P,L]
    ProxyPass / http://127.0.0.1:$PORT/
    ProxyPassReverse / http://127.0.0.1:$PORT/
    ProxyTimeout 3600
</VirtualHost>
EOF
    [[ $PKG == apt ]] && a2ensite "$DOMAIN" >/dev/null
    systemctl reload $SVC
    open_firewall
    if (( DNS_OK )); then
      command -v certbot >/dev/null || pkg_install certbot python3-certbot-apache
      certbot --apache -d "$DOMAIN" --non-interactive --agree-tos --redirect $(certbot_flags) </dev/null && c_ok "HTTPS enabled"
    else c_warn "Skipped HTTPS. When DNS points here: certbot --apache -d $DOMAIN --redirect"; fi
    ;;
  caddy)
    c_info "Installing Caddy (automatic HTTPS)..."
    if ! command -v caddy >/dev/null; then
      if [[ $PKG == apt ]]; then
        pkg_install debian-keyring debian-archive-keyring apt-transport-https gnupg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
        apt-get update </dev/null && pkg_install caddy
      else dnf install -y 'dnf-command(copr)' </dev/null && dnf copr enable -y @caddy/caddy </dev/null && pkg_install caddy; fi
    fi
    mkdir -p /etc/caddy/sites
    grep -q 'import sites/\*' /etc/caddy/Caddyfile 2>/dev/null || {
      if grep -q '^:80' /etc/caddy/Caddyfile 2>/dev/null; then echo 'import sites/*' > /etc/caddy/Caddyfile; else echo 'import sites/*' >> /etc/caddy/Caddyfile; fi
    }
    printf '%s {\n    encode gzip\n    reverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" > /etc/caddy/sites/$DOMAIN.caddy
    open_firewall
    systemctl enable caddy >/dev/null 2>&1; systemctl restart caddy
    c_ok "Caddy configured (HTTPS is issued automatically once DNS points here)."
    ;;
  none|*)
    c_warn "Reverse proxy NOT configured automatically${PANEL:+ (detected $PANEL)}."
    cat <<EOF

  In your hosting panel, for the subdomain $DOMAIN:
    1. Enable SSL (Let's Encrypt).
    2. Add a reverse proxy to:  http://127.0.0.1:$PORT
       with WebSocket support (Upgrade/Connection headers) and a long read timeout.
  nginx snippet, if your panel accepts custom nginx config:
      location / {
          proxy_pass http://127.0.0.1:$PORT;
          proxy_http_version 1.1;
          proxy_set_header Upgrade \$http_upgrade;
          proxy_set_header Connection "upgrade";
          proxy_set_header Host \$host;
          proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto \$scheme;
          proxy_read_timeout 3600s;
      }
EOF
    ;;
esac

# --- 7. Summary --------------------------------------------------------------------
LOGIN_EMAIL="$(node -e "try{console.log(require('$APP_DIR/data/settings.json').adminEmail)}catch{console.log('$ADMIN_EMAIL')}")"
echo
c_ok "تم التثبيت / Installed: $(g log -1 --pretty='%h')"
echo "   الصفحة المباشرة  Live page   : https://$DOMAIN/"
echo "   واجهة OBS        OBS overlay : https://$DOMAIN/overlay/"
echo "   لوحة التحكم      Admin panel : https://$DOMAIN/admin/"
echo "   البريد           Admin email : $LOGIN_EMAIL"
if [[ -f "$APP_DIR/data/initial-admin-password.txt" ]]; then
  echo "   كلمة المرور      Password    : $(cat "$APP_DIR/data/initial-admin-password.txt")   (احفظها الآن / save it now)"
else
  echo "   كلمة المرور      Password    : (already set; forgot it? sudo bash $APP_DIR/deploy/reset-password.sh)"
fi
echo "   التحديث          Update      : from the panel (التحديثات) or: sudo bash $APP_DIR/deploy/update.sh"
echo "   السجلات          Logs        : journalctl -u $SERVICE -f"
}

main "$@"
