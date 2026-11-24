import { describe, expect, it } from 'vitest'
import { isWithinBusinessHours, parseBusinessHours } from '../src/modules/support/hours.js'

const TZ = 'Africa/Nairobi'
// Nairobi is UTC+3 year-round.
const nairobi = (iso: string) => new Date(iso)

describe('parseBusinessHours', () => {
  it('parses Mon-Sat 08:00-18:00', () => {
    expect(parseBusinessHours('Mon-Sat 08:00-18:00')).toEqual({
      startDay: 1,
      endDay: 6,
      startMinute: 480,
      endMinute: 1080,
    })
  })

  it('accepts full day names and loose spacing', () => {
    expect(parseBusinessHours('Monday - Friday 09:00 - 17:30')).toEqual({
      startDay: 1,
      endDay: 5,
      startMinute: 540,
      endMinute: 1050,
    })
  })

  it('returns null for garbage', () => {
    expect(parseBusinessHours('whenever')).toBeNull()
  })
})

describe('isWithinBusinessHours', () => {
  const spec = 'Mon-Sat 08:00-18:00'

  it('is open on a weekday mid-morning', () => {
    // Tue 2026-11-24 10:00 Nairobi = 07:00 UTC
    expect(isWithinBusinessHours(spec, nairobi('2026-11-24T07:00:00Z'), TZ)).toBe(true)
  })

  it('is closed late at night', () => {
    // Tue 21:00 Nairobi = 18:00 UTC
    expect(isWithinBusinessHours(spec, nairobi('2026-11-24T18:00:00Z'), TZ)).toBe(false)
  })

  it('is closed on Sunday', () => {
    // Sun 2026-11-22 10:00 Nairobi
    expect(isWithinBusinessHours(spec, nairobi('2026-11-22T07:00:00Z'), TZ)).toBe(false)
  })

  it('opening minute is inclusive, closing minute exclusive', () => {
    // 08:00 Nairobi = 05:00 UTC
    expect(isWithinBusinessHours(spec, nairobi('2026-11-24T05:00:00Z'), TZ)).toBe(true)
    // 18:00 Nairobi = 15:00 UTC
    expect(isWithinBusinessHours(spec, nairobi('2026-11-24T15:00:00Z'), TZ)).toBe(false)
  })

  it('treats an unparseable spec as always open', () => {
    expect(isWithinBusinessHours('24/7', nairobi('2026-11-22T23:00:00Z'), TZ)).toBe(true)
  })
})
