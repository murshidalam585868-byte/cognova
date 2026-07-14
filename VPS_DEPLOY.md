# ============================================================
# Cognova AI (Shadow Brain) — VPS Production Deployment Guide
# Domain: brain.mr-imperfect.online
# Root Domain: mr-imperfect.online
# Stack: Next.js 15 · PostgreSQL 17 · PostgREST · Redis 7 · Nginx · Docker
# ============================================================

> **Version:** 1.1  
> **Target:** Ubuntu 22.04/24.04 LTS, Debian 12, or any Docker-capable VPS  
> **Last Updated:** 2025-07-14

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Server Setup](#server-setup)
3. [Domain & DNS Configuration](#domain--dns-configuration)
4. [Environment Configuration](#environment-configuration)
5. [SSL Certificates](#ssl-certificates)
6. [First Deploy](#first-deploy)
7. [Updates & Maintenance](#updates--maintenance)
8. [Backup & Recovery](#backup--recovery)
9. [Monitoring & Alerting](#monitoring--alerting)
10. [Security Hardening](#security-hardening)
11. [Troubleshooting](#troubleshooting)
12. [Reference](#reference)

---

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Disk | 40 GB SSD | 80 GB SSD |
| Network | 1 Gbps | 1 Gbps |

### Software Requirements

- Docker 24.0+ & Docker Compose v2
- Git
- Node.js 22+ (only for `validate-env.ts`)
- A domain name with DNS access (mr-imperfect.online)

### Cloud Provider Examples

- **Hetzner:** CPX21 (4 vCPU, 8 GB) ~ €12/mo
- **DigitalOcean:** Droplet 8GB / 4 vCPU ~ $48/mo
- **AWS:** t3.large with gp3 root volume
- **Linode:** Dedicated 4GB ~ $36/mo
- **Vultr:** Cloud Compute 4GB ~ $24/mo

---

## Server Setup

### 1. Create User & SSH Key

```bash
# On your local machine, generate a key pair
ssh-keygen -t ed25519 -C "cognova-deploy" -f ~/.ssh/cognova

# Copy public key to server
ssh-copy-id -i ~/.ssh/cognova.pub root@YOUR_VPS_IP
```

### 2. Initial Server Hardening

```bash
ssh -i ~/.ssh/cognova root@YOUR_VPS_IP

# Update system
apt update && apt upgrade -y

# Install Docker
wget -qO- https://get.docker.com | sh
usermod -aG docker $USER
newgrp docker

# Install Node.js (for validation scripts)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g tsx

# Install Docker Compose plugin
apt install -y docker-compose-plugin

# Basic firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### 3. Clone Repository

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/your-org/shadow-brain.git cognova-ai
cd cognova-ai
```

---

## Domain & DNS Configuration

### DNS Records for brain.mr-imperfect.online

Log in to your domain registrar (where mr-imperfect.online is managed) and add these records:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | brain | YOUR_VPS_IP | 300 |
| CNAME | www.brain | brain.mr-imperfect.online. | 300 |

> **Note:** If your DNS provider does not support CNAME on subdomains, use an A record for `www.brain` pointing to the same VPS IP.

### Verify DNS Propagation

```bash
dig +short brain.mr-imperfect.online
# Should return your VPS IP

dig +short www.brain.mr-imperfect.online
# Should return your VPS IP or the CNAME target
```

Wait for DNS to propagate (usually 1–5 minutes with TTL 300).

---

## Environment Configuration

### 1. Copy Template

```bash
cp .env.example .env
chmod 600 .env
```

### 2. Edit `.env`

```bash
nano .env
```

**Required values for brain.mr-imperfect.online:**

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Your public domain | `brain.mr-imperfect.online` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-proj-...` |
| `PINECONE_API_KEY` | Pinecone vector DB key | `...` |
| `POSTGRES_PASSWORD` | Strong DB password | `Gen3rate!AStr0ng1` |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as DB password for self-hosted | `Gen3rate!AStr0ng1` |

**Optional values:**

| Variable | Description |
|----------|-------------|
| `LANGSMITH_API_KEY` | LangSmith observability |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare integrations |
| `NOTION_TOKEN` | Notion workspace integration |
| `SLACK_WEBHOOK_URL` | Slack notifications |
| `ENABLE_PHASE3` | Enable Chief of Staff (requires more RAM) |
| `ENABLE_PHASE4` | Enable AI Business Partner |
| `ENABLE_PHASE5` | Enable AI CEO Office (full system) |

### 3. Validate Environment

```bash
npx tsx scripts/validate-env.ts
```

If validation passes, you see ✅. If not, it tells you exactly what's missing.

---

## SSL Certificates

### Option A: Automatic with `ssl-init.sh` (Recommended)

```bash
bash scripts/ssl-init.sh
```

This script:
1. Reads `DOMAIN` from `.env` (defaults to `brain.mr-imperfect.online`)
2. Starts a temporary nginx on port 80
3. Runs Certbot in standalone mode
4. Obtains the certificate for both `brain.mr-imperfect.online` and `www.brain.mr-imperfect.online`
5. Stops temporary nginx and restores production template

### Option B: Manual with Docker

```bash
# Create directories
mkdir -p certbot_www certbot_data

# Run certbot
docker run -it --rm \
  -v $(pwd)/certbot_data:/etc/letsencrypt \
  -v $(pwd)/certbot_www:/var/www/certbot \
  -p 80:80 \
  certbot/certbot certonly \
    --standalone \
    --agree-tos \
    --email admin@brain.mr-imperfect.online \
    -d brain.mr-imperfect.online \
    -d www.brain.mr-imperfect.online
```

### Certificate Renewal

Certbot container in `docker-compose.prod.yml` automatically renews every 12 hours. To force renewal:

```bash
docker compose -f docker-compose.prod.yml run --rm certbot renew --force-renewal
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

---

## First Deploy

### One-Command Deploy

```bash
bash scripts/deploy.sh
```

This performs:
1. Git pull (if inside a git repo)
2. Environment validation
3. Pre-deploy backup
4. Docker image build (no cache)
5. Service restart with zero-downtime logic
6. Health checks (app + nginx)
7. Cleanup of old images and logs

### Manual Deploy (if script fails)

```bash
# Build
DOCKER_BUILDKIT=1 docker compose -f docker-compose.prod.yml build --no-cache

# Start stack
docker compose -f docker-compose.prod.yml up -d

# Verify
curl -I http://localhost:3000/api/health
curl -I http://localhost/api/health
```

### Verify Installation

```bash
# App health via nginx
curl -s https://brain.mr-imperfect.online/api/health | jq .

# Expected output:
# {
#   "status": "healthy",
#   "version": "0.1.0",
#   "services": { "app": "up", "database": "up", "redis": "up" },
#   ...
# }
```

### Open in Browser

Navigate to: **https://brain.mr-imperfect.online**

---

## Updates & Maintenance

### Update to Latest Code

```bash
# Pull + build + deploy
bash scripts/deploy.sh
```

### Update Environment Variables

```bash
nano .env
bash scripts/deploy.sh  # Rebuild picks up new env vars
```

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f postgres
docker compose -f docker-compose.prod.yml logs -f nginx

# Last 100 lines
docker compose -f docker-compose.prod.yml logs --tail 100 app
```

### Restart Single Service

```bash
docker compose -f docker-compose.prod.yml restart app
docker compose -f docker-compose.prod.yml restart redis
```

### Scale App Instances (if needed)

```bash
# Note: requires load balancer changes in nginx
docker compose -f docker-compose.prod.yml up -d --scale app=2
```

---

## Backup & Recovery

### Full Backup

```bash
bash scripts/backup.sh
```

Backs up:
- PostgreSQL database dump (compressed)
- Redis RDB snapshot
- Application logs
- Configuration files
- Docker volumes archive

Output: `backups/` directory with timestamped files.

### Quick Backup (database only)

```bash
bash scripts/backup.sh --quick
```

### Automated Backups (Cron)

```bash
# Daily at 2 AM
0 2 * * * cd /opt/cognova-ai && bash scripts/backup.sh --quick >> /var/log/cognova-backup.log 2>&1

# Weekly full backup on Sundays at 3 AM
0 3 * * 0 cd /opt/cognova-ai && bash scripts/backup.sh >> /var/log/cognova-backup.log 2>&1
```

### Restore from Backup

```bash
# Stop app
docker compose -f docker-compose.prod.yml stop app

# Restore database
gunzip -c backups/postgres_shadowbrain_20250714_020000.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U shadowbrain -d shadowbrain

# Restore Redis
docker compose -f docker-compose.prod.yml stop redis
gunzip -c backups/redis_20250714_020000.rdb.gz > /var/lib/docker/volumes/cognova-ai_redis_data/_data/dump.rdb
docker compose -f docker-compose.prod.yml start redis

# Restart app
docker compose -f docker-compose.prod.yml start app
```

---

## Monitoring & Alerting

### Health Check Endpoint

- **URL:** `https://brain.mr-imperfect.online/api/health`
- **Method:** `GET`
- **Returns:** JSON with service status, response times, and uptime

### Docker Health Checks

All services have built-in health checks:

```bash
# View health status
docker compose -f docker-compose.prod.yml ps

# Health details
docker inspect --format='{{.State.Health.Status}}' sb-app
```

### Resource Monitoring

```bash
# Container stats
docker stats

# Disk usage
docker system df -v
```

### Uptime Monitoring (External)

Recommended free tools:

- **UptimeRobot:** HTTP ping every 5 minutes, alerts via email/Slack
- **BetterUptime:** Status page + incident management
- **Pingdom:** Advanced monitoring with response time tracking

Monitor URL: `https://brain.mr-imperfect.online/api/health`

### Log Aggregation (Optional)

For centralized logging, configure the app container to forward logs:

```bash
# Example: forward to Papertrail
docker compose -f docker-compose.prod.yml logs -f app | \
  ncat --ssl logs.papertrailapp.com 12345
```

Or mount the `app_logs` volume to a log shipper container.

---

## Security Hardening

### 1. Firewall

Already configured in setup. Verify:

```bash
ufw status
# Should show: 22, 80, 443 allowed
```

### 2. Fail2Ban (SSH brute force)

```bash
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

### 3. Disable Root Login

```bash
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

### 4. Security Headers (Already in Nginx)

- `Strict-Transport-Security` (HSTS)
- `X-Frame-Options` (clickjacking)
- `X-Content-Type-Options` (MIME sniffing)
- `X-XSS-Protection`
- `Referrer-Policy`
- `Permissions-Policy`

### 5. Rate Limiting (Already in Nginx)

- General pages: 30 req/s burst 50
- API endpoints: 10 req/s burst 20
- SSE streaming: 10 req/s burst 10

### 6. Secrets Management

- `.env` file has `chmod 600` (owner read/write only)
- Never commit `.env` to Git
- Rotate `POSTGRES_PASSWORD` and `SUPABASE_SERVICE_ROLE_KEY` quarterly
- Use `docker secret` if running Docker Swarm

### 7. Database Security

- Postgres only exposed on `127.0.0.1:5432` (not public)
- No default passwords
- All tables have RLS policies enabled
- Connection via Docker network only (no external access)

---

## Troubleshooting

### App won't start

```bash
# Check logs
docker compose -f docker-compose.prod.yml logs app --tail 50

# Check env validation
npx tsx scripts/validate-env.ts

# Verify DB is reachable
docker compose -f docker-compose.prod.yml exec postgres pg_isready -U shadowbrain
```

### Database connection errors

```bash
# Verify container is healthy
docker compose -f docker-compose.prod.yml ps

# Check if migrations ran
docker compose -f docker-compose.prod.yml exec postgres psql -U shadowbrain -d shadowbrain -c "\dt"

# If tables missing, check init logs
docker compose -f docker-compose.prod.yml logs postgres --tail 100
```

### Redis connection errors

```bash
# Test Redis
docker compose -f docker-compose.prod.yml exec redis redis-cli ping
# Should return: PONG

# Check Redis logs
docker compose -f docker-compose.prod.yml logs redis --tail 50
```

### Nginx 502 Bad Gateway

```bash
# Verify app is running
curl http://localhost:3000/api/health

# Check nginx config syntax
docker compose -f docker-compose.prod.yml exec nginx nginx -t

# Check nginx logs
docker compose -f docker-compose.prod.yml logs nginx --tail 50
```

### SSL certificate expired or missing

```bash
# Re-run SSL init
bash scripts/ssl-init.sh

# Or force renewal
docker compose -f docker-compose.prod.yml run --rm certbot renew --force-renewal
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

### High memory usage

```bash
# Check per-container stats
docker stats --no-stream

# If app exceeds 2GB, increase limit in docker-compose.prod.yml:
# deploy.resources.limits.memory: 4G

# Or scale down phases:
# ENABLE_PHASE3=false
# ENABLE_PHASE4=false
```

### Backup fails

```bash
# Check disk space
df -h

# Check backup directory permissions
ls -la backups/

# Run with custom directory
bash scripts/backup.sh --dir /mnt/external/backups
```

---

## Reference

### Directory Structure

```
cognova-ai/
├── .env                      # Environment variables (not in git)
├── .env.example              # Template (domain: brain.mr-imperfect.online)
├── .dockerignore             # Docker build exclusions
├── docker-compose.prod.yml   # Production stack
├── docker-compose.yml        # Local dev stack (unchanged)
├── Dockerfile                # Multi-stage build
├── DEPLOY.md                 # General deployment guide
├── VPS_DEPLOY.md             # This VPS-specific guide
├── next.config.ts            # Next.js config (standalone output)
├── nginx/
│   ├── nginx.conf            # Main nginx config
│   └── templates/
│       └── default.conf.template   # Site template (envsubst)
├── scripts/
│   ├── deploy.sh             # One-command deploy
│   ├── backup.sh             # Automated backups
│   ├── ssl-init.sh           # SSL certificate setup
│   └── validate-env.ts       # Environment validator
├── src/
│   └── app/
│       └── api/
│           └── health/
│               └── route.ts  # Health check endpoint
├── supabase/
│   └── migrations/           # Database migrations
└── workers/                  # Background workers
```

### Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DOMAIN` | Yes | `brain.mr-imperfect.online` | Public domain name |
| `OPENAI_API_KEY` | Yes | — | OpenAI API key |
| `PINECONE_API_KEY` | Yes | — | Pinecone API key |
| `POSTGRES_PASSWORD` | Yes | — | Database password |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Same as DB password for self-hosted |
| `REDIS_URL` | No | `redis://redis:6379` | Redis connection |
| `LOG_LEVEL` | No | `info` | Winston log level |
| `ENABLE_PHASE1` | No | `true` | AI Assistant |
| `ENABLE_PHASE2` | No | `true` | Digital Shadow |
| `ENABLE_PHASE3` | No | `false` | Chief of Staff |
| `ENABLE_PHASE4` | No | `false` | AI Business Partner |
| `ENABLE_PHASE5` | No | `false` | AI CEO Office |

### Useful Commands

```bash
# Full stack status
docker compose -f docker-compose.prod.yml ps

# Enter app container
docker compose -f docker-compose.prod.yml exec app sh

# Enter database
docker compose -f docker-compose.prod.yml exec postgres psql -U shadowbrain -d shadowbrain

# Redis CLI
docker compose -f docker-compose.prod.yml exec redis redis-cli

# Restart everything
docker compose -f docker-compose.prod.yml restart

# Stop everything
docker compose -f docker-compose.prod.yml down

# Destroy everything (including volumes!)
docker compose -f docker-compose.prod.yml down -v

# Clean unused images
docker image prune -af

# View real-time resource usage
docker stats
```

### Quick Start Checklist

- [ ] VPS provisioned with Ubuntu 22.04/24.04
- [ ] Docker & Docker Compose installed
- [ ] DNS A record `brain` → VPS IP set at mr-imperfect.online registrar
- [ ] Repository cloned to `/opt/cognova-ai`
- [ ] `.env` created from `.env.example` with real values
- [ ] `chmod 600 .env` applied
- [ ] `npx tsx scripts/validate-env.ts` passes
- [ ] `bash scripts/ssl-init.sh` completes successfully
- [ ] `bash scripts/deploy.sh` completes successfully
- [ ] `curl -s https://brain.mr-imperfect.online/api/health` returns 200
- [ ] Browser shows Cognova AI at https://brain.mr-imperfect.online

### Support

- **Issues:** Open a GitHub issue with logs and `docker compose -f docker-compose.prod.yml config` output
- **Health:** `https://brain.mr-imperfect.online/api/health`
- **Docs:** See `src/` README for application architecture

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | 2025-07-14 | Updated for brain.mr-imperfect.online domain, added VPS-specific guide |
| 1.0 | 2025-07-14 | Initial production deployment stack |

---

*Built for production. Deploy with confidence.*
*Cognova AI — Your AI CEO Office at brain.mr-imperfect.online*
