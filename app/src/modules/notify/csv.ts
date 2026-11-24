import { normalizePhone } from '../../lib/phone.js'

export interface CsvContact {
  chatId: string
  phone: string
  name: string | null
}

// Lines of "phone" or "phone,name". A header line containing "phone" is skipped.
export function parseCsvContacts(text: string): { valid: CsvContact[]; invalid: string[] } {
  const valid: CsvContact[] = []
  const invalid: string[] = []
  const seen = new Set<string>()

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const [index, line] of lines.entries()) {
    const [rawPhone, ...rest] = line.split(',')
    if (index === 0 && !/\d/.test(rawPhone)) continue // header row
    const phone = normalizePhone(rawPhone.replace(/["']/g, ''))
    if (!phone) {
      invalid.push(line)
      continue
    }
    if (seen.has(phone)) continue
    seen.add(phone)
    const name = rest.join(',').replace(/["']/g, '').trim() || null
    valid.push({ chatId: `${phone}@c.us`, phone, name })
  }
  return { valid, invalid }
}
