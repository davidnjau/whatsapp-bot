import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db.js'
import { setBotPaused } from '../modules/support/handoff.js'
import {
  isValidKnowledgeFileName,
  listKnowledgeFiles,
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
      `SELECT c.chat_id, c.bot_paused, ct.name, ct.phone,
              m.body AS last_body, m.created_at AS last_at
       FROM chats c
       LEFT JOIN contacts ct ON ct.chat_id = c.chat_id
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
        query<{ name: string | null; phone: string | null }>(
          'SELECT name, phone FROM contacts WHERE chat_id = $1',
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
    const files = await listKnowledgeFiles()
    return reply.view('knowledge.njk', { authed: true, files })
  })

  app.get<{ Params: { name: string } }>('/admin/knowledge/:name', async (req, reply) => {
    if (!isValidKnowledgeFileName(req.params.name)) return reply.callNotFound()
    const content = await readKnowledgeFile(req.params.name)
    return reply.view('knowledge_edit.njk', {
      authed: true,
      name: req.params.name,
      content,
      error: null,
      saved: false,
    })
  })

  app.post<{ Params: { name: string } }>('/admin/knowledge/:name', async (req, reply) => {
    if (!isValidKnowledgeFileName(req.params.name)) return reply.callNotFound()
    const body = z.object({ content: z.string() }).parse(req.body ?? {})
    try {
      await writeKnowledgeFile(req.params.name, body.content)
    } catch (err) {
      return reply.view('knowledge_edit.njk', {
        authed: true,
        name: req.params.name,
        content: body.content,
        error: (err as Error).message,
        saved: false,
      })
    }
    return reply.view('knowledge_edit.njk', {
      authed: true,
      name: req.params.name,
      content: body.content,
      error: null,
      saved: true,
    })
  })
}
