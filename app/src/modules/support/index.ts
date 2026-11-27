import { config } from '../../config.js'
import { query } from '../../db.js'
import { log } from '../../logger.js'
import { toChatId } from '../../lib/phone.js'
import { enqueueSend } from '../../queue/index.js'
import { generateAiReply, getProvider } from './ai.js'
import { startHandoff, setBotPaused } from './handoff.js'
import { isWithinBusinessHours } from './hours.js'
import {
  greetingFor,
  isMenuCommand,
  loadMenu,
  matchMenuItem,
  menuMessage,
  parseLanguageChoice,
  type Lang,
} from './menu.js'
import { isAngry, parseStaffCommand, wantsHuman } from './triggers.js'
import { abandonShopSession, handleShopMessage, sendCatalogueTo } from '../shop/chat.js'

export interface InboundDm {
  chatId: string
  body: string
  hasMedia: boolean
  contactName?: string | null
  contactPhone?: string | null
}

// Staff commands typed from the business's own number inside a customer chat.
export async function handleOwnMessage(chatId: string, body: string) {
  const command = parseStaffCommand(body)
  if (!command) return
  await setBotPaused(chatId, command === 'off', command === 'off' ? 'staff' : null)
  log.info({ chatId, command }, 'staff bot command applied')
}

export async function handleInboundDm(msg: InboundDm) {
  if (!config.botEnabled) return

  const chat = await query<{
    bot_paused: boolean
    last_hours_notice_at: Date | null
    language: string | null
  }>('SELECT bot_paused, last_hours_notice_at, language FROM chats WHERE chat_id = $1', [msg.chatId])
  if (chat.rows[0]?.bot_paused) return

  const repliesLastHour = await query<{ count: string }>(
    `SELECT count(*) FROM sends
     WHERE chat_id = $1 AND module = 'support' AND created_at > now() - interval '1 hour'`,
    [msg.chatId],
  )
  if (Number(repliesLastHour.rows[0].count) >= config.maxRepliesPerChatPerHour) {
    log.warn({ chatId: msg.chatId }, 'per-chat reply cap reached, staying silent')
    return
  }

  const menu = await loadMenu()

  // First contact: let the customer pick a language before anything else.
  let lang = (chat.rows[0]?.language as Lang | null) ?? null
  if (!lang) {
    const pick = parseLanguageChoice(msg.body)
    if (!pick) {
      await reply(msg.chatId, menu.language_prompt.trim())
      return
    }
    await query('UPDATE chats SET language = $2 WHERE chat_id = $1', [msg.chatId, pick])
    lang = pick
    await reply(msg.chatId, menuMessage(menu, lang, greetingFor(menu, lang)))
    return
  }

  // "menu" / "back" — abandon any active order and re-show the menu.
  if (isMenuCommand(msg.body)) {
    await abandonShopSession(msg.chatId)
    await reply(msg.chatId, menuMessage(menu, lang))
    return
  }

  // Shop ordering takes priority: an active order flow, or a buy/catalogue
  // intent, is handled here and short-circuits the support bot. Works anytime
  // (no business-hours gate) so customers can order 24/7.
  if (!msg.hasMedia) {
    const handled = await handleShopMessage(
      msg.chatId,
      msg.body,
      msg.contactName ?? null,
      msg.contactPhone ?? null,
    )
    if (handled) return
  }

  // Outside business hours: send the hours message (at most every 6h per chat), then still answer.
  let prefix = ''
  if (!isWithinBusinessHours(config.businessHours, new Date(), config.tz)) {
    const lastNotice = chat.rows[0]?.last_hours_notice_at
    if (!lastNotice || Date.now() - new Date(lastNotice).getTime() > 6 * 3600_000) {
      prefix = `${menu.after_hours.trim()}\n\n`
      await query('UPDATE chats SET last_hours_notice_at = now() WHERE chat_id = $1', [msg.chatId])
    }
  }

  if (msg.hasMedia) {
    await reply(msg.chatId, prefix + menu.media_ack.trim())
    await flagMediaForStaff(msg.chatId)
    return
  }

  if (wantsHuman(msg.body) || isAngry(msg.body)) {
    return startHandoff(msg.chatId, wantsHuman(msg.body) ? 'customer asked for a human' : 'customer sounds upset')
  }

  // A menu item can trigger the live catalogue (e.g. replying "1"), in both
  // menu and AI modes.
  const actionItem = matchMenuItem(menu, msg.body)
  if (actionItem?.action === 'catalogue') {
    return sendCatalogueTo(msg.chatId)
  }

  const provider = getProvider()
  if (!provider) {
    // Menu/keyword mode
    const item = matchMenuItem(menu, msg.body)
    if (item?.handoff) return startHandoff(msg.chatId, 'menu: talk to a person')
    if (item?.reply) return reply(msg.chatId, prefix + item.reply.trim())

    const inboundCount = await query<{ count: string }>(
      'SELECT count(*) FROM messages WHERE chat_id = $1 AND from_me = false',
      [msg.chatId],
    )
    const isFirstContact = Number(inboundCount.rows[0].count) <= 1
    const header = isFirstContact ? greetingFor(menu, lang) : menu.fallback
    return reply(msg.chatId, prefix + menuMessage(menu, lang, header))
  }

  // AI mode
  try {
    const { text, handoff } = await generateAiReply(msg.chatId, provider)
    if (handoff || !text) return startHandoff(msg.chatId, 'AI not confident')
    return reply(msg.chatId, prefix + text)
  } catch (err) {
    log.error({ chatId: msg.chatId, err: (err as Error).message }, 'AI provider failed')
    return startHandoff(msg.chatId, 'AI provider error')
  }
}

function reply(chatId: string, text: string) {
  return enqueueSend({
    chatId,
    module: 'support',
    kind: 'bot_reply',
    payload: { type: 'text', text, typing: true },
  })
}

async function flagMediaForStaff(chatId: string) {
  const staffChatId = config.handoffNumber ? toChatId(config.handoffNumber) : null
  if (!staffChatId) return
  await enqueueSend({
    chatId: staffChatId,
    module: 'support',
    kind: 'media_flag',
    payload: {
      type: 'text',
      text: `📎 Customer +${chatId.replace('@c.us', '')} sent media — please check it in WhatsApp.`,
    },
  })
}
