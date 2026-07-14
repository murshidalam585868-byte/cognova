#!/usr/bin/env bash
# ============================================================
# Shadow Brain — Automated Backup Script
# Backs up PostgreSQL, Redis, and application logs
# ============================================================

set -euo pipefail

# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"
ENV_FILE="$PROJECT_DIR/.env"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
QUICK_MODE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
ok() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Options:
  --quick          Quick backup (DB only, no logs/archives)
  --dir PATH       Custom backup directory (default: ./backups)
  --retention N    Keep N days of backups (default: 30)
  --help           Show this help

Examples:
  $0                    # Full backup
  $0 --quick            # Quick database-only backup
  $0 --dir /mnt/backup  # Backup to external mount
EOF
    exit 0
}

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick) QUICK_MODE=true; shift ;;
        --dir) BACKUP_DIR="$2"; shift 2 ;;
        --retention) RETENTION_DAYS="$2"; shift 2 ;;
        --help) usage ;;
        *) warn "Unknown option: $1"; shift ;;
    esac
done

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

log "=== Shadow Brain Backup — $TIMESTAMP ==="
log "Backup directory: $BACKUP_DIR"
log "Quick mode: $QUICK_MODE"

# ------------------------------------------------------------------
# 1. PostgreSQL Backup
# ------------------------------------------------------------------
log "Backing up PostgreSQL..."

DB_CONTAINER="sb-postgres"
DB_USER="${POSTGRES_USER:-shadowbrain}"
DB_NAME="${POSTGRES_DB:-shadowbrain}"
DB_BACKUP="$BACKUP_DIR/postgres_${DB_NAME}_${TIMESTAMP}.sql.gz"

if docker ps -q -f name="$DB_CONTAINER" | grep -q .; then
    docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "$DB_CONTAINER" \
        pg_dump -U "$DB_USER" -d "$DB_NAME" --verbose --no-owner --no-privileges | \
        gzip > "$DB_BACKUP" || fail "PostgreSQL backup failed"
    ok "PostgreSQL backup: $(du -h "$DB_BACKUP" | cut -f1)"
else
    warn "Postgres container not running, skipping DB backup"
fi

# ------------------------------------------------------------------
# 2. Redis Backup (RDB dump)
# ------------------------------------------------------------------
log "Backing up Redis..."

REDIS_CONTAINER="sb-redis"
REDIS_BACKUP="$BACKUP_DIR/redis_${TIMESTAMP}.rdb"

if docker ps -q -f name="$REDIS_CONTAINER" | grep -q .; then
    docker exec "$REDIS_CONTAINER" redis-cli BGSAVE
    sleep 2
    docker cp "$REDIS_CONTAINER:/data/dump.rdb" "$REDIS_BACKUP" || fail "Redis backup failed"
    gzip -f "$REDIS_BACKUP"
    ok "Redis backup: $(du -h "${REDIS_BACKUP}.gz" | cut -f1)"
else
    warn "Redis container not running, skipping Redis backup"
fi

# ------------------------------------------------------------------
# 3. Application Logs
# ------------------------------------------------------------------
if [ "$QUICK_MODE" = false ]; then
    log "Backing up application logs..."

    LOGS_BACKUP="$BACKUP_DIR/logs_${TIMESTAMP}.tar.gz"
    APP_CONTAINER="sb-app"

    if docker ps -q -f name="$APP_CONTAINER" | grep -q .; then
        docker exec "$APP_CONTAINER" tar -czf /tmp/logs.tar.gz -C /app logs/ 2>/dev/null || true
        docker cp "$APP_CONTAINER:/tmp/logs.tar.gz" "$LOGS_BACKUP" 2>/dev/null || warn "App logs backup failed"
        if [ -f "$LOGS_BACKUP" ]; then
            ok "App logs backup: $(du -h "$LOGS_BACKUP" | cut -f1)"
        fi
    else
        warn "App container not running, skipping logs backup"
    fi

    # ------------------------------------------------------------------
    # 4. Environment & Configuration
    # ------------------------------------------------------------------
    log "Backing up configuration..."
    CONFIG_BACKUP="$BACKUP_DIR/config_${TIMESTAMP}.tar.gz"
    tar -czf "$CONFIG_BACKUP" \
        -C "$PROJECT_DIR" \
        .env \
        docker-compose.prod.yml \
        nginx/ \
        scripts/ \
        2>/dev/null || warn "Config backup failed"
    if [ -f "$CONFIG_BACKUP" ]; then
        ok "Config backup: $(du -h "$CONFIG_BACKUP" | cut -f1)"
    fi

    # ------------------------------------------------------------------
    # 5. Docker Volumes Archive
    # ------------------------------------------------------------------
    log "Archiving Docker volumes..."
    VOLUME_BACKUP="$BACKUP_DIR/volumes_${TIMESTAMP}.tar.gz"
    docker run --rm \
        -v shadow-brain_postgres_data:/data/pg \
        -v shadow-brain_redis_data:/data/redis \
        -v "$BACKUP_DIR:/backup" \
        alpine:latest \
        tar -czf "/backup/volumes_${TIMESTAMP}.tar.gz" -C /data . \
        2>/dev/null || warn "Volume archive failed"
    if [ -f "$VOLUME_BACKUP" ]; then
        ok "Volume archive: $(du -h "$VOLUME_BACKUP" | cut -f1)"
    fi
fi

# ------------------------------------------------------------------
# 6. Retention Cleanup
# ------------------------------------------------------------------
log "Cleaning up backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "postgres_*.gz" -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "redis_*.gz" -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "logs_*.tar.gz" -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "config_*.tar.gz" -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "volumes_*.tar.gz" -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
ok "Retention cleanup complete"

# ------------------------------------------------------------------
# 7. Backup Summary
# ------------------------------------------------------------------
log "=== Backup Summary ==="
ls -lh "$BACKUP_DIR"/*"${TIMESTAMP}"* 2>/dev/null || true
ok "Backup complete: $BACKUP_DIR"

# Optional: Upload to S3 (if configured)
if [ -n "${S3_BACKUP_BUCKET:-}" ] && command -v aws >/dev/null 2>&1; then
    log "Uploading to S3: s3://$S3_BACKUP_BUCKET/shadow-brain/"
    aws s3 sync "$BACKUP_DIR" "s3://$S3_BACKUP_BUCKET/shadow-brain/" --exclude "*" --include "*${TIMESTAMP}*" || warn "S3 upload failed"
    ok "S3 upload complete"
fi
