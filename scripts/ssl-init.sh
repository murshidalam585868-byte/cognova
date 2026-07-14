#!/usr/bin/env bash
# ============================================================
# Shadow Brain — SSL Certificate Initialization
# Domain: brain.mr-imperfect.online
# Obtains initial Let's Encrypt certificate before first deploy
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
ok() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# ------------------------------------------------------------------
# Load domain from .env
# ------------------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
    DOMAIN=$(grep '^DOMAIN=' "$ENV_FILE" | cut -d '=' -f2 | tr -d '"' || true)
    EMAIL=$(grep '^PGADMIN_EMAIL=' "$ENV_FILE" | cut -d '=' -f2 | tr -d '"' || true)
fi

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-admin@brain.mr-imperfect.online}"

if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "your-domain.com" ] || [ "$DOMAIN" = "brain.mr-imperfect.online" ]; then
    DOMAIN="brain.mr-imperfect.online"
    warn "DOMAIN not configured in .env. Using default: $DOMAIN"
    warn "Set DOMAIN=brain.mr-imperfect.online in .env for consistency."
fi

log "=== SSL Initialization for $DOMAIN ==="
log "Using email: $EMAIL"

# ------------------------------------------------------------------
# Step 1: Verify DNS points to this server
# ------------------------------------------------------------------
SERVER_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "")
if [ -n "$SERVER_IP" ]; then
    log "Server public IP: $SERVER_IP"
    log "Verifying DNS for $DOMAIN ..."
    DNS_IP=$(dig +short "$DOMAIN" 2>/dev/null || nslookup "$DOMAIN" 2>/dev/null | tail -n 2 | head -n 1 | awk '{print $2}' || echo "")
    if [ -n "$DNS_IP" ] && [ "$DNS_IP" != "$SERVER_IP" ]; then
        warn "DNS for $DOMAIN resolves to $DNS_IP, but this server's IP is $SERVER_IP"
        warn "SSL may fail if DNS is not yet propagated. Continuing anyway..."
    elif [ -n "$DNS_IP" ]; then
        ok "DNS verified: $DOMAIN → $DNS_IP"
    else
        warn "Could not resolve $DOMAIN. DNS may not be propagated yet."
    fi
fi

# ------------------------------------------------------------------
# Step 2: Start nginx with HTTP-only to serve ACME challenge
# ------------------------------------------------------------------
log "Starting temporary nginx for ACME challenge..."

mkdir -p "$PROJECT_DIR/nginx/templates" "$PROJECT_DIR/certbot_www"

# Backup the production template before overwriting
if [ -f "$PROJECT_DIR/nginx/templates/default.conf.template" ]; then
    cp "$PROJECT_DIR/nginx/templates/default.conf.template" "$PROJECT_DIR/nginx/templates/default.conf.template.bak"
fi

# Create a temporary HTTP-only nginx template for ACME
cat > "$PROJECT_DIR/nginx/templates/default.conf.template" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 "Let's Encrypt validation in progress...";
    }
}
EOF

docker run -d --rm --name sb-nginx-temp \
    -p 80:80 \
    -v "$PROJECT_DIR/nginx/templates:/etc/nginx/templates:ro" \
    -v "$PROJECT_DIR/certbot_www:/var/www/certbot" \
    -v "$PROJECT_DIR/certbot_data:/etc/letsencrypt" \
    -e DOMAIN="$DOMAIN" \
    nginx:1.27-alpine

sleep 3

# ------------------------------------------------------------------
# Step 3: Obtain certificate
# ------------------------------------------------------------------
log "Requesting certificate from Let's Encrypt..."

# Determine domains to request certificate for
CERT_DOMAINS="-d $DOMAIN"
if [ "$DOMAIN" = "brain.mr-imperfect.online" ]; then
    CERT_DOMAINS="-d brain.mr-imperfect.online -d www.brain.mr-imperfect.online"
fi

docker run -it --rm --name sb-certbot-init \
    -v "$PROJECT_DIR/certbot_data:/etc/letsencrypt" \
    -v "$PROJECT_DIR/certbot_www:/var/www/certbot" \
    certbot/certbot:latest certonly \
    --standalone \
    --agree-tos \
    --no-eff-email \
    --email "$EMAIL" \
    $CERT_DOMAINS \
    || fail "Certbot failed"

ok "Certificate obtained for $DOMAIN"

# ------------------------------------------------------------------
# Step 4: Stop temporary nginx
# ------------------------------------------------------------------
log "Stopping temporary nginx..."
docker stop sb-nginx-temp 2>/dev/null || true

# ------------------------------------------------------------------
# Step 5: Restore production nginx template
# ------------------------------------------------------------------
log "Restoring production nginx template..."
if [ -f "$PROJECT_DIR/nginx/templates/default.conf.template.bak" ]; then
    cp "$PROJECT_DIR/nginx/templates/default.conf.template.bak" "$PROJECT_DIR/nginx/templates/default.conf.template"
    rm "$PROJECT_DIR/nginx/templates/default.conf.template.bak"
else
    warn "Backup template not found. You may need to restore manually from git."
fi

# ------------------------------------------------------------------
# Step 6: Verify certificate files exist
# ------------------------------------------------------------------
CERT_DIR="$PROJECT_DIR/certbot_data/live/$DOMAIN"
if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
    ok "Certificate files verified at $CERT_DIR"
    openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -subject -dates | head -n 2
else
    warn "Certificate files not found at expected path."
    warn "Check: $CERT_DIR/"
    ls -la "$PROJECT_DIR/certbot_data/live/" 2>/dev/null || true
fi

ok "SSL initialization complete!"
log "Next steps:"
log "  1. Run: bash scripts/deploy.sh"
log "  2. Verify: curl -I https://$DOMAIN/api/health"
