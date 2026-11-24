# Deploying to a VPS (Ubuntu)

Target: a small Ubuntu 22.04/24.04 VPS (2 GB RAM is plenty), a domain name
(e.g. `bot.example.com`) pointing at the VPS IP, and HTTPS via Caddy.
Only ports 22/80/443 are public; the app listens on localhost and Caddy
proxies to it; WAHA and Postgres are never exposed.

## 1. Install Docker

```bash
sudo apt-get update
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER     # log out and back in afterwards
sudo systemctl enable docker      # auto-start on reboot
```

Containers use `restart: unless-stopped`, so the whole stack comes back by
itself after a reboot or crash.

## 2. Copy the project and configure

```bash
sudo mkdir -p /opt/whatsapp-bot && sudo chown $USER /opt/whatsapp-bot
# from your machine:
rsync -av --exclude node_modules --exclude .env ~/Desktop/whatsapp/ user@VPS:/opt/whatsapp-bot/
```

On the VPS:

```bash
cd /opt/whatsapp-bot
cp .env.example .env
nano .env
```

Fill `.env` (see the README for the section-by-section guide). On the VPS:

- Generate fresh secrets: `openssl rand -hex 24` for each `change-me`.
- Set `APP_BASE_URL=https://bot.example.com`.
- **Remove the `WAHA_IMAGE=devlikeapro/waha:arm` line** if it exists — that's
  only for Apple Silicon; x86 VPSes use the default image.

## 3. Firewall (ufw)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Nothing else needs opening: the app port is bound to `127.0.0.1` in
`docker-compose.yml`, and WAHA/Postgres have no published ports at all.

## 4. Start the stack

```bash
cd /opt/whatsapp-bot
docker compose up -d --build
docker compose logs -f app   # wait for "app started"
```

## 5. HTTPS with Caddy

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```
bot.example.com {
    reverse_proxy localhost:8080
}
```

```bash
sudo systemctl reload caddy
```

Caddy obtains and renews the TLS certificate automatically. Open
`https://bot.example.com/admin`, log in, and link the phone (WhatsApp →
Linked devices → scan the QR).

## 6. Daily Postgres backups

```bash
sudo mkdir -p /opt/whatsapp-bot/backups
crontab -e
```

Add (3:30 AM daily, keep 14 days):

```cron
30 3 * * * cd /opt/whatsapp-bot && docker compose exec -T postgres pg_dump -U bot whatsapp_bot | gzip > backups/db-$(date +\%F).sql.gz && find backups -name 'db-*.sql.gz' -mtime +14 -delete
```

Restore with:

```bash
gunzip -c backups/db-2026-11-25.sql.gz | docker compose exec -T postgres psql -U bot whatsapp_bot
```

The WhatsApp session lives in the `waha_sessions` Docker volume and uploaded
media in `media_data` — include them in full-server snapshots if your VPS
provider offers them.

## 7. Updating safely

**App code changes:**

```bash
cd /opt/whatsapp-bot
docker compose up -d --build app
```

**WAHA updates** (the WhatsApp link survives — session data is in a volume):

```bash
docker compose pull waha
docker compose up -d waha
curl -s https://bot.example.com/health   # expect "waha":"WORKING"
```

If the session ever comes back `SCAN_QR_CODE` after an update, re-link from
the admin home page. Take a DB backup before major WAHA version jumps.

## 8. Health monitoring

The built-in watchdog already checks the session every 5 minutes and alerts
`ALERT_WHATSAPP_NUMBER` (and `ALERT_EMAIL` if SMTP is configured). For
external uptime monitoring, point any pinger (UptimeRobot etc.) at
`https://bot.example.com/health`.
