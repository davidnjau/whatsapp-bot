export type ChatKind = 'dm' | 'group' | 'broadcast' | 'channel' | 'unknown'

export interface AddressedMessage {
  from?: string | null
  to?: string | null
  fromMe?: boolean | null
}

// The chat a message belongs to: `from` for inbound, `to` for our own messages.
export function chatKeyOf(msg: AddressedMessage): string | null {
  return (msg.fromMe ? msg.to ?? msg.from : msg.from) ?? null
}

export function classifyChat(chatId: string): ChatKind {
  // @lid is WhatsApp's privacy-preserving address — still a 1:1 chat.
  if (chatId.endsWith('@c.us') || chatId.endsWith('@s.whatsapp.net') || chatId.endsWith('@lid')) {
    return 'dm'
  }
  if (chatId.endsWith('@g.us')) return 'group'
  if (chatId.includes('@broadcast')) return 'broadcast'
  if (chatId.endsWith('@newsletter')) return 'channel'
  return 'unknown'
}

export function parseOptKeyword(text: string | null | undefined): 'stop' | 'start' | null {
  const t = (text ?? '').trim().toLowerCase()
  if (t === 'stop' || t === 'unsubscribe') return 'stop'
  if (t === 'start') return 'start'
  return null
}
