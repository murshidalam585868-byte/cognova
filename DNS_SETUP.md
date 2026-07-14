# ============================================================
# Cognova AI — DNS Setup Guide for GoDaddy
# Domain: mr-imperfect.online
# Subdomain: brain.mr-imperfect.online
# Created: 2025-07-14
# ============================================================

> **Purpose:** This guide provides step-by-step instructions to configure DNS records at GoDaddy for hosting the Cognova AI platform on the subdomain `brain.mr-imperfect.online`.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [GoDaddy DNS Dashboard Access](#godaddy-dns-dashboard-access)
3. [Required DNS Records](#required-dns-records)
4. [Step-by-Step Instructions](#step-by-step-instructions)
5. [Screenshot Descriptions](#screenshot-descriptions)
6. [DNS Propagation Verification](#dns-propagation-verification)
7. [SSL Certificate Considerations](#ssl-certificate-considerations)
8. [Troubleshooting](#troubleshooting)
9. [Post-DNS Checklist](#post-dns-checklist)

---

## Prerequisites

Before beginning, ensure you have:

- [ ] A registered domain `mr-imperfect.online` managed through GoDaddy
- [ ] GoDaddy account credentials (username + password)
- [ ] Your VPS/cloud server's public IP address (e.g., `1.2.3.4` — replace with your actual IP)
- [ ] The subdomain name finalized: `brain.mr-imperfect.online`
- [ ] Approximately 5–10 minutes of DNS propagation time

---

## GoDaddy DNS Dashboard Access

### Step 1: Log in to GoDaddy

1. Navigate to [https://godaddy.com](https://godaddy.com) and click **Sign In** at the top right.
2. Enter your GoDaddy username (or customer number) and password.
3. Complete any two-factor authentication (2FA) if enabled.

### Step 2: Navigate to Domain Management

1. From your GoDaddy dashboard, click **My Products** in the top navigation.
2. Scroll to the **Domains** section.
3. Find `mr-imperfect.online` in the list and click **DNS** on the right side.
   - Alternatively, click the domain name first, then select the **DNS** tab.

> **Screenshot Description 1:** GoDaddy Dashboard → My Products → Domains list showing `mr-imperfect.online` with a blue "DNS" button to its right.

---

## Required DNS Records

The following table lists **exactly** the DNS records needed for `brain.mr-imperfect.online` to serve the Cognova AI platform. Replace `YOUR.SERVER.IP` with your actual VPS public IP address.

| Type | Name | Value | TTL | Priority | Notes |
|------|------|-------|-----|----------|-------|
| **A** | `brain` | `YOUR.SERVER.IP` | 600 seconds | — | Points subdomain to your VPS |
| **A** | `brain` | `YOUR.SERVER.IP` | 600 seconds | — | IPv4 (duplicate for redundancy if desired) |
| **CNAME** | `www.brain` | `brain.mr-imperfect.online` | 3600 seconds | — | Optional: `www.brain` redirect |

### Record Details

#### A Record for `brain.mr-imperfect.online`

```
Type:     A
Name:     brain
Value:    <YOUR_SERVER_PUBLIC_IP>
TTL:      600 seconds
```

**Example (replace IP with your actual server IP):**
```
Type:     A
Name:     brain
Value:    192.0.2.100
TTL:      600 seconds
```

#### CNAME Record for `www.brain.mr-imperfect.online` (Optional)

```
Type:     CNAME
Name:     www.brain
Value:    brain.mr-imperfect.online
TTL:      3600 seconds
```

> **Note:** The CNAME is optional but recommended so users can reach the app via both `brain.mr-imperfect.online` and `www.brain.mr-imperfect.online`. If using SSL, Certbot will automatically obtain certificates for both names if they are listed in the nginx configuration.

---

## Step-by-Step Instructions

### Step 1: Delete Conflicting Records (Important)

Before adding new records, check for any existing records that might conflict:

1. In the GoDaddy DNS Records table, use the search/filter box to search for `brain`.
2. If any A, CNAME, or MX records exist for `brain` or `www.brain`, delete them:
   - Click the **pencil icon** (Edit) next to the record, then click **Delete**.
   - Or click the checkbox next to the record, then click **Delete** at the top.
3. Confirm deletion when prompted.

> **Screenshot Description 2:** GoDaddy DNS Management page showing a filtered list with one existing CNAME record for "brain" highlighted, with a red "Delete" button visible at the top of the table.

### Step 2: Add the A Record for `brain.mr-imperfect.online`

1. On the DNS Management page, click the **Add New Record** button (blue button, top right of the records table).
2. From the dropdown, select **A** as the record type.
3. Fill in the fields:
   - **Name:** `brain`
     - ⚠️ Do NOT include the full domain. GoDaddy automatically appends `.mr-imperfect.online`.
   - **Value:** Paste your server's public IP address (e.g., `203.0.113.50`)
   - **TTL:** Select **Custom** → enter `600` (10 minutes)
4. Click **Save**.

> **Screenshot Description 3:** GoDaddy "Add New Record" modal with Type set to "A", Name field filled with "brain", Value field showing an IP address, and TTL dropdown set to "600 seconds".

### Step 3: Add the CNAME Record for `www.brain` (Optional)

1. Click **Add New Record** again.
2. Select **CNAME** as the record type.
3. Fill in the fields:
   - **Name:** `www.brain`
   - **Value:** `brain.mr-imperfect.online`
   - **TTL:** Select **1 Hour** (3600 seconds) from the dropdown
4. Click **Save**.

> **Screenshot Description 4:** GoDaddy "Add New Record" modal with Type set to "CNAME", Name field showing "www.brain", Value field showing "brain.mr-imperfect.online", and TTL set to "1 Hour".

### Step 4: Verify the Complete Records Table

Your DNS records table should now contain at minimum:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `brain` | `YOUR_SERVER_IP` | 600 |
| CNAME | `www.brain` | `brain.mr-imperfect.online` | 3600 |

> **Screenshot Description 5:** GoDaddy DNS Management page showing the complete records table with the A record for "brain" and CNAME record for "www.brain" both highlighted with a green checkmark status.

---

## Screenshot Descriptions

For documentation and team onboarding, capture the following screenshots during setup:

| # | Description | Capture Location |
|---|-------------|------------------|
| 1 | **GoDaddy Login Dashboard** showing the domain list with `mr-imperfect.online` visible | My Products → Domains |
| 2 | **DNS Management Page** with the "Add New Record" button circled | Domain → DNS tab |
| 3 | **A Record Modal** filled with `brain` → `YOUR_SERVER_IP` at TTL 600 | Add Record → Type A |
| 4 | **CNAME Record Modal** filled with `www.brain` → `brain.mr-imperfect.online` at TTL 3600 | Add Record → Type CNAME |
| 5 | **Final Records Table** showing both records active | DNS Management main table |
| 6 | **DNS Propagation Success** showing `dig` or `nslookup` output returning your IP | Terminal / command line |

> **Tip:** Save these screenshots to the project's `docs/assets/` folder for future team reference.

---

## DNS Propagation Verification

DNS changes are not instant. Use the following methods to verify propagation:

### Method 1: dig (Linux/macOS)

```bash
# Query the A record
dig +short brain.mr-imperfect.online

# Expected output (your server IP):
# 192.0.2.100

# Query with specific DNS server (Google DNS)
dig @8.8.8.8 +short brain.mr-imperfect.online

# Check CNAME
dig +short www.brain.mr-imperfect.online CNAME
# Expected output:
# brain.mr-imperfect.online.
```

### Method 2: nslookup (Windows/Linux/macOS)

```bash
nslookup brain.mr-imperfect.online

# Expected output:
# Server:  dns.google
# Address:  8.8.8.8
#
# Non-authoritative answer:
# Name:    brain.mr-imperfect.online
# Address: 192.0.2.100
```

### Method 3: Online Tools

- [https://whatsmydns.net](https://whatsmydns.net) — Type `brain.mr-imperfect.online`, select A record, check global propagation.
- [https://dnschecker.org](https://dnschecker.org) — Similar global DNS check.
- [https://mxtoolbox.com/DNSLookup.aspx](https://mxtoolbox.com/DNSLookup.aspx) — Professional DNS diagnostic tool.

### Expected Propagation Times

| TTL Setting | Typical Propagation Time | Notes |
|-------------|--------------------------|-------|
| 600 seconds | 5–15 minutes | Fast propagation; good for initial setup |
| 3600 seconds | 30–60 minutes | Standard for stable records |
| 86400 seconds | 24–48 hours | Slow; only for finalized records |

> **Recommendation:** Start with TTL = 600 during initial setup. Once everything is stable, increase to 3600 for better cache performance.

---

## SSL Certificate Considerations

The Cognova AI platform uses Let's Encrypt via Certbot for SSL. For `brain.mr-imperfect.online`, ensure the following:

### Certificate Domains

The `ssl-init.sh` script will request certificates for:
- `brain.mr-imperfect.online` (primary)
- `www.brain.mr-imperfect.online` (optional, via CNAME)

### Nginx Server Name Configuration

Ensure `nginx/templates/default.conf.template` contains the correct `server_name`:

```nginx
server_name brain.mr-imperfect.online www.brain.mr-imperfect.online;
```

This is already configured in the production templates. Verify before first deploy:

```bash
grep -n "server_name" nginx/templates/default.conf.template
```

### Certbot Command Reference

If running manually instead of via `ssl-init.sh`:

```bash
docker run -it --rm \
  -v $(pwd)/certbot_data:/etc/letsencrypt \
  -v $(pwd)/certbot_www:/var/www/certbot \
  -p 80:80 \
  certbot/certbot certonly \
    --standalone \
    --agree-tos \
    --email admin@mr-imperfect.online \
    -d brain.mr-imperfect.online \
    -d www.brain.mr-imperfect.online
```

---

## Troubleshooting

### Issue: DNS Record Not Found

**Symptoms:** `dig` returns nothing or wrong IP.

**Solutions:**
1. Wait 10–15 minutes for propagation (TTL is 600s).
2. Check that the record Name field is exactly `brain`, not `brain.mr-imperfect.online`.
3. Verify you are editing the correct domain (`mr-imperfect.online`, not another domain in your account).
4. Flush local DNS cache:
   ```bash
   # Windows
   ipconfig /flushdns

   # macOS
   sudo killall -HUP mDNSResponder

   # Linux (systemd-resolved)
   sudo systemd-resolve --flush-caches
   ```

### Issue: GoDaddy Shows "Invalid IP Address"

**Symptoms:** Error when saving the A record.

**Solutions:**
1. Ensure the IP is a valid IPv4 address (four numbers, 0–255, separated by dots).
2. Do NOT include a port number (e.g., `192.0.2.100:3000` is invalid).
3. Do NOT use a private IP (e.g., `192.168.x.x`, `10.x.x.x`, `172.16.x.x`).

### Issue: CNAME Conflicts with A Record

**Symptoms:** GoDaddy refuses to save the CNAME.

**Solutions:**
1. Ensure there is no existing A record for `www.brain` before creating the CNAME.
2. In GoDaddy, you cannot have both an A record and a CNAME for the same name. Delete the A record first if it exists.

### Issue: SSL Certificate Fails for Subdomain

**Symptoms:** Certbot reports `UNAUTHORIZED` or `NXDOMAIN` for `brain.mr-imperfect.online`.

**Solutions:**
1. Verify DNS has fully propagated using `dig +short brain.mr-imperfect.online`.
2. Ensure port 80 is open on the server firewall (`ufw allow 80/tcp`).
3. Run Certbot with verbose logging to see the exact challenge URL:
   ```bash
   docker run -it --rm certbot/certbot certonly --standalone \
     -d brain.mr-imperfect.online -v
   ```
4. Check that the server IP returned by DNS matches the server where you run Certbot.

### Issue: Nginx Serves Default Page Instead of Cognova AI

**Symptoms:** Browser shows "Welcome to nginx!" instead of the app.

**Solutions:**
1. Verify `DOMAIN` in `.env` is set to `brain.mr-imperfect.online`.
2. Check nginx `server_name` matches the domain:
   ```bash
   docker compose -f docker-compose.prod.yml exec nginx nginx -t
   ```
3. Reload nginx after any config change:
   ```bash
   docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
   ```

---

## Post-DNS Checklist

After completing the DNS setup, verify the following before proceeding to server deployment:

- [ ] A record for `brain` points to the correct server IP
- [ ] CNAME for `www.brain` points to `brain.mr-imperfect.online` (optional)
- [ ] `dig brain.mr-imperfect.online` returns your server IP from multiple locations
- [ ] Server firewall allows ports 80 and 443
- [ ] `.env` file has `DOMAIN=brain.mr-imperfect.online`
- [ ] `nginx/templates/default.conf.template` has `server_name brain.mr-imperfect.online www.brain.mr-imperfect.online;`
- [ ] SSL initialization script (`scripts/ssl-init.sh`) is ready to run
- [ ] Deployment script (`scripts/deploy.sh`) is configured for the domain

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│  COGNOVA AI DNS — brain.mr-imperfect.online                │
├─────────────────────────────────────────────────────────────┤
│  A Record:     brain → YOUR_SERVER_IP (TTL: 600)           │
│  CNAME Record: www.brain → brain.mr-imperfect.online       │
│                 (TTL: 3600, optional)                     │
├─────────────────────────────────────────────────────────────┤
│  Verify:       dig +short brain.mr-imperfect.online       │
│  Propagation:  5–15 minutes (up to 600s TTL)              │
│  SSL:          scripts/ssl-init.sh                         │
│  Deploy:       scripts/deploy.sh                           │
│  Health:       https://brain.mr-imperfect.online/api/health│
└─────────────────────────────────────────────────────────────┘
```

---

*Last updated: 2025-07-14*  
*Domain: brain.mr-imperfect.online*  
*Platform: Cognova AI — Shadow Brain*
