import { config } from '../../config.js'
import { query } from '../../db.js'
import { log } from '../../logger.js'
import { toChatId } from '../../lib/phone.js'
import { enqueueSend } from '../../queue/index.js'

const HANDOFF_CUSTOMER_TEXT =
  'Let me connect you to a member of our team — they will reply here shortly. ' +
  'Nakuunganisha na mmoja wa timu yetu — watakujibu hapa hivi karibuni. 🙏'

export async function setBotPaused(chatId: string, paused: boolean, reason: string | null) {
  await query(
    `UPDATE chats
     SET bot_paused = $2,
         paused_reason = $3,
         handoff_at = CASE WHEN $2 THEN now() ELSE handoff_at END
     WHERE chat_id = $1`,
    [chatId, paused, reason],
  )
}

export async function startHandoff(chatId: string, reason: string) {
  await setBotPaused(chatId, true, reason)
  log.info({ chatId, reason }, 'handoff started, bot paused for chat')

  await enqueueSend({
    chatId,
    module: 'support',
    kind: 'handoff_customer',
    payload: { type: 'text', text: HANDOFF_CUSTOMER_TEXT, typing: true },
  })

  const staffChatId = config.handoffNumber ? toChatId(config.handoffNumber) : null
  if (!staffChatId) return

  const contact = await query<{ name: string | null; phone: string | null }>(
    'SELECT name, phone FROM contacts WHERE chat_id = $1',
    [chatId],
  )
  const recent = await query<{ body: string | null; from_me: boolean }>(
    `SELECT body, from_me FROM messages
     WHERE chat_id = $1 AND body IS NOT NULL AND body != ''
     ORDER BY created_at DESC LIMIT 5`,
    [chatId],
  )
  const who = contact.rows[0]
  const transcript = recent.rows
    .reverse()
    .map((m) => `${m.from_me ? 'Bot' : 'Customer'}: ${m.body}`)
    .join('\n')

  const summary =
    `🙋 Handoff needed (${reason})\n` +
    `Customer: ${who?.name ?? 'unknown'} (+${who?.phone ?? chatId.replace('@c.us', '')})\n\n` +
    `${transcript}\n\n` +
    `Reply to them directly. Send "#bot on" in their chat to resume the bot.`

  await enqueueSend({
    chatId: staffChatId,
    module: 'support',
    kind: 'handoff_notice',
    payload: { type: 'text', text: summary },
  })
}
