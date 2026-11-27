export interface DressLabel {
  size: string | null
  price: number | null
}

// Pulls "SIZE 14" / "SIZE 14/16" and "Ksh 1000" / "KSH 1,000" out of OCR text.
export function parseDressLabel(text: string): DressLabel {
  const sizeMatch = text.match(/SIZE\s*[:.\-]?\s*(\d{1,2}(?:\s*\/\s*\d{1,2})?)/i)
  const size = sizeMatch ? sizeMatch[1].replace(/\s+/g, '') : null

  let price: number | null = null
  const priceMatch =
    text.match(/K\s*S\s*H\s*S?\.?\s*[:.\-]?\s*([\d][\d,.\s]*)/i) ??
    text.match(/(\d[\d,]{2,6})\s*\/[-=]/)
  if (priceMatch) {
    const value = Number.parseInt(priceMatch[1].replace(/[^\d]/g, ''), 10)
    if (value >= 50 && value <= 100_000) price = value
  }
  return { size, price }
}

export function formatKsh(amount: number): string {
  return `Ksh ${amount.toLocaleString('en-KE')}`
}

export interface ProductSummary {
  id: number
  title: string | null
  size: string | null
  price_ksh: number | null
}

export function productName(p: ProductSummary): string {
  return p.title?.trim() || `Dress #${p.id}`
}

export function buildStatusCaption(p: ProductSummary, baseUrl: string): string {
  const lines = [`💃 ${productName(p)}`]
  const facts: string[] = []
  if (p.size) facts.push(`SIZE ${p.size}`)
  if (p.price_ksh) facts.push(formatKsh(p.price_ksh))
  if (facts.length) lines.push(facts.join(' • '))
  lines.push('Single piece — first come, first served!')
  lines.push(`Order: ${baseUrl}/shop/p/${p.id}`)
  return lines.join('\n')
}
