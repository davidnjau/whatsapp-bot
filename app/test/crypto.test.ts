import { describe, expect, it } from 'vitest'
import { hmacSha512, safeEqual, verifyWebhookHmac } from '../src/lib/crypto.js'

describe('verifyWebhookHmac', () => {
  const key = 'test-secret'
  const body = Buffer.from(JSON.stringify({ event: 'message.any', payload: { id: 'x' } }))

  it('accepts a valid signature', () => {
    const signature = hmacSha512(body, key)
    expect(verifyWebhookHmac(body, signature, key)).toBe(true)
  })

  it('accepts an uppercase hex signature', () => {
    const signature = hmacSha512(body, key).toUpperCase()
    expect(verifyWebhookHmac(body, signature, key)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const signature = hmacSha512(body, key)
    expect(verifyWebhookHmac(Buffer.from('{"evil":true}'), signature, key)).toBe(false)
  })

  it('rejects a wrong key', () => {
    const signature = hmacSha512(body, 'other-key')
    expect(verifyWebhookHmac(body, signature, key)).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(verifyWebhookHmac(body, undefined, key)).toBe(false)
    expect(verifyWebhookHmac(body, '', key)).toBe(false)
    expect(verifyWebhookHmac(body, ['a', 'b'], key)).toBe(false)
  })
})

describe('safeEqual', () => {
  it('compares equal and unequal strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})
