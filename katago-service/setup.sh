#!/usr/bin/env bash
# Hetzner VPS setup script for katago-service
# Run as root on a fresh Ubuntu 24.04 server (CX22 or better)
# Usage: bash setup.sh

set -euo pipefail

KATAGO_VERSION="v1.15.3"
KATAGO_BINARY_URL="https://github.com/lightvector/KataGo/releases/download/${KATAGO_VERSION}/katago-${KATAGO_VERSION}-eigen-linux-x64.zip"
KATAGO_MODEL_URL="https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b15c192-s1672170752-d466197073.bin.gz"

INSTALL_DIR="/opt/katago"
SERVICE_DIR="/opt/katago-service"
SERVICE_USER="katago"

echo "==> Updating system packages"
apt-get update -q
apt-get install -y -q curl unzip nodejs npm nginx

echo "==> Creating service user"
id -u $SERVICE_USER &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin $SERVICE_USER

echo "==> Installing KataGo"
mkdir -p "$INSTALL_DIR"

# Download and extract KataGo binary
# Note: check https://github.com/lightvector/KataGo/releases for the latest version
# Use the CPU-only build if you don't have a GPU (most Hetzner VPS nodes)
curl -fsSL "$KATAGO_BINARY_URL" -o /tmp/katago.zip
unzip -o /tmp/katago.zip -d /tmp/katago-extracted
find /tmp/katago-extracted -name 'katago' -type f -exec cp {} /usr/local/bin/katago \;
chmod +x /usr/local/bin/katago
rm -rf /tmp/katago.zip /tmp/katago-extracted

echo "KataGo version: $(katago version 2>/dev/null || echo 'installed')"

echo "==> Downloading KataGo network (b15c192, ~55MB)"
# This is the 'small' network — strong enough for beginners, fast on CPU
# For the latest network: https://katagotraining.org/networks/
curl -fsSL --progress-bar "$KATAGO_MODEL_URL" -o "$INSTALL_DIR/model.bin.gz"

echo "==> Setting up katago-service"
mkdir -p "$SERVICE_DIR"

# Copy service files from the repo (run this from the repo root)
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cp "$REPO_DIR/katago-service/server.js"    "$SERVICE_DIR/"
cp "$REPO_DIR/katago-service/package.json" "$SERVICE_DIR/"
cp "$REPO_DIR/katago-service/analysis.cfg" "$INSTALL_DIR/"

cd "$SERVICE_DIR"
npm install --production

chown -R $SERVICE_USER:$SERVICE_USER "$INSTALL_DIR" "$SERVICE_DIR"

echo "==> Generating auth token"
KATAGO_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo ""
echo "  KATAGO_TOKEN=${KATAGO_TOKEN}"
echo ""
echo "  Save this token — you'll add it to Netlify as KATAGO_TOKEN"
echo "  and to the systemd environment below."
echo ""

echo "==> Creating systemd service"
cat > /etc/systemd/system/katago-service.service << EOF
[Unit]
Description=KataGo HTTP wrapper for Goxira
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$SERVICE_DIR
ExecStart=/usr/bin/node $SERVICE_DIR/server.js
Restart=always
RestartSec=5

Environment=KATAGO_BINARY=/usr/local/bin/katago
Environment=KATAGO_MODEL=$INSTALL_DIR/model.bin.gz
Environment=KATAGO_CONFIG=$INSTALL_DIR/analysis.cfg
Environment=PORT=3000
Environment=KATAGO_TOKEN=${KATAGO_TOKEN}

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable katago-service
systemctl start katago-service

echo "==> Configuring nginx reverse proxy"
# nginx sits in front and handles TLS via Let's Encrypt (certbot)
# It proxies to katago-service on 127.0.0.1:3000
cat > /etc/nginx/sites-available/katago << 'NGINX'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_read_timeout 60s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/katago /etc/nginx/sites-enabled/katago
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo ""
echo "==> Done. Next steps:"
echo ""
echo "  1. Point a domain at this server's IP"
echo "     (optional but recommended — needed for TLS)"
echo ""
echo "  2. Install TLS with Let's Encrypt:"
echo "     apt install certbot python3-certbot-nginx"
echo "     certbot --nginx -d your-domain.com"
echo ""
echo "  3. Add to Netlify environment variables:"
echo "     KATAGO_SERVICE_URL=https://your-domain.com"
echo "     KATAGO_TOKEN=${KATAGO_TOKEN}"
echo ""
echo "  4. Test the service:"
echo "     curl -s -X POST http://localhost:3000/health -H 'Authorization: Bearer ${KATAGO_TOKEN}'"
echo ""
echo "  5. Check KataGo logs:"
echo "     journalctl -u katago-service -f"
