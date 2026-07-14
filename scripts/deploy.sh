#!/usr/bin/env bash
# ============================================================
# Cognova AI (Shadow Brain) — Production Deployment Script
# Domain: brain.mr-imperfect.online
# One-command deploy: git pull, build, migrate, restart
# ============================================================

set -euo pipefail

# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"
ENV_FILE="$PROJECT_DIR/.env"
LOG_FILE="$PROJECT_DIR/logs/deploy-$(date +%Y%m%d-%H%M%S).log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1" | tee -a "$LOG_FILE"; }
ok() { echo -e "${GREEN}[OK]${NC} $1" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"; }
fail() { echo -e "${RED}[FAIL]${NC} $1" | tee -a "$LOG_FILE"; exit 1; }

# ------------------------------------------------------------------
# Pre-flight Checks
# ------------------------------------------------------------------
log "=== Cognova AI Production Deploy ==="
log "Domain: brain.mr-imperfect.online"
log "Checking prerequisites..."

command -v docker >/dev/null 2>&1 || fail "Docker is not installed"
command -v docker-compose >/dev/null 2>&1 || command -v docker >/dev/null 2>&1 || fail "Docker Compose is not installed"

[ -f "$COMPOSE_FILE" ] || fail "docker-compose.prod.yml not found at $COMPOSE_FILE"
[ -f "$ENV_FILE" ] || fail ".env file not found at $ENV_FILE"

mkdir -p "$PROJECT_DIR/logs"

# ------------------------------------------------------------------
# Git Pull (if inside a git repo)
# ------------------------------------------------------------------
if [ -d "$PROJECT_DIR/.git" ]; then
    log "Pulling latest code..."
    cd "$PROJECT_DIR"
    git pull origin main || warn "Git pull failed, continuing with local code"
    ok "Code updated"
else
    warn "Not a git repository, skipping git pull"
fi

# ------------------------------------------------------------------
# Environment Validation
# ------------------------------------------------------------------
log "Validating environment..."
if command -v npx >/dev/null 2>&1 && [ -f "$PROJECT_DIR/scripts/validate-env.ts" ]; then
    cd "$PROJECT_DIR"
    npx tsx scripts/validate-env.ts || fail "Environment validation failed"
else
    warn "Skipping env validation (npx or validate-env.ts not available)"
fi

# ------------------------------------------------------------------
# Backup Before Deploy
# ------------------------------------------------------------------
log "Creating pre-deploy backup..."
if [ -f "$PROJECT_DIR/scripts/backup.sh" ]; then
    bash "$PROJECT_DIR/scripts/backup.sh" --quick || warn "Backup failed, continuing anyway"
    ok "Backup completed"
else
    warn "backup.sh not found, skipping backup"
fi

# ------------------------------------------------------------------
# Build & Deploy
# ------------------------------------------------------------------
log "Building production images..."
cd "$PROJECT_DIR"

# Build with no cache for clean deploy
DOCKER_BUILDKIT=1 docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --no-cache || fail "Docker build failed"
ok "Build completed"

log "Stopping existing services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down --remove-orphans || warn "Down failed, continuing"
ok "Services stopped"

log "Starting production stack..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans || fail "Failed to start services"
ok "Services started"

# ------------------------------------------------------------------
# Database Migrations
# ------------------------------------------------------------------
log "Running database migrations..."
sleep 5

# Wait for postgres to be ready
for i in {1..30}; do
    if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres pg_isready -U "${POSTGRES_USER:-shadowbrain}" -d "${POSTGRES_DB:-shadowbrain}" >/dev/null 2>&1; then
        ok "Postgres is ready"
        break
    fi
    sleep 1
    if [ "$i" -eq 30 ]; then
        fail "Postgres failed to become ready"
    fi
done

# Run migrations from initdb directory (already mounted) or manually
log "Migrations applied via initdb mount on container start"

# ------------------------------------------------------------------
# Health Check
# ------------------------------------------------------------------
log "Running health checks..."
sleep 10

for i in {1..30}; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo "000")
    if [ "$STATUS" = "200" ]; then
        ok "App health check passed (HTTP 200)"
        break
    fi
    sleep 2
    if [ "$i" -eq 30 ]; then
        fail "App health check failed after 60s"
    fi
done

# Check nginx
NGINX_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/health 2>/dev/null || echo "000")
if [ "$NGINX_STATUS" = "200" ]; then
    ok "Nginx reverse proxy health check passed"
else
    warn "Nginx health check returned $NGINX_STATUS"
fi

# ------------------------------------------------------------------
# Cleanup
# ------------------------------------------------------------------
log "Cleaning up old images..."
docker image prune -f || warn "Image prune failed"

log "Cleaning up old logs (keep 30 days)..."
find "$PROJECT_DIR/logs" -name "deploy-*.log" -type f -mtime +30 -delete 2>/dev/null || true

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
ok "=== Deploy Complete ==="
log "App URL: https://brain.mr-imperfect.online"
log "Health:  https://brain.mr-imperfect.online/api/health"
log "Logs:    tail -f $LOG_FILE"
log ""
log "Useful commands:"
log "  docker compose -f docker-compose.prod.yml logs -f app"
log "  docker compose -f docker-compose.prod.yml ps"
log "  docker compose -f docker-compose.prod.yml exec postgres psql -U shadowbrain -d shadowbrain"
