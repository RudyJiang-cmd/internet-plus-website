#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-lingfun.fun}"
EMAIL="${2:-}"
WEB_ROOT="${3:-/var/www/html}"
NGINX_SITE="${4:-/etc/nginx/sites-available/default}"

if [[ -z "${EMAIL}" ]]; then
  echo "Usage: $0 <domain> <email> [web_root] [nginx_site]"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo $0 ${DOMAIN} ${EMAIL}"
  exit 1
fi

apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

mkdir -p "${WEB_ROOT}"

cat > "${NGINX_SITE}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    root ${WEB_ROOT};
    index index.html;

    location /.well-known/acme-challenge/ {
        root ${WEB_ROOT};
    }

    location / {
        return 301 https://${DOMAIN}\$request_uri;
    }
}
EOF

nginx -t
systemctl reload nginx

certbot --nginx \
  -d "${DOMAIN}" \
  -d "www.${DOMAIN}" \
  --non-interactive \
  --agree-tos \
  --redirect \
  -m "${EMAIL}"

nginx -t
systemctl reload nginx

echo "HTTPS enabled for ${DOMAIN}"
