# Deploying on the self-hosted server (assign_server / games_server)

This mirrors how `AutomatedScripts` deploys (`entries/`, `assign/`): a
**self-hosted GitHub Actions runner on the server** runs
`docker compose up --build -d` on every push. The workflow is
`.github/workflows/deploy.yml`.

> ⚠️ **Key difference from the Telegram bots.** The ardhisasa/entries bots use
> long-polling — no ports, no public web. This WhatsApp bot is different: it
> runs **WAHA + Postgres + an HTTP app**, and has a **public customer shop +
> pay links**, so it needs a reverse proxy + domain (the Telegram bots don't).
> It's also the **unofficial** WhatsApp API — use a dedicated number, and
> expect ~0.5–1 GB extra RAM for WAHA+Postgres. Confirm the host has capacity
> before co-locating it with the other bots.

## One-time server setup

1. **Register a runner for THIS repo** (runners are per-repo; you can't reuse
   the ardhisasa ones). On GitHub: `davidnjau/whatsapp-bot` → Settings →
   Actions → Runners → New self-hosted runner. Install it on the server and
   give it the label **`whatsapp-bot`** (matches `runs-on` in the workflow).
   Keeping a distinct label prevents a push here from ever being routed to the
   assign/entries runners (same principle as your existing CI comments).

2. **Prerequisites on the server:** Docker + the Compose v2 plugin
   (`docker compose version`). If only the old `docker-compose` (v1) binary is
   present, change the two `docker compose` lines in the workflow to
   `docker-compose`.

3. **Create the production `.env`** in the runner's checkout directory for this
   repo (the folder the runner checks the code out into). Copy `.env.example`
   and set real values:
   - Generate every secret with `openssl rand -hex 24`.
   - `APP_BASE_URL=https://yourdomain` (the public URL — this is what the
     WhatsApp pay links use, so it must be reachable from a phone).
   - **Remove any `WAHA_IMAGE=...:arm` line** — the server is x86, so the
     default `devlikeapro/waha:latest` is correct.
   - `INBOX_DIR=/absolute/path/on/server/dressnation-inbox` (where new product
     photos are dropped) or leave it unset to use `./inbox`.
   - Fill `HANDOFF_NUMBER` / `ALERT_WHATSAPP_NUMBER`, SMTP, AI keys as needed.

   `clean: false` in the workflow preserves this `.env` across deploys. The
   named volumes (`waha_sessions`, `pg_data`, `media_data`) live outside the
   checkout, so the WhatsApp link and database survive every redeploy.

4. **Port check.** The app binds `127.0.0.1:8080` only. The existing bots
   publish no ports, so 8080 should be free — confirm with `sudo lsof -i:8080`.
   If taken, set `APP_PORT` in `.env`.

5. **Reverse proxy (new, required for the public shop).** Point a domain at the
   server and proxy it to `127.0.0.1:8080` over HTTPS. If the server already
   runs Caddy, add:

   ```
   shop.yourdomain.com {
       reverse_proxy localhost:8080
   }
   ```

   (or an nginx `server {}` with a certbot cert). Firewall stays 22/80/443 only;
   WAHA and Postgres have no published ports.

## Deploying

Push to the `dressnation` branch (or change the workflow's `if:` and `branches`
to `main` for production). The `test` job runs on a GitHub-hosted runner
(typecheck + 124 unit tests); on success the `deploy` job runs on the server
and rebuilds the stack. Until the `whatsapp-bot` runner exists, the deploy job
just queues harmlessly.

## First run (once)

1. After the first deploy: `docker compose logs -f app` → wait for `app started`.
2. Open `https://shop.yourdomain.com/admin` (user `admin`, password =
   `ADMIN_PASSWORD`), and scan the WhatsApp QR to link the number. The session
   then persists in the `waha_sessions` volume across redeploys.
3. Drop product photos into `INBOX_DIR`, then Admin → Catalogue → Scan inbox.

## Rollback / ops

- Logs: `docker compose logs -f app` (or `waha`).
- Restart only the app after a code change: handled automatically by the
  workflow; manually `docker compose up -d --build app`.
- DB backup (cron): `docker compose exec -T postgres pg_dump -U bot whatsapp_bot | gzip > backup-$(date +%F).sql.gz`.
- Full VPS guide (Caddy, ufw, backups) is in `docs/deploy-vps.md`.
