import { describe, expect, it } from 'vitest'
import { detectShopIntent, parseDeliveryOption } from '../src/modules/shop/chat-intent.js'

describe('detectShopIntent', () => {
  it('detects buy commands in English and Swahili', () => {
    expect(detectShopIntent('buy 3')).toEqual({ kind: 'buy', productId: 3 })
    expect(detectShopIntent('I want to order #12')).toEqual({ kind: 'buy', productId: 12 })
    expect(detectShopIntent('nataka 7')).toEqual({ kind: 'buy', productId: 7 })
    expect(detectShopIntent('niuzie hiyo 5')).toEqual({ kind: 'buy', productId: 5 })
    expect(detectShopIntent('#9')).toEqual({ kind: 'buy', productId: 9 })
  })

  it('accepts a bare dress number, or # for low ids that clash with the menu', () => {
    expect(detectShopIntent('21')).toEqual({ kind: 'buy', productId: 21 })
    expect(detectShopIntent('#21')).toEqual({ kind: 'buy', productId: 21 })
    expect(detectShopIntent(' 15 ')).toEqual({ kind: 'buy', productId: 15 })
    // low bare numbers are menu options; use # to pick those dresses
    expect(detectShopIntent('3')).toEqual({ kind: 'none' })
    expect(detectShopIntent('#3')).toEqual({ kind: 'buy', productId: 3 })
  })

  it('handles the "mine" claim keyword', () => {
    expect(detectShopIntent('mine')).toEqual({ kind: 'reserve_prompt' })
    expect(detectShopIntent('mine 21')).toEqual({ kind: 'buy', productId: 21 })
    expect(detectShopIntent('21 ni mine')).toEqual({ kind: 'buy', productId: 21 })
  })

  it('detects catalogue requests', () => {
    expect(detectShopIntent('catalogue')).toEqual({ kind: 'catalogue' })
    expect(detectShopIntent('what do you have?')).toEqual({ kind: 'catalogue' })
    expect(detectShopIntent('mnauza nini')).toEqual({ kind: 'catalogue' })
    expect(detectShopIntent('show me the dresses')).toEqual({ kind: 'catalogue' })
  })

  it('detects cancel but not the STOP opt-out keyword', () => {
    expect(detectShopIntent('cancel')).toEqual({ kind: 'cancel' })
    expect(detectShopIntent('acha order')).toEqual({ kind: 'cancel' })
    expect(detectShopIntent('STOP')).toEqual({ kind: 'none' })
  })

  it('detects fit questions about a dress', () => {
    expect(detectShopIntent('will #12 fit me? I am UK 10')).toEqual({ kind: 'fit', productId: 12, message: 'will #12 fit me? I am UK 10' })
    expect(detectShopIntent("I'm 5'5 curvy, does dress 7 fit")).toMatchObject({ kind: 'fit', productId: 7 })
  })

  it('detects styling questions about a dress', () => {
    expect(detectShopIntent('how do I style #9?')).toMatchObject({ kind: 'style', productId: 9 })
    expect(detectShopIntent('what shoes with #21')).toMatchObject({ kind: 'style', productId: 21 })
  })

  it('an explicit buy verb still wins over fit/size words', () => {
    expect(detectShopIntent('buy #12 size 10')).toEqual({ kind: 'buy', productId: 12 })
    expect(detectShopIntent('order #7')).toEqual({ kind: 'buy', productId: 7 })
  })

  it('ignores normal chatter', () => {
    expect(detectShopIntent('hi there')).toEqual({ kind: 'none' })
    expect(detectShopIntent('')).toEqual({ kind: 'none' })
  })
})

describe('parseDeliveryOption', () => {
  it('accepts numbers', () => {
    expect(parseDeliveryOption('1')).toBe('agent')
    expect(parseDeliveryOption('2')).toBe('doorstep')
    expect(parseDeliveryOption('3')).toBe('errand')
  })

  it('accepts keywords in English and Swahili', () => {
    expect(parseDeliveryOption('agent pickup please')).toBe('agent')
    expect(parseDeliveryOption('doorstep')).toBe('doorstep')
    expect(parseDeliveryOption('nyumbani')).toBe('doorstep')
    expect(parseDeliveryOption('send upcountry via Easy Coach')).toBe('errand')
    expect(parseDeliveryOption('ushago')).toBe('errand')
  })

  it('returns null for unclear input', () => {
    expect(parseDeliveryOption('maybe')).toBeNull()
  })
})
