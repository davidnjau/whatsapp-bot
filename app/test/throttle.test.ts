import { describe, expect, it } from 'vitest'
import { pickDelayMs } from '../src/queue/throttle.js'

describe('pickDelayMs', () => {
  it('stays within the configured window', () => {
    expect(pickDelayMs(3, 10, () => 0)).toBe(3000)
    expect(pickDelayMs(3, 10, () => 1)).toBe(10000)
    expect(pickDelayMs(3, 10, () => 0.5)).toBe(6500)
  })

  it('clamps inverted or negative bounds', () => {
    expect(pickDelayMs(10, 3, () => 1)).toBe(10000)
    expect(pickDelayMs(-5, -1, () => 1)).toBe(0)
  })
})
