import type PgBoss from 'pg-boss'
import { config } from '../config.js'
import { query } from '../db.js'
import { log } from '../logger.js'
import { extractMessageId, waha, type WahaFile } from '../waha/client.js'
import { pickDelayMs } from './throttle.js'
import { OPTOUT_EXEMPT_KINDS } from './policy.js'
import { buildStatusBody, type StatusInput } from '../modules/status/payload.js'
import { mediaAsWahaFile } from '../modules/status/media.js'
import type { SendJobData } from './index.js'

interface SendRow {
  id: number
  chat_id: string
  module: string
  kind: string
  payload: {
    type: string
    text?: string
    file?: WahaFile
    caption?: string
    convert?: boolean
    typing?: boolean
    input?: StatusInput & { media_id?: number }
    contacts?: string[] | null
  }
  status: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function processSendJobs(jobs: PgBoss.Job<SendJobData>[]) {
  for (const job of jobs) {
    await processSend(job.data.sendId)
  }
}

async function processSend(sendId: number) {
  const res = await query<SendRow>('SELECT * FROM sends WHERE id = $1', [sendId])
  const send = res.rows[0]
  if (!send || send.status === 'sent' || send.status === 'delivered' || send.status === 'read') {
    return
  }

  if (!OPTOUT_EXEMPT_KINDS.has(send.kind)) {
    const contact = await query<{ opted_in: boolean }>(
      'SELECT opted_in FROM contacts WHERE chat_id = $1',
      [send.chat_id],
    )
    if (contact.rows[0] && contact.rows[0].opted_in === false) {
      await query(`UPDATE sends SET status = 'skipped_optout' WHERE id = $1`, [sendId])
      log.info({ sendId, chatId: send.chat_id }, 'send skipped: contact opted out')
      return
    }
  }

  const hourly = await query<{ count: string }>(
    `SELECT count(*) FROM sends WHERE sent_at > now() - interval '1 hour'`,
  )
  if (Number(hourly.rows[0].count) >= config.sendMaxPerHour) {
    const { boss, OUTBOUND_QUEUE } = await import('./index.js')
    await boss.send(OUTBOUND_QUEUE, { sendId }, { startAfter: 600 })
    log.warn({ sendId }, 'hourly send cap reached, rescheduled in 10 min')
    return
  }

  // "typing…" indicator during the pacing delay makes bot replies feel natural.
  const typing = send.payload.typing === true
  if (typing) await waha.startTyping(send.chat_id).catch(() => {})

  await sleep(pickDelayMs(config.sendMinDelaySeconds, config.sendMaxDelaySeconds))

  try {
    const result = await dispatch(send)
    if (typing) await waha.stopTyping(send.chat_id).catch(() => {})
    const messageId = extractMessageId(result)
    await query(
      `UPDATE sends
       SET status = 'sent', sent_at = now(), waha_message_id = $2, attempts = attempts + 1, error = NULL
       WHERE id = $1`,
      [sendId, messageId],
    )
    log.info({ sendId, chatId: send.chat_id, messageId, kind: send.kind }, 'message sent')
  } catch (err) {
    if (typing) await waha.stopTyping(send.chat_id).catch(() => {})
    const message = (err as Error).message
    await query(
      `UPDATE sends SET status = 'failed', error = $2, attempts = attempts + 1 WHERE id = $1`,
      [sendId, message],
    )
    log.error({ sendId, chatId: send.chat_id, err: message }, 'send failed')
    throw err
  }
}

async function dispatch(send: SendRow) {
  const p = send.payload
  switch (p.type) {
    case 'status': {
      const input = { ...(p.input as StatusInput & { media_id?: number }) }
      if (input.media_id) input.file = await mediaAsWahaFile(input.media_id)
      const body = buildStatusBody(input, p.contacts ?? null)
      switch (input.type) {
        case 'text':
          return waha.sendTextStatus(body)
        case 'image':
          return waha.sendImageStatus(body)
        case 'video':
          return waha.sendVideoStatus(body)
        case 'voice':
          return waha.sendVoiceStatus(body)
        default:
          throw new Error(`unknown status type: ${input.type}`)
      }
    }
    case 'text':
      return waha.sendText(send.chat_id, p.text ?? '')
    case 'image':
      return waha.sendImage(send.chat_id, p.file!, p.caption)
    case 'file':
      return waha.sendFile(send.chat_id, p.file!, p.caption)
    case 'voice':
      return waha.sendVoice(send.chat_id, p.file!, p.convert ?? true)
    case 'video':
      return waha.sendVideo(send.chat_id, p.file!, p.caption, p.convert ?? true)
    default:
      throw new Error(`unknown send payload type: ${p.type}`)
  }
}
