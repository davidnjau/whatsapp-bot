You are a senior backend engineer. Build a self-hosted WhatsApp automation system
on WAHA (github.com/devlikeapro/waha, docs: waha.devlike.pro). Always check the
WAHA docs/Swagger before writing integration code; never guess endpoint paths or
env var names. Build in the order of the sections below and follow the
CHECKPOINT rules in Section 9.

=====================================================================
SECTION 0 — BUSINESS CONTEXT
=====================================================================
- Business name: [BUSINESS NAME]
- What we do: [SHORT DESCRIPTION]
- Location / timezone: [CITY], Africa/Nairobi
- Customer languages: [e.g. English and Swahili]
- Business hours: [e.g. Mon–Sat 08:00–18:00]
- Human support contact: [NAME + WhatsApp number]
- Brand tone: [e.g. friendly, short, professional]

=====================================================================
SECTION 1 — FOUNDATION
=====================================================================
Stack:
- Docker Compose: waha (devlikeapro/waha, engine GOWS), postgres, app
  (Node.js + TypeScript strict, Fastify, zod validation, structured logging).
- WAHA session data stored in Postgres so the WhatsApp link survives restarts.

Build:
1. Project structure, Docker Compose, DB migrations, health check (GET /health).
2. Typed WAHA client wrapper + session bootstrap: create/start WAHA_SESSION and
   expose the QR for linking (WhatsApp → Linked devices → scan QR).
3. Webhook receiver POST /webhooks/waha: verify WEBHOOK_SECRET, dedupe by
   message id, store raw events, route by event type to module handlers.
   Ignore our own outgoing messages.
4. Shared OUTGOING SEND QUEUE (BullMQ or Postgres-backed) used by ALL modules:
   random delay between SEND_MIN/MAX_DELAY_SECONDS, cap SEND_MAX_PER_HOUR,
   retry with backoff, log ack/delivery status.
5. Phone utilities: normalize Kenyan/international numbers to 2547XXXXXXXX@c.us.
6. Contacts table with opt-in/opt-out ("STOP" = opt-out, "START" = opt-in).
7. Session watchdog: if the WhatsApp session disconnects, alert ALERT_* contacts.
8. Admin API auth (ADMIN_API_TOKEN) and an admin web shell with login.

=====================================================================
SECTION 2 — ENVIRONMENT (.env.example, create exactly like this)
=====================================================================
# ===== 1. APP =====
NODE_ENV=production
APP_PORT=8080
APP_BASE_URL=https://bot.example.com
TZ=Africa/Nairobi
LOG_LEVEL=info

# ===== 2. WAHA (WhatsApp connection) =====
WAHA_URL=http://waha:3000
WAHA_API_KEY=change-me
WAHA_SESSION=default
WHATSAPP_DEFAULT_ENGINE=GOWS
WAHA_DASHBOARD_USERNAME=admin
WAHA_DASHBOARD_PASSWORD=change-me
WEBHOOK_SECRET=change-me

# ===== 3. DATABASE =====
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=whatsapp_bot
POSTGRES_USER=bot
POSTGRES_PASSWORD=change-me

# ===== 4. ADMIN PANEL =====
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me
ADMIN_API_TOKEN=change-me
SESSION_SECRET=change-me

# ===== 5. AI (Module 1 only — optional) =====
AI_PROVIDER=none            # none | anthropic | openai | gemini | ollama
AI_MODEL=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
OLLAMA_URL=http://ollama:11434

# ===== 6. SUPPORT BOT (Module 1) =====
BOT_ENABLED=true
BUSINESS_HOURS=Mon-Sat 08:00-18:00
HANDOFF_NUMBER=2547XXXXXXXX
MAX_REPLIES_PER_CHAT_PER_HOUR=30

# ===== 7. SENDING LIMITS (Modules 2, 3, 4) =====
SEND_MIN_DELAY_SECONDS=3
SEND_MAX_DELAY_SECONDS=10
SEND_MAX_PER_HOUR=200

# ===== 8. ALERTS =====
ALERT_WHATSAPP_NUMBER=2547XXXXXXXX
ALERT_EMAIL=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=

If any WAHA variable name differs in the current docs, use the correct one and
tell me. Pass WAHA only the variables it needs; sections 4–8 are for the app.

=====================================================================
SECTION 3 — MODULE 1: CUSTOMER SUPPORT BOT
=====================================================================
1. Handle incoming 1:1 messages only (ignore groups, status@broadcast, our own).
2. Two modes controlled by AI_PROVIDER:
   - none: menu/keyword bot from /knowledge/menu.yaml
     (e.g. 1 Prices, 2 Delivery, 3 Location/hours, 0 Talk to a person),
     keyword matching in English and Swahili.
   - anthropic | openai | gemini | ollama: AI replies behind ONE provider
     interface so providers are swappable. Context = last ~20 messages of the
     chat + knowledge base in /knowledge/*.md. Reply in the customer's language.
     Never invent prices, stock or policies not in the knowledge base; if
     unsure, hand off.
3. Show "typing…" via WAHA before replying.
4. Media (images, voice notes, documents): acknowledge politely, flag for staff.
5. Human handoff: on request for a human, anger, or low confidence → pause bot
   for that chat, send HANDOFF_NUMBER a summary, staff can resume with
   "#bot on" and pause with "#bot off" in the chat.
6. Outside BUSINESS_HOURS: send the hours message, still answer FAQs.
7. Respect BOT_ENABLED (global kill switch) and MAX_REPLIES_PER_CHAT_PER_HOUR.
8. Admin: conversation list, chat view, pause/resume per chat, knowledge editor.
9. Tests: message filtering, menu matching, handoff triggers, provider switch.

=====================================================================
SECTION 4 — MODULE 2: AUTOMATIC NOTIFICATIONS
=====================================================================
All sends MUST go through the shared send queue.
1. POST /notify (auth ADMIN_API_TOKEN): {phone, template, variables, sendAt?}.
2. Templates in DB, editable in admin, with {{variables}}. Seed:
   order_confirmed, payment_received, out_for_delivery, appointment_reminder.
3. Scheduler for reminders (e.g. 24h and 1h before an appointment) and one-off
   scheduled messages; must survive restarts.
4. Only send to opted-in contacts; skip and log opted-out numbers.
5. Optional attachment per notification (e.g. receipt PDF, image).
6. Track status: queued, sent, delivered, read, failed.
7. Admin: template editor, send-one form, CSV import of opted-in recipients,
   notification log with filters.
8. Provide example curl calls and short guides for calling /notify from a
   website, Google Sheets (Apps Script) and n8n.
9. Tests: template rendering, opt-out enforcement, scheduling.

=====================================================================
SECTION 5 — MODULE 3: GROUP TOOLS
=====================================================================
All sends go through the shared send queue.
1. Wrap WAHA group endpoints: list, create, get info, add/remove participants,
   promote/demote admins, update subject/description/picture,
   get/revoke invite link, leave group.
2. Announcements: text/image/document to one or many groups, now or scheduled,
   throttled between groups.
3. Welcome message when someone joins a group we admin (per-group toggle,
   editable text with {{name}}).
4. Light moderation (per-group toggle): keyword auto-replies; optionally flag
   links posted by non-admins. Never reply to normal group chatter; use AI in
   groups only when explicitly @mentioned and AI_PROVIDER is not none.
5. Admin: group list, participants, announcement composer + scheduler,
   per-group settings.
6. Tests: group event handling, scheduling, mention detection.

=====================================================================
SECTION 6 — MODULE 4: WHATSAPP STATUS
=====================================================================
Verify the Status endpoints in the WAHA docs (engine GOWS).
1. Post via POST /api/{session}/status/{text|image|video|voice}:
   - text: text, backgroundColor, font
   - image: file (url or upload) + caption
   - video: MP4/H.264, otherwise set convert: true
   - voice: file + backgroundColor
2. Audience: default all contacts; optional "contacts" list built from saved
   audience groups (e.g. "VIP customers") using contact IDs.
3. Scheduled and recurring statuses (e.g. daily promo at 09:00).
4. Delete a posted status via /status/delete; keep history with IDs.
5. Media library in admin: upload once, reuse.
6. Admin: status composer with preview, scheduler, history, delete button.
7. Tests: payload building per type, scheduling, audience resolution.

=====================================================================
SECTION 7 — ADMIN DASHBOARD
=====================================================================
1. Home: session status + relink QR, today's counts (messages in, replies,
   notifications, group posts, statuses), queue length, recent errors.
2. One navigation with pages for each module above.
3. Mobile-friendly layout (I will often use it from my phone).

=====================================================================
SECTION 8 — SECURITY, DEPLOYMENT & DOCS
=====================================================================
1. Security: secrets only from env, rate limits on public endpoints, webhook
   verification, admin auth, no secrets in logs, WAHA not publicly exposed.
2. VPS deployment guide (Ubuntu): Docker install, HTTPS with Caddy, firewall
   (only 80/443 public), auto-restart, daily Postgres backups, safe WAHA updates.
3. README: setup from zero, filling .env section by section, linking the phone,
   using each module, troubleshooting (logged out, QR expired, not sending).
4. Clear warning: WAHA is unofficial — use a dedicated number, only message
   opted-in contacts, keep send limits, no spam.

=====================================================================
SECTION 9 — HOW TO WORK (CHECKPOINTS)
=====================================================================
1. Before writing code: reply with the architecture, folder structure, DB schema
   and the exact WAHA endpoints you'll use (verified from docs). Wait for my OK.
2. Build Section 1 + 2, run tests, give me commands to start it and link my
   phone. STOP and wait for my OK.
3. Then build Sections 3, 4, 5, 6 one at a time. After each: run tests,
   summarise what was built and how to try it, then STOP and wait for my OK.
4. Finish with Sections 7 and 8, run all tests, and give the final command list.