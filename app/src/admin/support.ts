import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db.js'
import { setBotPaused } from '../modules/support/handoff.js'
import {
  KNOWN_KNOWLEDGE_FILES,
  readKnowledgeFile,
  writeKnowledgeFile,
} from '../modules/support/knowledge.js'
import { requireWebAuth } from './auth.js'
import { renderChat, renderChatList } from './whatsapp-chat-ui.js'

export const adminSupportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWebAuth)

  app.get<{ Querystring: { page?: string; q?: string } }>('/admin/chats', async (req, reply) => {
    const chats = await query<{
      chat_id: string
      bot_paused: boolean
      name: string | null
      phone: string | null
      last_body: string | null
      last_at: Date | null
    }>(
      // Resolve a display name: this contact's own name, else any contact or
      // order with the same phone (so a @c.us chat shows the name we saved on
      // the @lid row / at checkout). Unknown numbers just stay as the number.
      `SELECT c.chat_id, c.bot_paused, COALESCE(ph.phone, ct.phone) AS phone,
              COALESCE(
                NULLIF(ct.name, ''),
                (SELECT c2.name FROM contacts c2 WHERE c2.phone = ph.phone AND NULLIF(c2.name, '') IS NOT NULL ORDER BY c2.chat_id LIMIT 1),
                (SELECT o.customer_name FROM orders o WHERE o.phone = ph.phone AND NULLIF(o.customer_name, '') IS NOT NULL ORDER BY o.created_at DESC LIMIT 1)
              ) AS name,
              m.body AS last_body, m.created_at AS last_at
       FROM chats c
       LEFT JOIN contacts ct ON ct.chat_id = c.chat_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(ct.phone, CASE WHEN c.chat_id LIKE '%@c.us' THEN replace(c.chat_id, '@c.us', '') END) AS phone
       ) ph ON true
       LEFT JOIN LATERAL (
         SELECT body, created_at FROM messages
         WHERE chat_id = c.chat_id ORDER BY created_at DESC LIMIT 1
       ) m ON true
       WHERE c.kind = 'dm'
       ORDER BY m.created_at DESC NULLS LAST
       LIMIT 500`,
    )
    const body = renderChatList({
      chats: chats.rows.map((r) => ({
        id: r.chat_id,
        name: r.name,
        number: r.phone,
        lastMessage: r.last_body,
        lastTimestamp: r.last_at,
        paused: r.bot_paused,
      })),
      page: req.query.page,
      q: req.query.q,
    })
    return reply.view('chats.njk', { authed: true, body })
  })

  app.get<{ Params: { chatId: string }; Querystring: { before?: string } }>(
    '/admin/chats/:chatId',
    async (req, reply) => {
      const chatId = req.params.chatId
      const before = req.query.before && /^\d+$/.test(req.query.before) ? req.query.before : null
      const [chat, contact, messages] = await Promise.all([
        query<{ chat_id: string; bot_paused: boolean }>(
          'SELECT chat_id, bot_paused FROM chats WHERE chat_id = $1',
          [chatId],
        ),
        // Same name resolution as the list: own contact name, else a name saved
        // for the same phone on another contact row or at checkout.
        query<{ name: string | null; phone: string | null }>(
          `SELECT COALESCE(
                    NULLIF(ct.name, ''),
                    (SELECT c2.name FROM contacts c2 WHERE c2.phone = ph.phone AND NULLIF(c2.name, '') IS NOT NULL ORDER BY c2.chat_id LIMIT 1),
                    (SELECT o.customer_name FROM orders o WHERE o.phone = ph.phone AND NULLIF(o.customer_name, '') IS NOT NULL ORDER BY o.created_at DESC LIMIT 1)
                  ) AS name,
                  COALESCE(ph.phone, ct.phone) AS phone
           FROM (SELECT $1::text AS chat_id) base
           LEFT JOIN contacts ct ON ct.chat_id = base.chat_id
           LEFT JOIN LATERAL (
             SELECT COALESCE(ct.phone, CASE WHEN base.chat_id LIKE '%@c.us' THEN replace(base.chat_id, '@c.us', '') END) AS phone
           ) ph ON true`,
          [chatId],
        ),
        // Page in the DB: newest 40 before the cursor (+1 to detect older), then reverse.
        query<{ body: string | null; from_me: boolean; created_at: Date }>(
          `SELECT body, from_me, created_at FROM messages
           WHERE chat_id = $1 AND ($2::bigint IS NULL OR created_at < to_timestamp($2::bigint / 1000.0))
           ORDER BY created_at DESC LIMIT 41`,
          [chatId, before],
        ),
      ])
      if (!chat.rows[0]) return reply.callNotFound()
      const c = contact.rows[0] ?? null
      const body = renderChat({
        chat: { id: chatId, name: c?.name, number: c?.phone, paused: chat.rows[0].bot_paused },
        messages: messages.rows.reverse().map((m) => ({
          fromMe: m.from_me,
          body: m.body ?? '',
          timestamp: m.created_at,
        })),
        before: before ?? undefined,
      })
      return reply.view('chat.njk', { authed: true, body })
    },
  )

  // Single button in the WhatsApp UI posts here — toggle based on current state.
  app.post<{ Params: { chatId: string } }>('/admin/chats/:chatId/pause', async (req, reply) => {
    const cur = await query<{ bot_paused: boolean }>('SELECT bot_paused FROM chats WHERE chat_id = $1', [
      req.params.chatId,
    ])
    const nowPaused = !cur.rows[0]?.bot_paused
    await setBotPaused(req.params.chatId, nowPaused, nowPaused ? 'admin' : null)
    return reply.redirect(`/admin/chats/${encodeURIComponent(req.params.chatId)}`)
  })

  app.post<{ Params: { chatId: string } }>('/admin/chats/:chatId/resume', async (req, reply) => {
    await setBotPaused(req.params.chatId, false, null)
    return reply.redirect(`/admin/chats/${encodeURIComponent(req.params.chatId)}`)
  })

  app.get('/admin/knowledge', async (_req, reply) => {
    // The friendly editor loads the three files' current contents from here.
    const seed: Record<string, string> = {}
    for (const name of KNOWN_KNOWLEDGE_FILES) {
      seed[name] = await readKnowledgeFile(name).catch(() => '')
    }
    // Inline-script-safe: escape < so the JSON can't break out of <script>.
    const seedJson = JSON.stringify(seed).replace(/</g, '\\u003c')
    return reply.view('knowledge.njk', { authed: true, seedJson })
  })

  app.post<{ Params: { name: string } }>('/admin/knowledge/:name', async (req, reply) => {
    const name = req.params.name
    if (!(KNOWN_KNOWLEDGE_FILES as readonly string[]).includes(name)) {
      return reply.code(400).send({ ok: false, error: 'Unknown file.' })
    }
    const body = z.object({ content: z.string() }).parse(req.body ?? {})
    try {
      await writeKnowledgeFile(name, body.content)
      return reply.send({ ok: true })
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message })
    }
  })
}
