export type ShopIntent =
  | { kind: 'catalogue' }
  | { kind: 'buy'; productId: number }
  | { kind: 'reserve_prompt' } // "mine" with no number — ask which dress
  | { kind: 'fit'; productId: number; message: string } // "will #12 fit me?"
  | { kind: 'style'; productId: number; message: string } // "how do I style #12?"
  | { kind: 'cancel' }
  | { kind: 'none' }

const CATALOGUE = /\b(catalogue|catalog|dresses|dress list|stock|orodha|nguo|mnauza|what do you (have|sell)|price list)\b/i
// "cancel"/"acha"/"ghairi" — deliberately NOT "stop" (that's the opt-out keyword).
const CANCEL = /\b(cancel|acha order|ghairi|achana|niache)\b/i
const BUY_VERB =
  /(?:\bbuy\b|\border\b|\bnataka\b|\bniuzie\b|\bnaomba\b|\btake\b|\bchukua\b|\bmine\b)\s*(?:hiyo|hii|the|dress|number|no\.?|ni|#)?\s*#?\s*(\d{1,6})/i
const HASH_NUM = /#\s*(\d{1,6})/
const BARE_NUM = /^(\d{1,6})$/
const MINE = /\bmine\b/i

// Bare single digits 0–4 are support-menu options (see knowledge/menu.yaml),
// not product ids — pick those products with "#N" instead.
const MENU_NUMBERS = new Set(['0', '1', '2', '3', '4'])

// Fit / styling questions about a specific dress → route to the AI advisor.
const FIT = /\b(fit|fits|fitting|size|sizing|measurements?|bust|waist|hips?|height|tall|slim|curvy|uk\s?\d|eu\s?\d|us\s?\d|inafit|itakufit|nitafit)\b/i
const STYLE = /\b(style|styling|how (do|to) (i|you)? ?wear|pair|match|shoes|heels|accessor|jewel|clutch|handbag|niovae|nivae)\b/i

// Find a dress id referenced in the text (#N, "dress N", or a plausible number).
function findProductId(t: string): number | null {
  const hash = t.match(/#\s*(\d{1,6})/)
  if (hash) return Number.parseInt(hash[1], 10)
  const dress = t.match(/\bdress\s*#?\s*(\d{1,6})/i)
  if (dress) return Number.parseInt(dress[1], 10)
  const num = t.match(/\b(\d{1,6})\b/)
  if (num && !MENU_NUMBERS.has(num[1])) return Number.parseInt(num[1], 10)
  return null
}

export function detectShopIntent(text: string): ShopIntent {
  const t = text.trim()
  if (!t) return { kind: 'none' }
  if (CANCEL.test(t)) return { kind: 'cancel' }

  // An explicit buy verb wins (so "buy #12 size 10" still orders).
  const verb = t.match(BUY_VERB)
  if (verb) return { kind: 'buy', productId: Number.parseInt(verb[1], 10) }

  // Fit / styling questions (before plain number → buy), need a dress id.
  if (FIT.test(t)) {
    const id = findProductId(t)
    if (id) return { kind: 'fit', productId: id, message: t }
  }
  if (STYLE.test(t)) {
    const id = findProductId(t)
    if (id) return { kind: 'style', productId: id, message: t }
  }

  const hash = t.match(HASH_NUM)
  if (hash) return { kind: 'buy', productId: Number.parseInt(hash[1], 10) }

  // "mine" — claim a dress. With a number anywhere, buy it; alone, ask which.
  if (MINE.test(t)) {
    const num = t.match(/\d{1,6}/)
    return num ? { kind: 'buy', productId: Number.parseInt(num[0], 10) } : { kind: 'reserve_prompt' }
  }

  const bare = t.match(BARE_NUM)
  if (bare && !MENU_NUMBERS.has(bare[1])) {
    return { kind: 'buy', productId: Number.parseInt(bare[1], 10) }
  }

  if (CATALOGUE.test(t)) return { kind: 'catalogue' }
  return { kind: 'none' }
}

export type DeliveryOption = 'agent' | 'doorstep' | 'errand'

// Accepts "1"/"2"/"3" or keywords, in English/Swahili.
export function parseDeliveryOption(text: string): DeliveryOption | null {
  const t = text.trim().toLowerCase()
  if (/^1\b/.test(t) || /\b(agent|pickup|mtaani|collect|nitachukua)\b/.test(t)) return 'agent'
  if (/^2\b/.test(t) || /\b(doorstep|door|home|nyumbani|rider)\b/.test(t)) return 'doorstep'
  if (/^3\b/.test(t) || /\b(errand|upcountry|sacco|coach|courier|ushago|mashinani)\b/.test(t)) {
    return 'errand'
  }
  return null
}
