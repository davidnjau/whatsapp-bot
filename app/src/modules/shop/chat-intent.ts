export type ShopIntent =
  | { kind: 'catalogue' }
  | { kind: 'buy'; productId: number }
  | { kind: 'cancel' }
  | { kind: 'none' }

const CATALOGUE = /\b(catalogue|catalog|dresses|dress list|stock|orodha|nguo|mnauza|what do you (have|sell)|price list)\b/i
// "cancel"/"acha"/"ghairi" — deliberately NOT "stop" (that's the opt-out keyword).
const CANCEL = /\b(cancel|acha order|ghairi|achana|niache)\b/i
const BUY =
  /(?:\bbuy\b|\border\b|\bnataka\b|\bniuzie\b|\bnaomba\b|\btake\b|\bchukua\b)\s*(?:hiyo|hii|the|dress|number|no\.?|#)?\s*#?\s*(\d{1,6})|^#\s*(\d{1,6})\b/i

export function detectShopIntent(text: string): ShopIntent {
  const t = text.trim()
  if (!t) return { kind: 'none' }
  if (CANCEL.test(t)) return { kind: 'cancel' }
  const buy = t.match(BUY)
  if (buy) {
    const id = Number.parseInt(buy[1] ?? buy[2], 10)
    if (id > 0) return { kind: 'buy', productId: id }
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
