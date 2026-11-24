import { createHash } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { config } from '../config.js'
import { query } from '../db.js'
import { verifyWebhookHmac } from '../lib/crypto.js'
import { routeEvent, WahaEventSchema, type WahaEvent } from './router.js'

// Spec: dedupe message events by message id; other events by event id.
function dedupeKey(evt: WahaEvent, raw: Buffer): string {
  const payloadId = (evt.payload as { id?: unknown } | undefined)?.id
  if (evt.event === 'message.any' && typeof payloadId === 'string') return `msg:${payloadId}`
  if (evt.id) return `evt:${evt.id}`
  return `raw:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // Keep the raw body in this scope so the HMAC covers exactly what WAHA signed.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  )

  app.post('/webhooks/waha', async (req, reply) => {
    const raw = req.body as Buffer
    if (!verifyWebhookHmac(raw, req.headers['x-webhook-hmac'], config.webhookSecret)) {
      return reply.code(401).send({ error: 'invalid signature' })
    }

    let json: unknown
    try {
      json = JSON.parse(raw.toString('utf8'))
    } catch {
      return reply.code(400).send({ error: 'invalid json' })
    }
    const parsed = WahaEventSchema.safeParse(json)
    if (!parsed.success) {
      req.log.warn({ issues: parsed.error.issues }, 'unexpected webhook shape')
      return { ok: true }
    }
    const evt = parsed.data

    const inserted = await query<{ id: number }>(
      `INSERT INTO webhook_events (event_key, event_type, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [dedupeKey(evt, raw), evt.event, raw.toString('utf8')],
    )
    if (inserted.rowCount === 0) {
      return { ok: true, duplicate: true }
    }
    const eventRowId = inserted.rows[0].id

    try {
      await routeEvent(evt)
      await query('UPDATE webhook_events SET processed_at = now() WHERE id = $1', [eventRowId])
    } catch (err) {
      // Record and ack: the raw event is stored, retrying from WAHA would re-fail identically.
      const message = (err as Error).message
      await query('UPDATE webhook_events SET error = $2 WHERE id = $1', [eventRowId, message])
      req.log.error({ err: message, event: evt.event }, 'webhook processing failed')
    }
    return { ok: true }
  })
}
