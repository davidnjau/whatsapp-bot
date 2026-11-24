// Normalizes Kenyan and international numbers to digits-only MSISDN (2547XXXXXXXX).
export function normalizePhone(input: string): string | null {
  let digits = input.trim()
  if (digits.endsWith('@c.us')) digits = digits.slice(0, -'@c.us'.length)
  digits = digits.replace(/[\s().\-+]/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (!/^\d{7,15}$/.test(digits)) return null
  if (digits.startsWith('0') && digits.length === 10) return '254' + digits.slice(1)
  if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) {
    return '254' + digits
  }
  return digits
}

export function toChatId(input: string): string | null {
  const phone = normalizePhone(input)
  return phone ? `${phone}@c.us` : null
}
