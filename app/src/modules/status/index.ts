import { config } from '../../config.js'
import { query } from '../../db.js'
import { log } from '../../logger.js'
import { boss, enqueueSend } from '../../queue/index.js'
import { resolveAudience } from './audiences.js'
import { cronForDailyTime, type StatusInput } from './payload.js'

export interface StatusDefinition {
  id: number
  status_type: string
  input: StatusInput & { media_id?: number }
  audience_id: number | null
  schedule_kind: 'once' | 'daily'
  scheduled_at: Date | null
  cron: string | null
  active: boolean
  created_at: Date
}

export interface CreateStatusRequest {
  input: StatusInput & { media_id?: number }
  audienceId: number | null
  schedule:
    | { kind: 'now' }
    | { kind: 'once'; at: Date }
    | { kind: 'daily'; time: string }
}

// The queue payload keeps media as a reference; the worker inlines the file
// (base64) at send time so the DB rows stay small.
async function enqueueStatus(
  input: StatusInput & { media_id?: number },
  audienceId: number | null,
  sendAt?: Date,
): Promise<number> {
  const contacts = await resolveAudience(audienceId)
  return enqueueSend({
    chatId: 'status@broadcast',
    module: 'status',
    kind: 'status',
    payload: { type: 'status', input, contacts },
    sendAt,
  })
}

export async function createStatus(req: CreateStatusRequest): Promise<{ sendId?: number; definitionId?: number }> {
  if (req.schedule.kind === 'now') {
    return { sendId: await enqueueStatus(req.input, req.audienceId) }
  }

  if (req.schedule.kind === 'once') {
    const inserted = await query<{ id: number }>(
      `INSERT INTO status_definitions (status_type, input, audience_id, schedule_kind, scheduled_at)
       VALUES ($1, $2, $3, 'once', $4) RETURNING id`,
      [req.input.type, JSON.stringify(req.input), req.audienceId, req.schedule.at],
    )
    const sendId = await enqueueStatus(req.input, req.audienceId, req.schedule.at)
    return { sendId, definitionId: inserted.rows[0].id }
  }

  const cron = cronForDailyTime(req.schedule.time)
  if (!cron) throw new Error(`invalid daily time: ${req.schedule.time}`)
  const inserted = await query<{ id: number }>(
    `INSERT INTO status_definitions (status_type, input, audience_id, schedule_kind, cron)
     VALUES ($1, $2, $3, 'daily', $4) RETURNING id`,
    [req.input.type, JSON.stringify(req.input), req.audienceId, cron],
  )
  const definitionId = inserted.rows[0].id
  await registerRecurring(definitionId, cron)
  return { definitionId }
}

const recurringQueue = (id: number) => `status-recur-${id}`

async function registerRecurring(definitionId: number, cron: string) {
  const name = recurringQueue(definitionId)
  await boss.createQueue(name, { name })
  await boss.work(name, async () => {
    const res = await query<StatusDefinition>(
      'SELECT * FROM status_definitions WHERE id = $1 AND active = true',
      [definitionId],
    )
    const definition = res.rows[0]
    if (!definition) return
    await enqueueStatus(definition.input, definition.audience_id)
    log.info({ definitionId }, 'recurring status queued')
  })
  await boss.schedule(name, cron, {}, { tz: config.tz })
}

// pg-boss schedules persist, but work subscriptions must be re-registered on boot.
export async function registerRecurringStatuses() {
  const res = await query<StatusDefinition>(
    `SELECT * FROM status_definitions WHERE schedule_kind = 'daily' AND active = true`,
  )
  for (const definition of res.rows) {
    if (definition.cron) await registerRecurring(definition.id, definition.cron)
  }
  if (res.rows.length) log.info({ count: res.rows.length }, 'recurring statuses registered')
}

export async function cancelStatusDefinition(definitionId: number) {
  await query('UPDATE status_definitions SET active = false WHERE id = $1', [definitionId])
  await boss.unschedule(recurringQueue(definitionId)).catch(() => {})
}

export async function listStatusDefinitions(): Promise<StatusDefinition[]> {
  const res = await query<StatusDefinition>(
    `SELECT * FROM status_definitions WHERE active = true ORDER BY created_at DESC LIMIT 50`,
  )
  return res.rows
}

export interface StatusHistoryRow {
  id: number
  status: string
  waha_message_id: string | null
  error: string | null
  payload: { input?: StatusInput }
  created_at: Date
  sent_at: Date | null
}

export async function listStatusHistory(): Promise<StatusHistoryRow[]> {
  const res = await query<StatusHistoryRow>(
    `SELECT id, status, waha_message_id, error, payload, created_at, sent_at
     FROM sends WHERE module = 'status' ORDER BY created_at DESC LIMIT 30`,
  )
  return res.rows
}
