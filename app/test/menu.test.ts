import { describe, expect, it } from 'vitest'
import { matchMenuItem, menuList, parseMenuYaml, type Menu } from '../src/modules/support/menu.js'

const menu: Menu = {
  greeting: 'Welcome!',
  fallback: 'Reply with a number:',
  after_hours: 'We are closed.',
  media_ack: 'Thanks!',
  menu: [
    { key: '1', title: 'Prices', keywords: ['price', 'bei', 'how much'], reply: 'Prices are...', handoff: false },
    { key: '2', title: 'Delivery', keywords: ['delivery', 'tuma'], reply: 'We deliver...', handoff: false },
    { key: '0', title: 'Talk to a person', keywords: ['human', 'mtu'], handoff: true },
  ],
}

describe('matchMenuItem', () => {
  it('matches exact menu keys', () => {
    expect(matchMenuItem(menu, '1')?.title).toBe('Prices')
    expect(matchMenuItem(menu, ' 2 ')?.title).toBe('Delivery')
  })

  it('matches English keywords case-insensitively', () => {
    expect(matchMenuItem(menu, 'What are your PRICES?')?.title).toBe('Prices')
    expect(matchMenuItem(menu, 'how much is it')?.title).toBe('Prices')
  })

  it('matches Swahili keywords', () => {
    expect(matchMenuItem(menu, 'bei gani?')?.title).toBe('Prices')
    expect(matchMenuItem(menu, 'naweza tuma order?')?.title).toBe('Delivery')
  })

  it('flags handoff items', () => {
    expect(matchMenuItem(menu, '0')?.handoff).toBe(true)
    expect(matchMenuItem(menu, 'nataka mtu')?.handoff).toBe(true)
  })

  it('returns null when nothing matches', () => {
    expect(matchMenuItem(menu, 'tell me a joke')).toBeNull()
    expect(matchMenuItem(menu, '')).toBeNull()
  })
})

describe('menuList', () => {
  it('renders numbered options', () => {
    expect(menuList(menu)).toBe('1. Prices\n2. Delivery\n0. Talk to a person')
  })
})

describe('parseMenuYaml', () => {
  it('parses a valid menu file', () => {
    const parsed = parseMenuYaml(
      'greeting: hi\nmenu:\n  - key: "1"\n    title: Prices\n    keywords: [price]\n    reply: X',
    )
    expect(parsed.menu).toHaveLength(1)
    expect(parsed.menu[0].key).toBe('1')
  })

  it('rejects structurally invalid menus', () => {
    expect(() => parseMenuYaml('menu:\n  - title: no key')).toThrow()
  })
})
