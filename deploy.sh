#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_SITE="edelpacta"
NGINX_AVAILABLE="/etc/nginx/sites-available/${NGINX_SITE}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${NGINX_SITE}"
DOMAINS=("api.edel-id.ch" "notary.edel-id.ch" "vendor.edel-id.ch" "buyer.edel-id.ch" "ipfs.edel-id.ch")

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() { echo -e "${RED}[error]${NC} $*"; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
info "Checking prerequisites..."
for cmd in docker nginx certbot; do
    command -v "$cmd" &>/dev/null || error "'$cmd' is not installed. Aborting."
done
docker compose version &>/dev/null || error "'docker compose' plugin not found. Aborting."
[[ $EUID -eq 0 ]] || error "This script must be run as root (sudo)."

# ── .env validation ───────────────────────────────────────────────────────────
info "Validating .env..."
ENV_FILE="${DEPLOY_DIR}/.env"
[[ -f "$ENV_FILE" ]] || error ".env not found. Copy .env.example and fill in the values."

source "$ENV_FILE"

REQUIRED_VARS=(
    ISSUER_SEED
    ISSUER_ADDRESS
    ISSUER_DID
    BETAID_ISSUER_DID
    ORACLE_SEED
)
for var in "${REQUIRED_VARS[@]}"; do
    [[ -n "${!var:-}" ]] || error "Required variable '$var' is not set in .env."
done

# Inject production defaults if not already set
if ! grep -q "^VITE_BUYER_API_URL=" "$ENV_FILE"; then
    warn "VITE_BUYER_API_URL not set — adding default: https://api.edel-id.ch"
    echo "VITE_BUYER_API_URL=https://api.edel-id.ch" >> "$ENV_FILE"
fi

if ! grep -q "^CORS_ORIGINS=" "$ENV_FILE"; then
    warn "CORS_ORIGINS not set — adding default: https://buyer.edel-id.ch"
    echo "CORS_ORIGINS=https://buyer.edel-id.ch" >> "$ENV_FILE"
fi

if ! grep -q "^VITE_IPFS_GATEWAY=" "$ENV_FILE" || grep -q "^VITE_IPFS_GATEWAY=http://localhost" "$ENV_FILE"; then
    warn "VITE_IPFS_GATEWAY is missing or points to localhost — updating to https://ipfs.edel-id.ch/ipfs"
    sed -i 's|^VITE_IPFS_GATEWAY=.*|VITE_IPFS_GATEWAY=https://ipfs.edel-id.ch/ipfs|' "$ENV_FILE"
    grep -q "^VITE_IPFS_GATEWAY=" "$ENV_FILE" || echo "VITE_IPFS_GATEWAY=https://ipfs.edel-id.ch/ipfs" >> "$ENV_FILE"
fi

# ── Nginx config ──────────────────────────────────────────────────────────────
info "Installing nginx vhost config..."
cp "${DEPLOY_DIR}/nginx/edelpacta.conf" "$NGINX_AVAILABLE"

if [[ ! -L "$NGINX_ENABLED" ]]; then
    ln -s "$NGINX_AVAILABLE" "$NGINX_ENABLED"
    info "Enabled nginx site: ${NGINX_SITE}"
fi

nginx -t || error "nginx config test failed. Fix the config before continuing."

# ── SSL certificates ──────────────────────────────────────────────────────────
# Build -d flags for certbot
CERTBOT_DOMAINS=()
for d in "${DOMAINS[@]}"; do
    CERTBOT_DOMAINS+=("-d" "$d")
done

CERT_PATH="/etc/letsencrypt/live/${DOMAINS[0]}/fullchain.pem"
if [[ -f "$CERT_PATH" ]]; then
    info "SSL certificates already exist — skipping certbot."
else
    info "Obtaining SSL certificates via certbot..."
    systemctl start nginx || true
    certbot --nginx "${CERTBOT_DOMAINS[@]}" --non-interactive --agree-tos --redirect \
        -m "admin@edel-id.ch" \
        || error "certbot failed. Check the output above."
fi

# ── Docker build & start ──────────────────────────────────────────────────────
info "Building and starting containers..."
cd "$DEPLOY_DIR"
docker compose pull --ignore-buildable 2>/dev/null || true
docker compose up -d --build

# ── Reload nginx ──────────────────────────────────────────────────────────────
info "Reloading nginx..."
systemctl reload nginx

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
info "Deployment complete."
echo -e "  ${GREEN}notary${NC}  → https://notary.edel-id.ch"
echo -e "  ${GREEN}vendor${NC}  → https://vendor.edel-id.ch"
echo -e "  ${GREEN}buyer${NC}   → https://buyer.edel-id.ch"
echo -e "  ${GREEN}api${NC}     → https://api.edel-id.ch"
echo -e "  ${GREEN}ipfs${NC}    → https://ipfs.edel-id.ch"
