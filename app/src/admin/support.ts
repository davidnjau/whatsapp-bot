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

export const adminSupportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWebAuth)

  app.get('/admin/chats', async (_req, reply) => {
    const chats = await query<{
      chat_id: string
      bot_paused: boolean
      paused_reason: string | null
      name: string | null
      last_body: string | null
      last_at: Date | null
    }>(
      `SELECT c.chat_id, c.bot_paused, c.paused_reason, ct.name,
              m.body AS last_body, m.created_at AS last_at
       FROM chats c
       LEFT JOIN contacts ct ON ct.chat_id = c.chat_id
       LEFT JOIN LATERAL (
         SELECT body, created_at FROM messages
         WHERE chat_id = c.chat_id ORDER BY created_at DESC LIMIT 1
       ) m ON true
       WHERE c.kind = 'dm'
       ORDER BY m.created_at DESC NULLS LAST
       LIMIT 100`,
    )
    return reply.view('chats.njk', { authed: true, chats: chats.rows })
  })

  app.get<{ Params: { chatId: string } }>('/admin/chats/:chatId', async (req, reply) => {
    const chatId = req.params.chatId
    const [chat, contact, messages] = await Promise.all([
      query<{ chat_id: string; bot_paused: boolean; paused_reason: string | null }>(
        'SELECT chat_id, bot_paused, paused_reason FROM chats WHERE chat_id = $1',
        [chatId],
      ),
      query<{ name: string | null; phone: string | null; opted_in: boolean }>(
        'SELECT name, phone, opted_in FROM contacts WHERE chat_id = $1',
        [chatId],
      ),
      query<{ body: string | null; from_me: boolean; type: string | null; created_at: Date }>(
        `SELECT body, from_me, type, created_at FROM messages
         WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [chatId],
      ),
    ])
    if (!chat.rows[0]) return reply.callNotFound()
    return reply.view('chat.njk', {
      authed: true,
      chat: chat.rows[0],
      contact: contact.rows[0] ?? null,
      messages: messages.rows.reverse(),
    })
  })

  app.post<{ Params: { chatId: string } }>('/admin/chats/:chatId/pause', async (req, reply) => {
    await setBotPaused(req.params.chatId, true, 'admin')
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
