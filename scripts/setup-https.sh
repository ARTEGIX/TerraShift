#!/usr/bin/env bash
set -euo pipefail

# Configure Ubuntu host Nginx + Let's Encrypt SSL (Certbot) for TerraShift.
# Usage: sudo ./scripts/setup-https.sh terrashift-api.duckdns.org

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo $0 <domain>   (e.g. terrashift-api.duckdns.org or <IP>.sslip.io)"
  exit 1
fi

apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx

sed "s/YOUR_DOMAIN\.duckdns\.org/${DOMAIN}/g" nginx/host-ssl.conf.example > /etc/nginx/sites-available/terrashift
ln -sf /etc/nginx/sites-available/terrashift /etc/nginx/sites-enabled/terrashift
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
fi

certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
echo "✅ HTTPS enabled at https://${DOMAIN}/api/health"
