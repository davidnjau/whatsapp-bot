import { describe, expect, it } from 'vitest'
import { chatKeyOf, classifyChat, parseOptKeyword } from '../src/webhooks/classify.js'

describe('chatKeyOf', () => {
  it('uses from for inbound messages', () => {
    expect(chatKeyOf({ from: '254712345678@c.us', to: 'me@c.us', fromMe: false })).toBe(
      '254712345678@c.us',
    )
  })

  it('uses to for our own messages', () => {
    expect(chatKeyOf({ from: 'me@c.us', to: '254712345678@c.us', fromMe: true })).toBe(
      '254712345678@c.us',
    )
  })

  it('returns null when no address is present', () => {
    expect(chatKeyOf({})).toBeNull()
  })

  it('tolerates explicit nulls (GOWS sends "to": null)', () => {
    expect(chatKeyOf({ from: '27810030714954@lid', to: null, fromMe: false })).toBe(
      '27810030714954@lid',
    )
  })
})

describe('classifyChat', () => {
  it('detects 1:1 chats', () => {
    expect(classifyChat('254712345678@c.us')).toBe('dm')
    expect(classifyChat('254712345678@s.whatsapp.net')).toBe('dm')
    expect(classifyChat('27810030714954@lid')).toBe('dm')
  })

  it('detects groups', () => {
    expect(classifyChat('120363000000000000@g.us')).toBe('group')
  })

  it('detects status broadcast', () => {
    expect(classifyChat('status@broadcast')).toBe('broadcast')
  })

  it('detects channels', () => {
    expect(classifyChat('120363000000000000@newsletter')).toBe('channel')
  })
})

describe('parseOptKeyword', () => {
  it('matches STOP variants', () => {
    expect(parseOptKeyword('STOP')).toBe('stop')
    expect(parseOptKeyword(' stop ')).toBe('stop')
    expect(parseOptKeyword('Unsubscribe')).toBe('stop')
  })

  it('matches START', () => {
    expect(parseOptKeyword('START')).toBe('start')
    expect(parseOptKeyword('start')).toBe('start')
  })

  it('ignores normal messages', () => {
    expect(parseOptKeyword('please stop sending me flowers')).toBeNull()
    expect(parseOptKeyword('')).toBeNull()
    expect(parseOptKeyword(undefined)).toBeNull()
  })
})
