import { describe, expect, it } from 'vitest'
import {
  containsLink,
  extractAdminIds,
  formatKeywordReplies,
  isMentioned,
  matchKeywordReply,
  normalizeGroupEvent,
  parseKeywordReplies,
  phoneFromId,
  renderWelcome,
  stripMention,
} from '../src/modules/groups/logic.js'

describe('mention detection', () => {
  const ourId = '254788214765:3@c.us'

  it('detects mentions via mentionedIds', () => {
    expect(isMentioned('what are prices?', ['254788214765@c.us'], ourId)).toBe(true)
  })

  it('detects @phone in the body', () => {
    expect(isMentioned('@254788214765 bei gani?', undefined, ourId)).toBe(true)
  })

  it('ignores normal group chatter and other mentions', () => {
    expect(isMentioned('anyone selling a phone?', [], ourId)).toBe(false)
    expect(isMentioned('@254700000001 check this', ['254700000001@c.us'], ourId)).toBe(false)
  })

  it('strips the mention from the question', () => {
    expect(stripMention('@254788214765 how much is delivery?', ourId)).toBe('how much is delivery?')
  })

  it('normalizes device-suffixed ids', () => {
    expect(phoneFromId('254788214765:3@c.us')).toBe('254788214765')
    expect(phoneFromId('254788214765@c.us')).toBe('254788214765')
  })
})

describe('group event normalization', () => {
  it('handles { group: { id }, participants: [string] }', () => {
    expect(
      normalizeGroupEvent({ group: { id: '123@g.us' }, participants: ['254700000001@c.us'] }),
    ).toEqual({ groupId: '123@g.us', participants: ['254700000001@c.us'] })
  })

  it('handles { groupId, participants: [{ id }] }', () => {
    expect(
      normalizeGroupEvent({ groupId: '123@g.us', participants: [{ id: '254700000001@c.us' }] }),
    ).toEqual({ groupId: '123@g.us', participants: ['254700000001@c.us'] })
  })

  it('handles { id, participants }', () => {
    expect(normalizeGroupEvent({ id: '123@g.us', participants: [] })).toEqual({
      groupId: '123@g.us',
      participants: [],
    })
  })

  it('tolerates junk', () => {
    expect(normalizeGroupEvent(null)).toEqual({ groupId: null, participants: [] })
    expect(normalizeGroupEvent({ foo: 1 })).toEqual({ groupId: null, participants: [] })
  })
})

describe('keyword replies', () => {
  const text = 'price, bei => See our catalog\nmpesa => Till 123456'

  it('parses and round-trips the textarea format', () => {
    const rules = parseKeywordReplies(text)
    expect(rules).toEqual([
      { keywords: ['price', 'bei'], reply: 'See our catalog' },
      { keywords: ['mpesa'], reply: 'Till 123456' },
    ])
    expect(formatKeywordReplies(rules)).toBe(text)
  })

  it('skips malformed lines', () => {
    expect(parseKeywordReplies('no arrow here\n => reply only\nkw =>')).toEqual([])
  })

  it('matches case-insensitively', () => {
    const rules = parseKeywordReplies(text)
    expect(matchKeywordReply(rules, 'BEI gani hii?')?.reply).toBe('See our catalog')
    expect(matchKeywordReply(rules, 'hello everyone')).toBeNull()
  })
})

describe('link detection', () => {
  it('detects common link shapes', () => {
    expect(containsLink('check https://example.com')).toBe(true)
    expect(containsLink('join chat.whatsapp.com/abc123')).toBe(true)
    expect(containsLink('see www.shady.biz now')).toBe(true)
  })

  it('ignores plain text', () => {
    expect(containsLink('meet at 10. bring snacks')).toBe(false)
  })
})

describe('welcome rendering', () => {
  it('substitutes {{name}}', () => {
    expect(renderWelcome('Karibu {{name}}! 🎉', '+254700000001')).toBe('Karibu +254700000001! 🎉')
  })
})

describe('admin extraction', () => {
  it('handles the engine shape variants', () => {
    expect(
      extractAdminIds([
        { id: 'a@c.us', isAdmin: true },
        { id: 'b@c.us', admin: 'superadmin' },
        { id: 'c@c.us', role: 'admin' },
        { id: 'd@c.us' },
        { id: 'e@c.us', rank: 'member' },
      ]),
    ).toEqual(['a@c.us', 'b@c.us', 'c@c.us'])
  })
})
