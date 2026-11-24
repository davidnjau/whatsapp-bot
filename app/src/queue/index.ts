import PgBoss from 'pg-boss'
import { config } from '../config.js'
import { query } from '../db.js'
import { log } from '../logger.js'
import { processSendJobs } from './worker.js'

export const OUTBOUND_QUEUE = 'outbound'

export interface SendJobData {
  sendId: number
}

export const boss = new PgBoss({ connectionString: config.databaseUrl, schema: 'pgboss' })

export async function startQueue() {
  boss.on('error', (err) => log.error({ err }, 'pg-boss error'))
  await boss.start()
  await boss.createQueue(OUTBOUND_QUEUE, {
    name: OUTBOUND_QUEUE,
    retryLimit: 5,
    retryDelay: 15,
    retryBackoff: true,
  })
  await boss.work<SendJobData>(OUTBOUND_QUEUE, { batchSize: 1 }, processSendJobs)
  log.info('send queue started')
}

export interface EnqueueSendOptions {
  chatId: string
  module: string
  kind: string
  payload: Record<string, unknown>
  sendAt?: Date
}

// The ONLY way any module sends a WhatsApp message.
export async function enqueueSend(opts: EnqueueSendOptions): Promise<number> {
  const res = await query<{ id: number }>(
    `INSERT INTO sends (chat_id, module, kind, payload, scheduled_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [opts.chatId, opts.module, opts.kind, JSON.stringify(opts.payload), opts.sendAt ?? null],
  )
  const sendId = res.rows[0].id
  await boss.send(OUTBOUND_QUEUE, { sendId }, opts.sendAt ? { startAfter: opts.sendAt } : {})
  return sendId
}

export async function queueStats() {
  const res = await query<{ queued: string; sent_24h: string; failed_24h: string; in_24h: string }>(
    `SELECT
       (SELECT count(*) FROM sends WHERE status = 'queued') AS queued,
       (SELECT count(*) FROM sends WHERE sent_at > now() - interval '24 hours') AS sent_24h,
       (SELECT count(*) FROM sends WHERE status = 'failed' AND created_at > now() - interval '24 hours') AS failed_24h,
       (SELECT count(*) FROM messages WHERE from_me = false AND created_at > now() - interval '24 hours') AS in_24h`,
  )
  const row = res.rows[0]
  return {
    queued: Number(row.queued),
    sent24h: Number(row.sent_24h),
    failed24h: Number(row.failed_24h),
    in24h: Number(row.in_24h),
  }
}
