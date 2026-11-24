import { z } from 'zod'
import { query } from '../db.js'
import { log } from '../logger.js'
import { setOptIn, upsertContact } from '../contacts.js'
import { enqueueSend } from '../queue/index.js'
import { handleInboundDm, handleOwnMessage } from '../modules/support/index.js'
import { handleGroupMessage } from '../modules/groups/index.js'
import { chatKeyOf, classifyChat, parseOptKeyword } from './classify.js'
import type { WahaEvent } from './router.js'

// GOWS sends explicit nulls for absent fields — every optional must be nullish.
const MessagePayload = z
  .object({
    id: z.string(),
    from: z.string().nullish(),
    to: z.string().nullish(),
    fromMe: z.boolean().nullish(),
    body: z.string().nullish(),
    hasMedia: z.boolean().nullish(),
    media: z.unknown().optional(),
    timestamp: z.number().nullish(),
    participant: z.string().nullish(), // sender inside a group chat
    mentionedIds: z.array(z.string()).nullish(),
  })
  .passthrough()

function senderNameOf(msg: Record<string, unknown>): string | null {
  if (typeof msg.notifyName === 'string' && msg.notifyName) return msg.notifyName
  const pushName = (msg as any)?._data?.Info?.PushName
  return typeof pushName === 'string' && pushName ? pushName : null
}

// For @lid (privacy) chats the real number is only in the GOWS SenderAlt field.
function senderPhoneOf(msg: Record<string, unknown>, chatId: string): string | null {
  if (chatId.endsWith('@c.us') || chatId.endsWith('@s.whatsapp.net')) {
    return chatId.split('@')[0].split(':')[0]
  }
  const alt = (msg as any)?._data?.Info?.SenderAlt
  if (typeof alt === 'string' && alt.includes('@')) {
    const digits = alt.split('@')[0].split(':')[0]
    if (/^\d{7,15}$/.test(digits)) return digits
  }
  return null
}

const OPTOUT_TEXT =
  'You have been unsubscribed and will not receive messages from us. Reply START to subscribe again.'
const OPTIN_TEXT = 'You are subscribed again. Reply STOP any time to unsubscribe.'

export async function handleMessageAny(evt: WahaEvent) {
  const parsed = MessagePayload.safeParse(evt.payload)
  if (!parsed.success) {
    log.warn({ event: evt.event, issues: parsed.error.issues }, 'unparseable message payload')
    return
  }
  const msg = parsed.data
  const chatId = chatKeyOf(msg)
  if (!chatId) return

  const kind = classifyChat(chatId)
  if (kind === 'group') {
    if (!msg.fromMe) {
      await handleGroupMessage({
        groupId: chatId,
        senderId: msg.participant ?? null,
        body: msg.body ?? '',
        mentionedIds: msg.mentionedIds ?? undefined,
      })
    }
    return
  }
  if (kind !== 'dm') return

  await query(
    `INSERT INTO chats (chat_id, kind, last_inbound_at)
     VALUES ($1, 'dm', CASE WHEN $2 THEN NULL ELSE now() END)
     ON CONFLICT (chat_id)
     DO UPDATE SET last_inbound_at = CASE WHEN $2 THEN chats.last_inbound_at ELSE now() END`,
    [chatId, msg.fromMe ?? false],
  )

  const type = msg.hasMedia ? 'media' : 'text'
  await query(
    `INSERT INTO messages (waha_message_id, chat_id, from_me, type, body, media)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (waha_message_id) DO NOTHING`,
    [msg.id, chatId, msg.fromMe ?? false, type, msg.body ?? null, msg.media ? JSON.stringify(msg.media) : null],
  )

  if (msg.fromMe) {
    await handleOwnMessage(chatId, msg.body ?? '')
    return
  }

  const contact = await upsertContact(chatId, senderNameOf(msg), senderPhoneOf(msg, chatId))

  const keyword = parseOptKeyword(msg.body)
  if (keyword === 'stop' && contact.opted_in) {
    await setOptIn(chatId, false)
    await enqueueSend({
      chatId,
      module: 'system',
      kind: 'optout_confirm',
      payload: { type: 'text', text: OPTOUT_TEXT },
    })
    log.info({ chatId }, 'contact opted out')
    return
  }
  if (keyword === 'start' && !contact.opted_in) {
    await setOptIn(chatId, true)
    await enqueueSend({
      chatId,
      module: 'system',
      kind: 'optin_confirm',
      payload: { type: 'text', text: OPTIN_TEXT },
    })
    log.info({ chatId }, 'contact opted in')
    return
  }

  await handleInboundDm({ chatId, body: msg.body ?? '', hasMedia: msg.hasMedia ?? false })
}

const AckPayload = z
  .object({
    id: z.union([
      z.string(),
      z.object({ id: z.string().optional(), _serialized: z.string().optional() }).passthrough(),
    ]),
    ack: z.number().optional(),
    ackName: z.string().optional(),
  })
  .passthrough()

const ACK_STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 }
const ACK_BY_NAME: Record<string, string> = {
  SERVER: 'sent',
  DEVICE: 'delivered',
  READ: 'read',
  PLAYED: 'read',
}

export async function handleAck(evt: WahaEvent) {
  const parsed = AckPayload.safeParse(evt.payload)
  if (!parsed.success) return
  const p = parsed.data
  const messageId =
    typeof p.id === 'string' ? p.id : p.id._serialized ?? p.id.id ?? null
  if (!messageId) return

  const ackNum = p.ack ?? 0
  const status =
    (p.ackName && ACK_BY_NAME[p.ackName]) ??
    (ackNum >= 3 ? 'read' : ackNum === 2 ? 'delivered' : ackNum === 1 ? 'sent' : null)
  if (!status) return

  await query('UPDATE messages SET ack = $2 WHERE waha_message_id = $1 AND ack < $2', [
    messageId,
    ackNum,
  ])
  // Only move status forward (sent → delivered → read), never backwards.
  await query(
    `UPDATE sends SET status = $2
     WHERE waha_message_id = $1
       AND (CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 9 END) < $3`,
    [messageId, status, ACK_STATUS_RANK[status]],
  )
}
