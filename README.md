# WhatsApp Automation Bot (WAHA)

Self-hosted WhatsApp automation for a small business: a customer support bot
(menu or AI), transactional notifications, group tools, and WhatsApp Status
posting — with a mobile-friendly admin panel. Built on
[WAHA](https://waha.devlike.pro) (engine GOWS), Node.js/TypeScript, Fastify,
and Postgres, all running under Docker Compose.

> ## ⚠️ Read this first
> WAHA uses the **unofficial** WhatsApp Web protocol. WhatsApp can ban numbers
> that spam. Protect yourself:
> - Use a **dedicated number**, not your personal one.
> - Message **only people who opted in**; honor STOP instantly (the bot
>   enforces this automatically at the send layer).
> - Keep the built-in send limits (3–10s pacing, hourly cap) — don't raise
>   them to blast messages.
> - No cold outreach, no bulk marketing to strangers.

## Quick start (local)

Requirements: Docker Desktop. On Apple Silicon keep the `WAHA_IMAGE` line in
`.env` (see below); on x86 remove it.

```bash
cp .env.example .env     # then fill it in — see the next section
docker compose up -d --build
docker compose logs -f app          # wait for "app started"
open http://localhost:8080/admin    # log in with ADMIN_USERNAME / ADMIN_PASSWORD
```

**Link the phone:** on the admin home page the session shows `SCAN_QR_CODE`
with a QR. On the phone: WhatsApp → Settings → Linked devices → Link a device
→ scan. Status flips to `WORKING` and everything is live.

For production, follow [docs/deploy-vps.md](docs/deploy-vps.md) (Ubuntu +
Caddy HTTPS + firewall + backups).

## Filling .env, section by section

Generate each secret with `openssl rand -hex 24`.

**1. APP** — `APP_PORT` (default 8080), `APP_BASE_URL` (your public URL, used
in alert links), `TZ` (Africa/Nairobi: business hours + schedules use it).

**2. WAHA** — `WAHA_API_KEY` (secret the app uses to call WAHA),
`WAHA_SESSION` (leave `default`), `WHATSAPP_DEFAULT_ENGINE=GOWS`,
`WAHA_DASHBOARD_USERNAME/PASSWORD` (WAHA's own debug dashboard — internal
only), `WEBHOOK_SECRET` (HMAC key for webhooks WAHA → app).
On Apple Silicon also add: `WAHA_IMAGE=devlikeapro/waha:arm`.

**3. DATABASE** — Postgres name/user/password (internal to Docker; just set a
strong password).

**4. ADMIN PANEL** — `ADMIN_USERNAME/ADMIN_PASSWORD` (web login),
`ADMIN_API_TOKEN` (Bearer token for `/notify` and the admin API),
`SESSION_SECRET` (cookie signing).

**5. AI (optional)** — `AI_PROVIDER=none` gives the keyword/menu bot. Set
`anthropic` | `openai` | `gemini` | `ollama` plus the matching API key for AI
replies. `AI_MODEL` overrides the default model (e.g. `claude-haiku-4-5`).

**6. SUPPORT BOT** — `BOT_ENABLED` (global kill switch),
`BUSINESS_HOURS` (`Mon-Sat 08:00-18:00`), `HANDOFF_NUMBER` (staff WhatsApp
that receives handoffs/flags), `MAX_REPLIES_PER_CHAT_PER_HOUR`.

**7. SENDING LIMITS** — random delay between sends
(`SEND_MIN/MAX_DELAY_SECONDS`) and `SEND_MAX_PER_HOUR` across all modules.

**8. ALERTS** — `ALERT_WHATSAPP_NUMBER` and optionally `ALERT_EMAIL` + SMTP
settings; the watchdog warns you if the WhatsApp session dies.

## Using each module

**Support bot** — customers message the linked number. With `AI_PROVIDER=none`
they get the menu from `knowledge/menu.yaml` (numbers + EN/Swahili keywords).
With AI, replies come strictly from `knowledge/*.md` — anything not covered
hands off to a human. Edit both in **Admin → Knowledge**. Handoff triggers:
asking for a human, angry messages, menu option 0, or low AI confidence —
the bot pauses for that chat and `HANDOFF_NUMBER` gets a summary. Staff
control inside any customer chat: send `#bot off` / `#bot on` (or use the
buttons in Admin → Chats). Outside business hours the bot prepends the
closed message but still answers. `STOP` opts a customer out, `START` back in.

**Notifications** — templates with `{{variables}}` in **Admin → Templates**
(seeded: order_confirmed, payment_received, out_for_delivery,
appointment_reminder). Send one-offs from **Admin → Notify**, import opted-in
recipients (CSV) in **Admin → Contacts**, watch delivery in the log. From
code:

```bash
curl -X POST $APP_BASE_URL/notify \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"phone":"0712345678","template":"order_confirmed",
       "variables":{"name":"Alice","order_id":"A-1","total":"KES 2,500"}}'
```

`sendAt` schedules for later; `POST /notify/appointment` auto-creates 24h and
1h reminders. Website/Google Sheets/n8n recipes:
[docs/notify-integrations.md](docs/notify-integrations.md). Opted-out numbers
are skipped automatically and logged as `skipped_optout`.

**Groups** — **Admin → Groups**: per-group welcome message (`{{name}}`),
keyword auto-replies (`price, bei => reply`), link-flagging for non-admins,
participant management, invite links. **Admin → Groups → Announcements**
posts text/image/document to many groups at once, now or scheduled. In
groups the bot only ever speaks when configured: welcome, keyword rules, or
when explicitly **@mentioned** (AI mode only).

**Status** — **Admin → Status**: text (color/font), image, video, voice
statuses; post now, once at a time, or daily; audience = all contacts or a
saved list (**Audiences**); reusable uploads in **Media library**; history
with delete. Note: status delete may be rejected by the GOWS engine — the UI
shows WAHA's actual response.

## Troubleshooting

**Session shows FAILED / "logged out"** — someone unlinked the device, or
WhatsApp dropped the session. Open Admin home → Restart session → scan the
QR again. The watchdog will have alerted you already.

**QR expired before I scanned** — each QR lives ~20–60s and WAHA gives up
after a few. Hit **Restart session** on the admin home to get a fresh one.

**Messages not sending** — check in order:
1. Admin home: session must be `WORKING`.
2. Queue card: if "In queue" is growing, look at Recent errors on the same page.
3. `docker compose logs app --tail 50` — send failures log the WAHA error.
4. Hourly cap reached? Sends resume automatically in the next window.
5. Recipient opted out? The log shows `skipped_optout` — that's by design.

**Bot doesn't reply to a customer** — is `BOT_ENABLED=true`? Is that chat
paused (Admin → Chats shows a "bot paused" badge — resume it)? Per-chat
hourly reply cap reached?

**`no matching manifest for linux/arm64`** — Apple Silicon needs
`WAHA_IMAGE=devlikeapro/waha:arm` in `.env`.

**Health check** — `GET /health` returns `{"status":"ok","waha":"WORKING"}`
when everything is up.

## Development

```bash
cd app
npm install
npm test            # unit tests (no services needed)
npm run typecheck
```

Migrations in `app/migrations/*.sql` run automatically at app start. Rebuild
the running stack after code changes: `docker compose up -d --build app`.
