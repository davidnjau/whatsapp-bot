// Pure GPU-dashboard logic — no config/db imports, so it stays unit-testable.

export const THIRTY_MIN_MS = 30 * 60 * 1000

export interface Runway {
  avgDailyUsd: number
  daysLeft: number | null // null = no measurable spend (effectively unlimited)
  enoughData: boolean
  basis: 'history' | 'spend-rate' | 'none'
}

// Balance ÷ average daily spend. With < 3 days of history we fall back to the
// current spend rate ($/hr × 24) from /v2/account/limits, and flag it.
export function computeRunway(balanceUsd: number, dailySpends: number[], spendRatePerHour = 0): Runway {
  if (dailySpends.length >= 3) {
    const avg = dailySpends.reduce((a, b) => a + b, 0) / dailySpends.length
    return {
      avgDailyUsd: avg,
      daysLeft: avg > 0 ? balanceUsd / avg : null,
      enoughData: true,
      basis: 'history',
    }
  }
  const estDaily = spendRatePerHour * 24
  if (estDaily > 0) {
    return { avgDailyUsd: estDaily, daysLeft: balanceUsd / estDaily, enoughData: false, basis: 'spend-rate' }
  }
  return { avgDailyUsd: 0, daysLeft: null, enoughData: false, basis: 'none' }
}

export interface FxPick {
  rate: number | null
  asOf: string | null
  source: 'live' | 'cached' | 'manual' | 'none'
}

// FX fallback order: fresh live rate → last cached rate → admin manual override → none.
export function pickFxRate(opts: {
  live?: { rate: number; asOf: string } | null
  cached?: { rate: number; asOf: string } | null
  manual?: number | null
}): FxPick {
  if (opts.live && opts.live.rate > 0) return { rate: opts.live.rate, asOf: opts.live.asOf, source: 'live' }
  if (opts.cached && opts.cached.rate > 0) return { rate: opts.cached.rate, asOf: opts.cached.asOf, source: 'cached' }
  if (opts.manual && opts.manual > 0) return { rate: opts.manual, asOf: null, source: 'manual' }
  return { rate: null, asOf: null, source: 'none' }
}

export const INGEST_STEPS = [
  'cutout',
  'studio',
  'copy',
  'colour',
  'fit',
  'embedding',
  'styling',
  'video',
] as const
export type IngestStep = (typeof INGEST_STEPS)[number]

// A step's hard prerequisites. Enabling it auto-enables these (and tells the UI).
const STEP_DEPS: Partial<Record<IngestStep, IngestStep[]>> = {
  studio: ['cutout'], // the studio image is composited on the BiRefNet cutout
}

export interface ResolvedOptions {
  resolved: Record<IngestStep, boolean>
  autoEnabled: IngestStep[] // deps we switched on because a dependent was on
}

export function resolveOptions(opts: Partial<Record<IngestStep, boolean>>): ResolvedOptions {
  const resolved = {} as Record<IngestStep, boolean>
  for (const step of INGEST_STEPS) resolved[step] = !!opts[step]
  const autoEnabled: IngestStep[] = []
  for (const step of INGEST_STEPS) {
    if (!resolved[step]) continue
    for (const dep of STEP_DEPS[step] ?? []) {
      if (!resolved[dep]) {
        resolved[dep] = true
        if (!autoEnabled.includes(dep)) autoEnabled.push(dep)
      }
    }
  }
  return { resolved, autoEnabled }
}

export interface RetryDecision {
  allowed: boolean
  method: 'retry' | 'resubmit' // POST /retry/{id} vs. a brand-new /run job
}

// Jobs under 30 min old can be retried in place; older ones must be resubmitted
// (RunPod drops /run results after 30 min). Automatic retries are capped so a
// broken image can't loop; a manual click from the admin bypasses the cap.
export function retryDecision(opts: {
  autoAttempts: number
  jobAgeMs: number
  manual?: boolean
  cap?: number
}): RetryDecision {
  const cap = opts.cap ?? 1
  const allowed = !!opts.manual || opts.autoAttempts < cap
  const method = opts.jobAgeMs < THIRTY_MIN_MS ? 'retry' : 'resubmit'
  return { allowed, method }
}

export function failureRate(completed: number, failed: number): number {
  const total = completed + failed
  return total > 0 ? failed / total : 0
}
