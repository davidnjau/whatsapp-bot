const HUMAN_PATTERNS = [
  /\b(human|agent|person|someone|staff|manager|representative|real person)\b/,
  /talk to (a |an )?(person|human|agent|someone)/,
  /\b(mtu|binadamu|afisa|meneja)\b/,
  /(nataka|naomba|nahitaji) (kuongea|kuzungumza|msaada)/,
]

const ANGER_PATTERNS = [
  /\b(angry|furious|annoyed|terrible|awful|horrible|worst|useless|pathetic|scam|fraud|ripoff|rip-off)\b/,
  /\b(refund|complaint|report you|sue)\b/,
  /\b(wtf|fuck|fucking|shit|bullshit|damn it)\b/,
  /\b(mbaya sana|sijafurahi|nimechoka na|wizi|mnanidanganya)\b/,
]

export function wantsHuman(text: string): boolean {
  const t = text.toLowerCase()
  return HUMAN_PATTERNS.some((p) => p.test(t))
}

export function isAngry(text: string): boolean {
  const t = text.toLowerCase()
  return ANGER_PATTERNS.some((p) => p.test(t))
}

// Staff send "#bot off" / "#bot on" from the business number inside a chat.
export function parseStaffCommand(text: string): 'on' | 'off' | null {
  const m = text.trim().toLowerCase().match(/^#bot\s+(on|off)$/)
  return m ? (m[1] as 'on' | 'off') : null
}
