import { describe, expect, it } from 'vitest'
import { computeRunway, pickFxRate, resolveOptions, retryDecision, failureRate } from '../src/modules/gpu/logic.js'

describe('computeRunway', () => {
  it('uses the 7-day average when there is enough history', () => {
    const r = computeRunway(30, [1, 2, 3, 2, 2]) // avg 2/day
    expect(r.basis).toBe('history')
    expect(r.enoughData).toBe(true)
    expect(r.avgDailyUsd).toBeCloseTo(2)
    expect(r.daysLeft).toBeCloseTo(15)
  })

  it('falls back to the current spend rate with < 3 days of data', () => {
    const r = computeRunway(24, [5], 0.05) // 0.05/hr -> 1.2/day
    expect(r.basis).toBe('spend-rate')
    expect(r.enoughData).toBe(false)
    expect(r.avgDailyUsd).toBeCloseTo(1.2)
    expect(r.daysLeft).toBeCloseTo(20)
  })

  it('reports no measurable spend when history is zero and no rate', () => {
    const r = computeRunway(30, [0, 0, 0])
    expect(r.daysLeft).toBeNull()
    expect(r.basis).toBe('history')
  })

  it('has no runway when there is no data at all', () => {
    const r = computeRunway(30, [], 0)
    expect(r.basis).toBe('none')
    expect(r.daysLeft).toBeNull()
  })
})

describe('pickFxRate (fallback order)', () => {
  const live = { rate: 130, asOf: 'now' }
  const cached = { rate: 128, asOf: 'yesterday' }

  it('prefers a fresh live rate', () => {
    expect(pickFxRate({ live, cached, manual: 125 })).toEqual({ rate: 130, asOf: 'now', source: 'live' })
  })

  it('falls back to the cached rate when live is missing', () => {
    expect(pickFxRate({ live: null, cached, manual: 125 })).toEqual({ rate: 128, asOf: 'yesterday', source: 'cached' })
  })

  it('falls back to the manual override when live and cache are gone', () => {
    expect(pickFxRate({ live: null, cached: null, manual: 125 })).toEqual({ rate: 125, asOf: null, source: 'manual' })
  })

  it('reports none when nothing is available', () => {
    expect(pickFxRate({ live: null, cached: null, manual: null })).toEqual({ rate: null, asOf: null, source: 'none' })
  })

  it('ignores a zero/garbage live rate and uses the cache', () => {
    expect(pickFxRate({ live: { rate: 0, asOf: 'now' }, cached }).source).toBe('cached')
  })
})

describe('resolveOptions (dependencies)', () => {
  it('auto-enables cutout when studio image is on', () => {
    const { resolved, autoEnabled } = resolveOptions({ studio: true, cutout: false })
    expect(resolved.cutout).toBe(true)
    expect(autoEnabled).toContain('cutout')
  })

  it('does not auto-enable anything when deps are already met', () => {
    const { resolved, autoEnabled } = resolveOptions({ studio: true, cutout: true })
    expect(resolved.cutout).toBe(true)
    expect(autoEnabled).toEqual([])
  })

  it('leaves independent steps as chosen', () => {
    const { resolved, autoEnabled } = resolveOptions({ copy: false, embedding: true })
    expect(resolved.copy).toBe(false)
    expect(resolved.embedding).toBe(true)
    expect(resolved.cutout).toBe(false)
    expect(autoEnabled).toEqual([])
  })
})

describe('retryDecision (cap)', () => {
  it('allows a first automatic retry and retries in place when recent', () => {
    expect(retryDecision({ autoAttempts: 0, jobAgeMs: 60_000 })).toEqual({ allowed: true, method: 'retry' })
  })

  it('blocks a second automatic retry (cap = 1)', () => {
    expect(retryDecision({ autoAttempts: 1, jobAgeMs: 60_000 }).allowed).toBe(false)
  })

  it('resubmits instead of retrying once the job is over 30 min old', () => {
    expect(retryDecision({ autoAttempts: 0, jobAgeMs: 40 * 60_000 }).method).toBe('resubmit')
  })

  it('lets a manual retry bypass the cap', () => {
    expect(retryDecision({ autoAttempts: 5, jobAgeMs: 1000, manual: true }).allowed).toBe(true)
  })
})

describe('failureRate', () => {
  it('is zero with no jobs', () => expect(failureRate(0, 0)).toBe(0))
  it('computes failed / total', () => expect(failureRate(8, 2)).toBeCloseTo(0.2))
})
