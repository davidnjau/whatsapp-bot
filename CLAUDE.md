# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Self-hosted WhatsApp automation on [WAHA](https://waha.devlike.pro) (engine
GOWS): support bot (menu/AI), notifications API, group tools, Status posting,
admin panel. `whatspp.md` is the original build spec; all sections are built.
Verify any WAHA endpoint or env var against waha.devlike.pro docs — never
guess.

## Commands

```bash
cd app && npm test              # vitest unit tests (pure logic, no services)
cd app && npm run typecheck     # tsc --noEmit
docker compose up -d --build    # run/rebuild the full stack (waha, postgres, app)
docker compose up -d --build app  # redeploy app code only
docker compose logs -f app      # tail app logs (pino JSON)
curl -s localhost:8080/health   # {"status":"ok","waha":"WORKING"}
```

Tests import only dependency-free modules — config parses env at import time,
so pure logic lives in separate files (`classify.ts`, `render.ts`,
`logic.ts`, `payload.ts`, `throttle.ts`, `policy.ts`) that never import
`config.ts`/`db.ts`. Keep it that way when adding testable logic.

## Architecture (app/src)

- **Inbound**: WAHA → `POST /webhooks/waha` (`webhooks/routes.ts`): HMAC
  SHA512 verify over raw body → dedupe (`webhook_events.event_key`; message
  events dedupe by message id) → `router.ts` dispatches by event type →
  `messages.ts` (DMs: store, contacts, STOP/START, then support bot) or
  `modules/groups` (group messages + joins).
- **Outbound**: `enqueueSend()` in `queue/index.ts` is the ONLY send path
  (pg-boss, Postgres-backed — no Redis). The worker (`queue/worker.ts`)
  enforces pacing, `SEND_MAX_PER_HOUR`, retries, and **opt-out** (kinds in
  `queue/policy.ts` are exempt; everything else skips opted-out contacts).
  Delivery acks (`message.ack`) update `sends.status` monotonically.
- **Modules** (`modules/`): `support` (menu bot + AI providers behind one
  `AiProvider` interface; `[HANDOFF]` token = give up to human), `notify`
  (`POST /notify`, DB templates `{{var}}`), `groups`, `status` (audiences,
  media library, pg-boss cron for daily; recurring re-registered at boot).
- **Admin**: server-rendered Nunjucks + Tailwind CDN in `admin/*.ts` +
  `views/*.njk`; web auth = signed cookie, API auth = `ADMIN_API_TOKEN`
  Bearer. Scheduling survives restarts via pg-boss (jobs + cron in Postgres).
- Migrations: plain SQL in `app/migrations/`, auto-applied at boot under an
  advisory lock. Add a new numbered file; never edit applied ones.

## Hard-won gotchas (do not regress)

- **GOWS sends `"to": null` etc.** — every optional field in webhook payload
  zod schemas must be `.nullish()`, not `.optional()`.
- **`@lid` chats** — WhatsApp privacy addressing; counts as a DM. Real phone
  comes from `payload._data.Info.SenderAlt`, name from `Info.PushName`.
- **FAILED WAHA sessions** need `restart`, not `start` (start is a no-op);
  see `waha/bootstrap.ts`.
- **WAHA media Postgres URL needs `?sslmode=disable`**; Apple Silicon needs
  `WAHA_IMAGE=devlikeapro/waha:arm` (set via `.env`, compose default is
  `:latest` for x86).
- Session transitions (STOPPED/STARTING/SCAN_QR_CODE) are normal during
  linking — only FAILED alerts instantly; the 5-min watchdog catches
  persistent trouble.
- `/status/delete` may be unsupported on GOWS — surface WAHA's error, don't
  hide it.

## Invariants

- Every outbound message goes through `enqueueSend` — never call
  `waha.send*` from modules.
- Opt-out enforcement stays in the worker (single point); bot never replies
  to group chatter unless welcome/keyword/@mention rules say so.
- Timezone Africa/Nairobi (`TZ` env) for business hours, "today" stats, cron.
- WAHA and Postgres are never publicly exposed; app binds 127.0.0.1 (Caddy
  proxies in prod — see docs/deploy-vps.md).
