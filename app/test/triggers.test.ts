import { describe, expect, it } from 'vitest'
import { isAngry, parseStaffCommand, wantsHuman } from '../src/modules/support/triggers.js'

describe('wantsHuman', () => {
  it('detects explicit requests in English', () => {
    expect(wantsHuman('I want to talk to a person')).toBe(true)
    expect(wantsHuman('can I speak to an agent?')).toBe(true)
    expect(wantsHuman('give me a HUMAN')).toBe(true)
  })

  it('detects requests in Swahili', () => {
    expect(wantsHuman('nataka kuongea na mtu')).toBe(true)
    expect(wantsHuman('naomba msaada wa meneja')).toBe(true)
  })

  it('ignores normal questions', () => {
    expect(wantsHuman('what are your prices?')).toBe(false)
    expect(wantsHuman('do you deliver to Mombasa?')).toBe(false)
  })
})

describe('isAngry', () => {
  it('detects angry messages', () => {
    expect(isAngry('this is terrible service, I want a refund')).toBe(true)
    expect(isAngry('mnanidanganya, hii ni wizi')).toBe(true)
  })

  it('ignores calm messages', () => {
    expect(isAngry('thanks, that was fast!')).toBe(false)
  })
})

describe('parseStaffCommand', () => {
  it('parses #bot on/off', () => {
    expect(parseStaffCommand('#bot off')).toBe('off')
    expect(parseStaffCommand('#BOT ON')).toBe('on')
    expect(parseStaffCommand('  #bot  on ')).toBe('on')
  })

  it('ignores everything else', () => {
    expect(parseStaffCommand('hello')).toBeNull()
    expect(parseStaffCommand('#bot maybe')).toBeNull()
    expect(parseStaffCommand('robot on')).toBeNull()
  })
})
