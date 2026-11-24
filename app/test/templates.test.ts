import { describe, expect, it } from 'vitest'
import { listVariables, renderTemplate } from '../src/modules/notify/render.js'

describe('renderTemplate', () => {
  const body = 'Hi {{name}}, your order {{ order_id }} total {{total}}.'

  it('substitutes all variables', () => {
    const { text, missing } = renderTemplate(body, {
      name: 'Alice',
      order_id: 'A-1042',
      total: 'KES 2,500',
    })
    expect(text).toBe('Hi Alice, your order A-1042 total KES 2,500.')
    expect(missing).toEqual([])
  })

  it('accepts numbers', () => {
    const { text } = renderTemplate('Order {{n}}', { n: 42 })
    expect(text).toBe('Order 42')
  })

  it('reports missing variables and keeps their placeholders', () => {
    const { text, missing } = renderTemplate(body, { name: 'Alice' })
    expect(missing).toEqual(['order_id', 'total'])
    expect(text).toContain('{{order_id}}')
  })

  it('treats empty strings as missing', () => {
    expect(renderTemplate('Hi {{name}}', { name: '' }).missing).toEqual(['name'])
  })

  it('deduplicates repeated missing variables', () => {
    expect(renderTemplate('{{x}} and {{x}}', {}).missing).toEqual(['x'])
  })
})

describe('listVariables', () => {
  it('lists unique variables in order', () => {
    expect(listVariables('Hi {{name}}, {{ name }} — order {{order_id}}')).toEqual([
      'name',
      'order_id',
    ])
  })

  it('returns empty for plain text', () => {
    expect(listVariables('no placeholders here')).toEqual([])
  })
})
