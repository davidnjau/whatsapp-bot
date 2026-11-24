import { describe, expect, it } from 'vitest'
import { normalizePhone, toChatId } from '../src/lib/phone.js'

describe('normalizePhone', () => {
  it('converts Kenyan 07XX local format', () => {
    expect(normalizePhone('0712345678')).toBe('254712345678')
  })

  it('converts Kenyan 01XX local format', () => {
    expect(normalizePhone('0110123456')).toBe('254110123456')
  })

  it('handles +254 with spaces', () => {
    expect(normalizePhone('+254 712 345 678')).toBe('254712345678')
  })

  it('keeps already-normalized numbers', () => {
    expect(normalizePhone('254712345678')).toBe('254712345678')
  })

  it('handles bare 9-digit mobile numbers', () => {
    expect(normalizePhone('712345678')).toBe('254712345678')
  })

  it('handles 00-prefixed international numbers', () => {
    expect(normalizePhone('00254712345678')).toBe('254712345678')
  })

  it('keeps non-Kenyan international numbers', () => {
    expect(normalizePhone('+1 (415) 555-2671')).toBe('14155552671')
  })

  it('strips an existing @c.us suffix', () => {
    expect(normalizePhone('254712345678@c.us')).toBe('254712345678')
  })

  it('rejects garbage', () => {
    expect(normalizePhone('hello')).toBeNull()
    expect(normalizePhone('123')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
})

describe('toChatId', () => {
  it('produces a @c.us chat id', () => {
    expect(toChatId('0712345678')).toBe('254712345678@c.us')
  })

  it('returns null for invalid input', () => {
    expect(toChatId('nope')).toBeNull()
  })
})
