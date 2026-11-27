import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db.js'
import { parseCsvContacts } from '../modules/notify/csv.js'
import { createNotification, listNotifications, NotifyError } from '../modules/notify/index.js'
import { listTemplates, getTemplate, upsertTemplate } from '../modules/notify/templates.js'
import { requireWebAuth } from './auth.js'

const TEMPLATE_NAME = /^[a-z0-9_]+$/

export const adminNotifyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWebAuth)

  // --- templates ---
  app.get('/admin/templates', async (_req, reply) => {
    // The friendly editor loads the templates as window.TEMPLATES.
    const templates = await listTemplates()
    const seed = templates.map((t) => ({ id: t.name, body: t.body }))
    const templatesJson = JSON.stringify(seed).replace(/</g, '\\u003c')
    return reply.view('templates.njk', { authed: true, templatesJson })
  })

  // Old edit URLs now live inside the SPA — bounce them to the hash view.
  app.get<{ Params: { name: string } }>('/admin/templates/:name', async (req, reply) => {
    const name = req.params.name
    if (name === 'new') return reply.redirect('/admin/templates#new')
    const template = await getTemplate(name)
    if (!template) return reply.callNotFound()
    return reply.redirect(`/admin/templates#edit-${name.replace(/_/g, '-')}`)
  })

  app.post<{ Params: { name: string } }>('/admin/templates/:name', async (req, reply) => {
    const form = z.object({ name: z.string().default(''), body: z.string().min(1) }).parse(req.body ?? {})
    const isNew = req.params.name === 'new'
    const name = isNew ? form.name.trim() : req.params.name
    const wantsJson = (req.headers.accept ?? '').includes('application/json')
    const fail = (msg: string) =>
      wantsJson
        ? reply.code(400).send({ ok: false, error: msg })
        : reply.view('template_edit.njk', { authed: true, isNew, name: form.name, body: form.body, error: msg, saved: false })
    if (!TEMPLATE_NAME.test(name)) {
      return fail('Template name must be lowercase letters, numbers, and underscores.')
    }
    if (isNew && (await getTemplate(name))) {
      return fail(`A template called "${name}" already exists.`)
    }
    await upsertTemplate(name, form.body)
    return wantsJson ? reply.send({ ok: true, name }) : reply.redirect(`/admin/templates/${encodeURIComponent(name)}`)
  })

  // --- send one ---
  const esc = (s: string) => s.replace(/</g, '\\u003c')
  // Data the friendly Notify SPA needs: templates, the recent log, and a flash.
  async function notifyData(flash: { type: 'ok' | 'err'; text: string } | null) {
    const [templates, log] = await Promise.all([listTemplates(), listNotifications({})])
    const templatesJson = esc(JSON.stringify(templates.map((t) => ({ id: t.name, body: t.body }))))
    const logJson = esc(
      JSON.stringify(
        log.slice(0, 5).map((n) => ({
          phone: (n.chat_id ?? '').replace(/@.*$/, ''),
          template: n.template_name ?? '',
          status: n.status ?? 'queued',
          scheduled: n.scheduled_at ? new Date(n.scheduled_at).getTime() : null,
          at: new Date(n.created_at).getTime(),
        })),
      ),
    )
    return { templatesJson, logJson, flashJson: esc(JSON.stringify(flash)) }
  }

  app.get('/admin/notify', async (_req, reply) => {
    return reply.view('notify_send.njk', { authed: true, ...(await notifyData(null)) })
  })

  app.post('/admin/notify', async (req, reply) => {
    const form = z
      .object({
        phone: z.string(),
        template: z.string(),
        variables: z.string().default('{}'),
        sendAt: z.string().default(''),
      })
      .parse(req.body ?? {})
    try {
      let variables: Record<string, string | number>
      try {
        variables = z.record(z.union([z.string(), z.number()])).parse(JSON.parse(form.variables || '{}'))
      } catch {
        throw new NotifyError(400, 'Variables must be a JSON object, e.g. {"name": "Alice"}')
      }
      const sendAt = form.sendAt ? new Date(form.sendAt) : undefined
      if (sendAt && Number.isNaN(sendAt.getTime())) throw new NotifyError(400, 'Invalid send time')
      await createNotification({ phone: form.phone, template: form.template, variables, sendAt })
      const name = typeof variables.name === 'string' ? variables.name : ''
      const text = sendAt ? 'Message scheduled' : `Message queued${name ? ` for ${name}` : ''}`
      return reply.view('notify_send.njk', { authed: true, ...(await notifyData({ type: 'ok', text })) })
    } catch (err) {
      const message = err instanceof NotifyError ? err.message : (err as Error).message
      return reply.view('notify_send.njk', { authed: true, ...(await notifyData({ type: 'err', text: message })) })
    }
  })

  // --- notification log ---
  app.get<{ Querystring: { status?: string; template?: string } }>(
    '/admin/notifications',
    async (req, reply) => {
      const rows = await listNotifications({
        status: req.query.status || undefined,
        template: req.query.template || undefined,
      })
      const templates = await listTemplates()
      return reply.view('notifications.njk', {
        authed: true, rows, templates,
        filter: { status: req.query.status ?? '', template: req.query.template ?? '' },
      })
    },
  )

  // --- contacts + CSV import ---
  async function contactsData(flash: { type: 'ok' | 'err'; text: string } | null) {
    const res = await query<{
      phone: string
      name: string | null
      opted_in: boolean
      opt_in_source: string | null
      created_at: Date
    }>(
      `SELECT phone, name, opted_in, opt_in_source, created_at
       FROM contacts ORDER BY created_at DESC LIMIT 2000`,
    )
    const contactsJson = esc(
      JSON.stringify(
        res.rows.map((c) => ({
          phone: `+${c.phone}`,
          name: c.name ?? '',
          optIn: c.opted_in,
          source: c.opt_in_source ?? '',
          added: new Date(c.created_at).getTime(),
        })),
      ),
    )
    return { contactsJson, flashJson: esc(JSON.stringify(flash)) }
  }

  app.get('/admin/contacts', async (_req, reply) => {
    return reply.view('contacts.njk', { authed: true, ...(await contactsData(null)) })
  })

  app.post('/admin/contacts/import', async (req, reply) => {
    const form = z.object({ csv: z.string() }).parse(req.body ?? {})
    const { valid, invalid } = parseCsvContacts(form.csv)
    for (const c of valid) {
      await query(
        `INSERT INTO contacts (chat_id, phone, name, opted_in, opt_in_source)
         VALUES ($1, $2, $3, true, 'csv')
         ON CONFLICT (chat_id) DO UPDATE
           SET name = COALESCE(EXCLUDED.name, contacts.name),
               opted_in = CASE WHEN contacts.opted_out_at IS NULL THEN true ELSE contacts.opted_in END`,
        [c.chatId, c.phone, c.name],
      )
    }
    const text =
      `Added ${valid.length} contact${valid.length === 1 ? '' : 's'}` +
      (invalid.length ? ` · skipped ${invalid.length} invalid line(s)` : '')
    return reply.view('contacts.njk', { authed: true, ...(await contactsData({ type: 'ok', text })) })
  })
}
