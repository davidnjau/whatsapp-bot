import { createHmac, timingSafeEqual } from 'node:crypto'

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function hmacSha512(body: Buffer, key: string): string {
  return createHmac('sha512', key).update(body).digest('hex')
}

export function verifyWebhookHmac(raw: Buffer, header: unknown, key: string): boolean {
  if (typeof header !== 'string' || header.length === 0) return false
  return safeEqual(hmacSha512(raw, key), header.toLowerCase())
}
