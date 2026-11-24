import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db.js'
import { parseCsvContacts } from '../modules/notify/csv.js'
import { createNotification, listNotifications, NotifyError } from '../modules/notify/index.js'
import { listTemplates, getTemplate, upsertTemplate, listVariables } from '../modules/notify/templates.js'
import { requireWebAuth } from './auth.js'

const TEMPLATE_NAME = /^[a-z0-9_]+$/

export const adminNotifyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWebAuth)

  // --- templates ---
  app.get('/admin/templates', async (_req, reply) => {
    const templates = await listTemplates()
    return reply.view('templates.njk', {
      authed: true,
      templates: templates.map((t) => ({ ...t, vars: listVariables(t.body) })),
    })
  })

  app.get<{ Params: { name: string } }>('/admin/templates/:name', async (req, reply) => {
    const isNew = req.params.name === 'new'
    const template = isNew ? null : await getTemplate(req.params.name)
    if (!isNew && !template) return reply.callNotFound()
    return reply.view('template_edit.njk', {
      authed: true,
      isNew,
      name: isNew ? '' : req.params.name,
      body: template?.body ?? '',
      error: null,
      saved: false,
    })
  })

  app.post<{ Params: { name: string } }>('/admin/templates/:name', async (req, reply) => {
    const form = z.object({ name: z.string().default(''), body: z.string().min(1) }).parse(req.body ?? {})
    const isNew = req.params.name === 'new'
    const name = isNew ? form.name.trim() : req.params.name
    if (!TEMPLATE_NAME.test(name)) {
      return reply.view('template_edit.njk', {
        authed: true, isNew, name: form.name, body: form.body,
        error: 'Template name must be lowercase letters, numbers, and underscores.', saved: false,
      })
    }
    await upsertTemplate(name, form.body)
    return reply.redirect(`/admin/templates/${encodeURIComponent(name)}`)
  })

  // --- send one ---
  app.get('/admin/notify', async (_req, reply) => {
    const templates = await listTemplates()
    return reply.view('notify_send.njk', {
      authed: true, templates, error: null, result: null, form: {},
    })
  })

  app.post('/admin/notify', async (req, reply) => {
    const templates = await listTemplates()
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
      const result = await createNotification({ phone: form.phone, template: form.template, variables, sendAt })
      return reply.view('notify_send.njk', { authed: true, templates, error: null, result, form })
    } catch (err) {
      const message = err instanceof NotifyError ? err.message : (err as Error).message
      return reply.view('notify_send.njk', { authed: true, templates, error: message, result: null, form })
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
  app.get('/admin/contacts', async (_req, reply) => {
    const contacts = await query(
      `SELECT chat_id, phone, name, opted_in, opt_in_source, created_at
       FROM contacts ORDER BY created_at DESC LIMIT 200`,
    )
    return reply.view('contacts.njk', { authed: true, contacts: contacts.rows, imported: null, invalid: [] })
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
    const contacts = await query(
      `SELECT chat_id, phone, name, opted_in, opt_in_source, created_at
       FROM contacts ORDER BY created_at DESC LIMIT 200`,
    )
    return reply.view('contacts.njk', {
      authed: true, contacts: contacts.rows, imported: valid.length, invalid,
    })
  })
}
