import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { config } from '../config.js'
import { query } from '../db.js'
import { toChatId } from '../lib/phone.js'
import { enqueueSend, queueStats } from '../queue/index.js'
import { waha } from '../waha/client.js'
import { checkAdminCredentials, requireApiAuth, requireWebAuth, SESSION_COOKIE } from './auth.js'

async function sessionStatus(): Promise<string> {
  try {
    const session = await waha.getSession()
    return session?.status ?? 'MISSING'
  } catch {
    return 'WAHA_UNREACHABLE'
  }
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // --- web shell ---
  app.get('/admin/login', async (_req, reply) => reply.view('login.njk', { error: null }))

  app.post('/admin/login', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (req, reply) => {
    const body = z
      .object({ username: z.string().default(''), password: z.string().default('') })
      .parse(req.body ?? {})
    if (!checkAdminCredentials(body.username, body.password)) {
      return reply.code(401).view('login.njk', { error: 'Invalid username or password' })
    }
    reply.setCookie(SESSION_COOKIE, 'ok', {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto', // secure flag when served over HTTPS (behind Caddy)
      path: '/',
      maxAge: 7 * 24 * 3600,
    })
    return reply.redirect('/admin')
  })

  app.post('/admin/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.redirect('/admin/login')
  })

  app.get('/admin', { preHandler: requireWebAuth }, async (_req, reply) => {
    const [status, today, queued, webhookErrors, failedSends] = await Promise.all([
      sessionStatus(),
      query<{ metric: string; count: string }>(
        `SELECT 'in' AS metric, count(*) FROM messages
           WHERE from_me = false AND created_at AT TIME ZONE $1 >= (now() AT TIME ZONE $1)::date
         UNION ALL
         SELECT module, count(*) FROM sends
           WHERE sent_at IS NOT NULL AND sent_at AT TIME ZONE $1 >= (now() AT TIME ZONE $1)::date
           GROUP BY module`,
        [config.tz],
      ),
      query<{ count: string }>(`SELECT count(*) FROM sends WHERE status = 'queued'`),
      query<{ event_type: string; error: string; received_at: Date }>(
        `SELECT event_type, error, received_at FROM webhook_events
         WHERE error IS NOT NULL ORDER BY received_at DESC LIMIT 5`,
      ),
      query<{ chat_id: string; kind: string; error: string | null; created_at: Date }>(
        `SELECT chat_id, kind, error, created_at FROM sends
         WHERE status = 'failed' ORDER BY created_at DESC LIMIT 5`,
      ),
    ])
    const counts: Record<string, number> = {}
    for (const row of today.rows) {
      counts[row.metric] = (counts[row.metric] ?? 0) + Number(row.count)
    }
    return reply.view('home.njk', {
      authed: true,
      status,
      session: config.wahaSession,
      today: {
        messagesIn: counts.in ?? 0,
        replies: counts.support ?? 0,
        notifications: counts.notify ?? 0,
        groupPosts: counts.groups ?? 0,
        statuses: counts.status ?? 0,
      },
      queued: Number(queued.rows[0].count),
      webhookErrors: webhookErrors.rows,
      failedSends: failedSends.rows,
    })
  })

  app.get('/admin/qr.png', { preHandler: requireWebAuth }, async (_req, reply) => {
    const png = await waha.getQrPng()
    return reply.type('image/png').send(png)
  })

  app.post('/admin/session/restart', { preHandler: requireWebAuth }, async (_req, reply) => {
    await waha.restartSession()
    return reply.redirect('/admin')
  })

  // --- admin API (ADMIN_API_TOKEN) ---
  app.get('/api/admin/status', { preHandler: requireApiAuth }, async () => {
    const [status, stats] = await Promise.all([sessionStatus(), queueStats()])
    return { session: config.wahaSession, status, queue: stats }
  })

  app.post('/api/admin/session/restart', { preHandler: requireApiAuth }, async () => {
    await waha.restartSession()
    return { ok: true }
  })

  // Manual test send — handy for verifying the queue end to end.
  app.post('/api/admin/send', { preHandler: requireApiAuth }, async (req, reply) => {
    const body = z.object({ phone: z.string(), text: z.string().min(1) }).safeParse(req.body)
    if (!body.success) {
      return reply.code(400).send({ error: 'expected { phone, text }' })
    }
    const chatId = toChatId(body.data.phone)
    if (!chatId) {
      return reply.code(400).send({ error: 'invalid phone number' })
    }
    const sendId = await enqueueSend({
      chatId,
      module: 'admin',
      kind: 'manual',
      payload: { type: 'text', text: body.data.text },
    })
    return { ok: true, sendId }
  })
}
