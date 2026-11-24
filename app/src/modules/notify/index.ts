import { query } from '../../db.js'
import { toChatId } from '../../lib/phone.js'
import { enqueueSend } from '../../queue/index.js'
import { getTemplate, renderTemplate } from './templates.js'

export class NotifyError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'NotifyError'
  }
}

export interface Attachment {
  url: string
  mimetype?: string
  filename?: string
  type?: 'image' | 'file'
}

export interface NotifyRequest {
  phone: string
  template: string
  variables?: Record<string, string | number>
  sendAt?: Date
  attachment?: Attachment
}

export interface NotifyResult {
  notificationId: number
  sendId: number
  chatId: string
  rendered: string
}

export async function createNotification(req: NotifyRequest): Promise<NotifyResult> {
  const chatId = toChatId(req.phone)
  if (!chatId) throw new NotifyError(400, `invalid phone number: ${req.phone}`)

  const template = await getTemplate(req.template)
  if (!template) throw new NotifyError(400, `unknown template: ${req.template}`)

  const { text, missing } = renderTemplate(template.body, req.variables ?? {})
  if (missing.length) {
    throw new NotifyError(400, `missing template variables: ${missing.join(', ')}`)
  }

  // Record the contact without touching an existing opt-in/opt-out choice.
  // The send worker skips (and logs) opted-out contacts at send time.
  await query(
    `INSERT INTO contacts (chat_id, phone, opt_in_source)
     VALUES ($1, $2, 'api') ON CONFLICT (chat_id) DO NOTHING`,
    [chatId, chatId.replace('@c.us', '')],
  )

  const payload = req.attachment
    ? {
        type: req.attachment.type ?? (req.attachment.mimetype?.startsWith('image/') ? 'image' : 'file'),
        file: {
          url: req.attachment.url,
          mimetype: req.attachment.mimetype,
          filename: req.attachment.filename,
        },
        caption: text,
      }
    : { type: 'text', text }

  const sendId = await enqueueSend({
    chatId,
    module: 'notify',
    kind: 'notification',
    payload,
    sendAt: req.sendAt,
  })

  const inserted = await query<{ id: number }>(
    `INSERT INTO notifications (chat_id, template_name, variables, rendered, attachment, send_id, scheduled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      chatId,
      req.template,
      JSON.stringify(req.variables ?? {}),
      text,
      req.attachment ? JSON.stringify(req.attachment) : null,
      sendId,
      req.sendAt ?? null,
    ],
  )

  return { notificationId: inserted.rows[0].id, sendId, chatId, rendered: text }
}

export interface NotificationLogRow {
  id: number
  chat_id: string
  template_name: string | null
  rendered: string
  scheduled_at: Date | null
  created_at: Date
  status: string | null
  error: string | null
  sent_at: Date | null
}

export async function listNotifications(filter: {
  status?: string
  template?: string
}): Promise<NotificationLogRow[]> {
  const where: string[] = []
  const params: unknown[] = []
  if (filter.status) {
    params.push(filter.status)
    where.push(`s.status = $${params.length}`)
  }
  if (filter.template) {
    params.push(filter.template)
    where.push(`n.template_name = $${params.length}`)
  }
  const res = await query<NotificationLogRow>(
    `SELECT n.id, n.chat_id, n.template_name, n.rendered, n.scheduled_at, n.created_at,
            s.status, s.error, s.sent_at
     FROM notifications n
     LEFT JOIN sends s ON s.id = n.send_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY n.created_at DESC LIMIT 200`,
    params,
  )
  return res.rows
}
