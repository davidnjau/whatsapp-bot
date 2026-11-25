import { describe, expect, it } from 'vitest'
import {
  greetingFor,
  matchMenuItem,
  menuList,
  parseLanguageChoice,
  parseMenuYaml,
  type Menu,
} from '../src/modules/support/menu.js'

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

  it('uses localized titles when present, falling back to the base title', () => {
    const localized: Menu = {
      ...menu,
      menu: [
        { ...menu.menu[0], titles: { en: 'Prices', sw: 'Bei' } },
        menu.menu[1],
        menu.menu[2],
      ],
    }
    expect(menuList(localized, 'sw')).toBe('1. Bei\n2. Delivery\n0. Talk to a person')
    expect(menuList(localized, 'en')).toBe('1. Prices\n2. Delivery\n0. Talk to a person')
    expect(menuList(localized, 'mix')).toBe('1. Prices\n2. Delivery\n0. Talk to a person')
  })
})

describe('parseLanguageChoice', () => {
  it('reads numbers and keywords', () => {
    expect(parseLanguageChoice('1')).toBe('en')
    expect(parseLanguageChoice('English')).toBe('en')
    expect(parseLanguageChoice('2')).toBe('sw')
    expect(parseLanguageChoice('Kiswahili')).toBe('sw')
    expect(parseLanguageChoice('3')).toBe('mix')
    expect(parseLanguageChoice('mchanganyiko')).toBe('mix')
  })

  it('returns null for anything else', () => {
    expect(parseLanguageChoice('hello')).toBeNull()
    expect(parseLanguageChoice('4')).toBeNull()
  })
})

describe('greetingFor', () => {
  it('prefers the localized greeting, falls back to base', () => {
    const m: Menu = { ...menu, greeting: 'Karibu', greetings: { en: 'Welcome' } }
    expect(greetingFor(m, 'en')).toBe('Welcome')
    expect(greetingFor(m, 'sw')).toBe('Karibu') // no sw → base
    expect(greetingFor(m, 'mix')).toBe('Karibu')
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
