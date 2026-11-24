import { config } from '../../config.js'
import { query } from '../../db.js'
import { loadKnowledgeBase } from './knowledge.js'
import {
  createProvider,
  parseAiReply,
  HANDOFF_TOKEN,
  type AiProvider,
  type ChatMessage,
} from './providers.js'

let cached: AiProvider | null | undefined

export function getProvider(): AiProvider | null {
  if (cached === undefined) {
    cached = createProvider(config.aiProvider, {
      model: config.aiModel,
      anthropicApiKey: config.anthropicApiKey,
      openaiApiKey: config.openaiApiKey,
      geminiApiKey: config.geminiApiKey,
      ollamaUrl: config.ollamaUrl,
    })
  }
  return cached
}

export function buildSystemPrompt(knowledgeBase: string): string {
  return `You are the WhatsApp customer support assistant for the business described below.

Rules:
- Answer ONLY from the knowledge base below. Never invent prices, stock, policies, or promises that are not written there.
- Reply in the customer's language (English or Swahili — match whichever they used).
- Keep replies short and friendly, suitable for WhatsApp. No markdown headers.
- If the customer asks for a human, is upset, or you are not confident the knowledge base answers their question, reply with exactly ${HANDOFF_TOKEN} and nothing else.

KNOWLEDGE BASE:
${knowledgeBase || '(empty — hand off anything you cannot answer from the conversation itself)'}`
}

const CONTEXT_LIMIT = 20

export async function getChatContext(chatId: string): Promise<ChatMessage[]> {
  const res = await query<{ body: string | null; from_me: boolean }>(
    `SELECT body, from_me FROM messages
     WHERE chat_id = $1 AND body IS NOT NULL AND body != ''
     ORDER BY created_at DESC LIMIT $2`,
    [chatId, CONTEXT_LIMIT],
  )
  const ordered = res.rows.reverse()

  // Merge consecutive same-role messages and ensure the first is from the user
  // (required by the Anthropic API; harmless for the others).
  const merged: ChatMessage[] = []
  for (const row of ordered) {
    const role = row.from_me ? 'assistant' : 'user'
    const last = merged[merged.length - 1]
    if (last && last.role === role) {
      last.content += `\n${row.body}`
    } else {
      merged.push({ role, content: row.body ?? '' })
    }
  }
  while (merged.length && merged[0].role === 'assistant') merged.shift()
  return merged
}

export async function generateAiReply(
  chatId: string,
  provider: AiProvider,
): Promise<{ text: string; handoff: boolean }> {
  const knowledgeBase = await loadKnowledgeBase()
  const messages = await getChatContext(chatId)
  if (messages.length === 0) return { text: '', handoff: true }
  const raw = await provider.chat(buildSystemPrompt(knowledgeBase), messages)
  return parseAiReply(raw)
}
