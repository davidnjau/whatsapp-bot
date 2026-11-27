import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db.js'
import { waha } from '../waha/client.js'
import { parseCsvContacts } from '../modules/notify/csv.js'
import {
  addAudienceMembers,
  createAudience,
  deleteAudience,
  listAudiences,
} from '../modules/status/audiences.js'
import {
  cancelStatusDefinition,
  createStatus,
  listStatusDefinitions,
  listStatusHistory,
} from '../modules/status/index.js'
import { deleteMedia, listMedia, readMediaContent, saveMedia } from '../modules/status/media.js'
import type { StatusInput } from '../modules/status/payload.js'
import { requireWebAuth } from './auth.js'

// WhatsApp statuses disappear 24h after posting.
const STATUS_TTL_MS = 24 * 3600 * 1000

async function statusPageData(page = 1) {
  const [audiences, media, definitions, hist] = await Promise.all([
    listAudiences(),
    listMedia(),
    listStatusDefinitions(),
    listStatusHistory(page),
  ])
  const now = Date.now()
  const history = hist.rows.map((h) => {
    const input = h.payload?.input
    const thumb = input?.media_id
      ? `/shop/media/${input.media_id}`
      : input?.file?.url ?? null
    return {
      ...h,
      _thumb: thumb,
      _expired: now - new Date(h.created_at).getTime() > STATUS_TTL_MS,
    }
  })
  return { audiences, media, definitions, history, histPage: hist.page, histTotalPages: hist.totalPages, histTotal: hist.total }
}

export const adminStatusRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWebAuth)

  app.get<{ Querystring: { page?: string } }>('/admin/status', async (req, reply) => {
    const page = Number(req.query.page) || 1
    return reply.view('status.njk', { authed: true, ...(await statusPageData(page)), error: null, queued: null })
  })

  app.post('/admin/status', async (req, reply) => {
    const form = z
      .object({
        statusType: z.enum(['text', 'image', 'video', 'voice']),
        text: z.string().default(''),
        backgroundColor: z.string().default(''),
        font: z.string().default(''),
        caption: z.string().default(''),
        mediaId: z.string().default(''),
        fileUrl: z.string().default(''),
        audienceId: z.string().default(''),
        scheduleKind: z.enum(['now', 'once', 'daily']).default('now'),
        onceAt: z.string().default(''),
        dailyTime: z.string().default(''),
      })
      .parse(req.body ?? {})

    const render = async (error: string | null, queued: string | null) =>
      reply.view('status.njk', { authed: true, ...(await statusPageData()), error, queued })

    const input: StatusInput & { media_id?: number } = { type: form.statusType }
    if (form.statusType === 'text') {
      if (!form.text.trim()) return render('Text statuses need text.', null)
      input.text = form.text
      if (form.backgroundColor) input.backgroundColor = form.backgroundColor
      if (form.font) input.font = Number(form.font)
    } else {
      if (form.mediaId) input.media_id = Number(form.mediaId)
      else if (form.fileUrl.trim()) input.file = { url: form.fileUrl.trim() }
      else return render('Pick a media library item or provide a file URL.', null)
      if (form.caption) input.caption = form.caption
      if (form.backgroundColor && form.statusType !== 'image') input.backgroundColor = form.backgroundColor
    }

    let schedule: Parameters<typeof createStatus>[0]['schedule']
    if (form.scheduleKind === 'once') {
      const at = new Date(form.onceAt)
      if (!form.onceAt || Number.isNaN(at.getTime())) return render('Invalid schedule time.', null)
      schedule = { kind: 'once', at }
    } else if (form.scheduleKind === 'daily') {
      if (!/^\d{1,2}:\d{2}$/.test(form.dailyTime)) return render('Daily time must be HH:MM.', null)
      schedule = { kind: 'daily', time: form.dailyTime }
    } else {
      schedule = { kind: 'now' }
    }

    try {
      const result = await createStatus({
        input,
        audienceId: form.audienceId ? Number(form.audienceId) : null,
        schedule,
      })
      const what =
        form.scheduleKind === 'now'
          ? `Status queued (send #${result.sendId})`
          : form.scheduleKind === 'once'
            ? 'Status scheduled'
            : `Daily status active (definition #${result.definitionId})`
      return render(null, what)
    } catch (err) {
      return render((err as Error).message, null)
    }
  })

  app.post<{ Params: { id: string } }>('/admin/status/definitions/:id/cancel', async (req, reply) => {
    await cancelStatusDefinition(Number(req.params.id))
    return reply.redirect('/admin/status')
  })

  app.post('/admin/status/delete', async (req, reply) => {
    const form = z.object({ sendId: z.string() }).parse(req.body ?? {})
    const send = await query<{ waha_message_id: string | null }>(
      'SELECT waha_message_id FROM sends WHERE id = $1',
      [Number(form.sendId)],
    )
    const messageId = send.rows[0]?.waha_message_id
    const render = async (error: string | null, queued: string | null) =>
      reply.view('status.njk', { authed: true, ...(await statusPageData()), error, queued })
    if (!messageId) return render('No WAHA message id recorded for that status.', null)
    try {
      await waha.deleteStatus({ id: messageId })
      return render(null, 'Status deleted.')
    } catch (err) {
      // GOWS may not support /status/delete — surface WAHA's answer honestly.
      return render(`Delete failed (engine may not support it): ${(err as Error).message.slice(0, 200)}`, null)
    }
  })

  // --- audiences ---
  app.get('/admin/audiences', async (_req, reply) => {
    return reply.view('audiences.njk', {
      authed: true, audiences: await listAudiences(), message: null, invalid: [],
    })
  })

  app.post('/admin/audiences', async (req, reply) => {
    const form = z.object({ name: z.string().min(1), members: z.string().default('') }).parse(req.body ?? {})
    const id = await createAudience(form.name.trim())
    const { valid, invalid } = parseCsvContacts(form.members)
    await addAudienceMembers(id, valid.map((c) => c.chatId))
    return reply.view('audiences.njk', {
      authed: true,
      audiences: await listAudiences(),
      message: `Saved "${form.name}" (+${valid.length} member(s))`,
      invalid,
    })
  })

  app.post<{ Params: { id: string } }>('/admin/audiences/:id/delete', async (req, reply) => {
    await deleteAudience(Number(req.params.id))
    return reply.redirect('/admin/audiences')
  })

  // --- media library ---
  app.get('/admin/media', async (_req, reply) => {
    return reply.view('media.njk', { authed: true, media: await listMedia(), message: null })
  })

  app.post('/admin/media', async (req, reply) => {
    const file = await req.file()
    if (!file) {
      return reply.view('media.njk', { authed: true, media: await listMedia(), message: 'No file received.' })
    }
    const content = await file.toBuffer()
    const item = await saveMedia(file.filename, file.mimetype, content)
    return reply.view('media.njk', {
      authed: true, media: await listMedia(), message: `Uploaded ${item.name} (#${item.id})`,
    })
  })

  app.post<{ Params: { id: string } }>('/admin/media/:id/delete', async (req, reply) => {
    await deleteMedia(Number(req.params.id))
    return reply.redirect('/admin/media')
  })

  app.get<{ Params: { id: string } }>('/admin/media/:id/file', async (req, reply) => {
    const loaded = await readMediaContent(Number(req.params.id))
    if (!loaded) return reply.callNotFound()
    return reply.type(loaded.item.mimetype ?? 'application/octet-stream').send(loaded.content)
  })
}
