import { config } from '../../config.js'
import { query } from '../../db.js'
import { log } from '../../logger.js'
import { toChatId } from '../../lib/phone.js'
import { enqueueSend } from '../../queue/index.js'
import { waha } from '../../waha/client.js'
import { buildSystemPrompt, getProvider } from '../support/ai.js'
import { loadKnowledgeBase } from '../support/knowledge.js'
import { parseAiReply } from '../support/providers.js'
import {
  containsLink,
  extractAdminIds,
  isMentioned,
  matchKeywordReply,
  normalizeGroupEvent,
  phoneFromId,
  renderWelcome,
  stripMention,
} from './logic.js'
import { getGroupSettings } from './settings.js'

const CACHE_MS = 10 * 60_000

let ourIdCache: { id: string; at: number } | null = null

async function getOurId(): Promise<string | null> {
  if (ourIdCache && Date.now() - ourIdCache.at < CACHE_MS) return ourIdCache.id
  try {
    const me = await waha.getMe()
    const id = typeof me?.id === 'string' ? me.id : null
    if (id) ourIdCache = { id, at: Date.now() }
    return id
  } catch {
    return null
  }
}

const adminCache = new Map<string, { ids: string[]; at: number }>()
const ADMIN_CACHE_MS = 60_000

async function getGroupAdmins(groupId: string): Promise<string[]> {
  const cached = adminCache.get(groupId)
  if (cached && Date.now() - cached.at < ADMIN_CACHE_MS) return cached.ids
  const participants = await waha.getParticipants(groupId)
  const ids = extractAdminIds(participants as Array<Record<string, unknown>>)
  adminCache.set(groupId, { ids, at: Date.now() })
  return ids
}

export interface GroupMessage {
  groupId: string
  senderId: string | null
  body: string
  mentionedIds?: string[]
}

export async function handleGroupMessage(msg: GroupMessage) {
  if (!config.botEnabled) return
  const settings = await getGroupSettings(msg.groupId)

  if (settings.moderation_enabled) {
    const rule = matchKeywordReply(settings.keyword_replies, msg.body)
    if (rule) {
      await replyInGroup(msg.groupId, 'moderation_reply', rule.reply)
      return
    }
    if (settings.flag_links && msg.senderId && containsLink(msg.body)) {
      try {
        const admins = await getGroupAdmins(msg.groupId)
        const senderPhone = phoneFromId(msg.senderId)
        if (!admins.some((id) => phoneFromId(id) === senderPhone)) {
          await notifyStaff(
            `🔗 Link posted in group ${msg.groupId} by non-admin +${senderPhone}:\n${msg.body.slice(0, 300)}`,
          )
        }
      } catch (err) {
        log.warn({ groupId: msg.groupId, err: (err as Error).message }, 'link flag check failed')
      }
    }
  }

  // AI only when explicitly @mentioned and a provider is configured. Never
  // reply to normal group chatter.
  const provider = getProvider()
  if (!provider || !msg.body) return
  const ourId = await getOurId()
  if (!ourId || !isMentioned(msg.body, msg.mentionedIds, ourId)) return

  const question = stripMention(msg.body, ourId)
  if (!question) return

  try {
    const knowledgeBase = await loadKnowledgeBase()
    const system =
      buildSystemPrompt(knowledgeBase) +
      '\n\nYou are replying inside a WhatsApp group where you were @mentioned. Be extra brief.'
    const raw = await provider.chat(system, [{ role: 'user', content: question }])
    const { text, handoff } = parseAiReply(raw)
    if (handoff || !text) {
      await replyInGroup(msg.groupId, 'ai_reply', 'Let me get a team member to answer that. 🙏')
      await notifyStaff(`🙋 Group question needs a human in ${msg.groupId}:\n"${question.slice(0, 300)}"`)
      return
    }
    await replyInGroup(msg.groupId, 'ai_reply', text)
  } catch (err) {
    log.error({ groupId: msg.groupId, err: (err as Error).message }, 'group AI reply failed')
  }
}

export async function handleGroupJoin(payload: unknown) {
  if (!config.botEnabled) return
  const { groupId, participants } = normalizeGroupEvent(payload)
  if (!groupId || participants.length === 0) return

  const settings = await getGroupSettings(groupId)
  if (!settings.welcome_enabled || !settings.welcome_text) return

  const ourId = await getOurId()
  const ourPhone = ourId ? phoneFromId(ourId) : ''

  for (const participant of participants) {
    const phone = phoneFromId(participant)
    if (phone === ourPhone) continue // our own join event
    await replyInGroup(groupId, 'welcome', renderWelcome(settings.welcome_text, `+${phone}`))
  }
}

async function replyInGroup(groupId: string, kind: string, text: string) {
  const sent = await query<{ count: string }>(
    `SELECT count(*) FROM sends
     WHERE chat_id = $1 AND module = 'groups' AND kind IN ('moderation_reply', 'ai_reply', 'welcome')
       AND created_at > now() - interval '1 hour'`,
    [groupId],
  )
  if (Number(sent.rows[0].count) >= config.maxRepliesPerChatPerHour) {
    log.warn({ groupId }, 'group reply cap reached, staying silent')
    return
  }
  await enqueueSend({ chatId: groupId, module: 'groups', kind, payload: { type: 'text', text } })
}

async function notifyStaff(text: string) {
  const staffChatId = config.handoffNumber ? toChatId(config.handoffNumber) : null
  if (!staffChatId) return
  await enqueueSend({
    chatId: staffChatId,
    module: 'groups',
    kind: 'group_flag',
    payload: { type: 'text', text },
  })
}
