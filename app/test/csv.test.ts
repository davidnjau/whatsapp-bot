import { describe, expect, it } from 'vitest'
import { parseCsvContacts } from '../src/modules/notify/csv.js'

describe('parseCsvContacts', () => {
  it('parses phone,name lines and normalizes numbers', () => {
    const { valid, invalid } = parseCsvContacts('0712345678,Alice\n+254 798 765 432,Bob\n712000111')
    expect(invalid).toEqual([])
    expect(valid).toEqual([
      { chatId: '254712345678@c.us', phone: '254712345678', name: 'Alice' },
      { chatId: '254798765432@c.us', phone: '254798765432', name: 'Bob' },
      { chatId: '254712000111@c.us', phone: '254712000111', name: null },
    ])
  })

  it('skips a header row', () => {
    const { valid } = parseCsvContacts('phone,name\n0712345678,Alice')
    expect(valid).toHaveLength(1)
  })

  it('collects invalid lines and dedupes repeats', () => {
    const { valid, invalid } = parseCsvContacts('0712345678,Alice\nabc123,X\n0712345678,Alice again')
    expect(invalid).toEqual(['abc123,X'])
    expect(valid).toHaveLength(1)
  })

  it('handles empty input', () => {
    expect(parseCsvContacts('')).toEqual({ valid: [], invalid: [] })
  })
})
