import { describe, expect, it } from 'vitest'
import { buildStatusCaption, formatKsh, parseDressLabel, productName } from '../src/modules/shop/label.js'

describe('parseDressLabel', () => {
  it('reads the standard badge', () => {
    expect(parseDressLabel('SIZE 14\nKsh 1000')).toEqual({ size: '14', price: 1000 })
  })

  it('reads split sizes and comma prices', () => {
    expect(parseDressLabel('SIZE 14/16\nKSH 1,000')).toEqual({ size: '14/16', price: 1000 })
    expect(parseDressLabel('size 8 / 10 kshs. 1,500')).toEqual({ size: '8/10', price: 1500 })
  })

  it('tolerates OCR spacing noise', () => {
    expect(parseDressLabel('S I Z E ignored\nSIZE: 12   K S H 950')).toEqual({ size: '12', price: 950 })
  })

  it('reads 1000/- style prices', () => {
    expect(parseDressLabel('SIZE 16 ... 1,000/-').price).toBe(1000)
  })

  it('returns nulls when nothing is found', () => {
    expect(parseDressLabel('a lovely dress on a mannequin')).toEqual({ size: null, price: null })
  })

  it('rejects absurd prices', () => {
    expect(parseDressLabel('Ksh 2').price).toBeNull()
    expect(parseDressLabel('Ksh 5000000').price).toBeNull()
  })
})

describe('productName / caption', () => {
  const product = { id: 7, title: null, size: '14', price_ksh: 1000 }

  it('falls back to Dress #id', () => {
    expect(productName(product)).toBe('Dress #7')
    expect(productName({ ...product, title: 'Floral wrap' })).toBe('Floral wrap')
  })

  it('builds the status caption with label and shop link', () => {
    const caption = buildStatusCaption(product, 'https://bot.example.com')
    expect(caption).toContain('Dress #7')
    expect(caption).toContain('SIZE 14 • Ksh 1,000')
    expect(caption).toContain('https://bot.example.com/shop/p/7')
  })

  it('formats Ksh with separators', () => {
    expect(formatKsh(1000)).toBe('Ksh 1,000')
  })
})
