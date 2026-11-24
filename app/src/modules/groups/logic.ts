export interface KeywordReply {
  keywords: string[]
  reply: string
}

// Textarea format, one rule per line: "keyword1, keyword2 => reply text"
export function parseKeywordReplies(text: string): KeywordReply[] {
  const rules: KeywordReply[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [left, ...rest] = trimmed.split('=>')
    const reply = rest.join('=>').trim()
    const keywords = left.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
    if (keywords.length && reply) rules.push({ keywords, reply })
  }
  return rules
}

export function formatKeywordReplies(rules: KeywordReply[]): string {
  return rules.map((r) => `${r.keywords.join(', ')} => ${r.reply}`).join('\n')
}

export function matchKeywordReply(rules: KeywordReply[], text: string): KeywordReply | null {
  const t = text.toLowerCase()
  if (!t.trim()) return null
  for (const rule of rules) {
    if (rule.keywords.some((k) => t.includes(k))) return rule
  }
  return null
}

const LINK_PATTERN = /(https?:\/\/|www\.[^\s]|wa\.me\/|chat\.whatsapp\.com\/|bit\.ly\/|t\.me\/)/i

export function containsLink(text: string): boolean {
  return LINK_PATTERN.test(text)
}

export function renderWelcome(template: string, name: string): string {
  return template.replace(/\{\{\s*name\s*\}\}/g, name)
}

// "254788214765:3@c.us" / "254788214765@c.us" → "254788214765"
export function phoneFromId(id: string): string {
  return id.split('@')[0].split(':')[0]
}

export function isMentioned(
  body: string,
  mentionedIds: string[] | undefined,
  ourId: string,
): boolean {
  const ourPhone = phoneFromId(ourId)
  if (!ourPhone) return false
  if (mentionedIds?.some((id) => phoneFromId(id) === ourPhone)) return true
  return body.includes(`@${ourPhone}`)
}

export function stripMention(body: string, ourId: string): string {
  const ourPhone = phoneFromId(ourId)
  return body.replaceAll(`@${ourPhone}`, '').trim()
}

// group.v2.join / group.v2.participants payload shapes vary by engine version.
export function normalizeGroupEvent(payload: unknown): {
  groupId: string | null
  participants: string[]
} {
  if (!payload || typeof payload !== 'object') return { groupId: null, participants: [] }
  const p = payload as Record<string, unknown>

  let groupId: string | null = null
  const group = p.group
  if (typeof p.groupId === 'string') groupId = p.groupId
  else if (group && typeof group === 'object' && typeof (group as any).id === 'string') {
    groupId = (group as any).id
  } else if (typeof p.id === 'string' && p.id.endsWith('@g.us')) groupId = p.id
  else if (typeof p.chatId === 'string') groupId = p.chatId

  const raw = Array.isArray(p.participants) ? p.participants : []
  const participants = raw
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry && typeof entry === 'object' && typeof (entry as any).id === 'string') {
        return (entry as any).id as string
      }
      return null
    })
    .filter((id): id is string => !!id)

  return { groupId, participants }
}

// Participant shapes vary by engine: {isAdmin}, {admin: "admin"|"superadmin"}, {role}, {rank}.
export function extractAdminIds(participants: Array<Record<string, unknown>>): string[] {
  return participants
    .filter((p) => {
      if (p.isAdmin === true || p.isSuperAdmin === true) return true
      const flags = [p.admin, p.role, p.rank]
      return flags.some((f) => typeof f === 'string' && /admin/i.test(f))
    })
    .map((p) => (typeof p.id === 'string' ? p.id : null))
    .filter((id): id is string => !!id)
}
