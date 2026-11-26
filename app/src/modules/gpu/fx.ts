import { getSetting, setSetting } from '../../lib/settings.js'
import { pickFxRate, type FxPick } from './logic.js'

const FX_URL = 'https://open.er-api.com/v6/latest/USD'
const TTL_MS = 12 * 60 * 60 * 1000

// Persisted keys: fx_usd_kes / fx_usd_kes_asof (last good live rate),
// fx_manual_rate (admin override used only when live + cache both fail).
let mem: { rate: number; asOf: string; at: number } | null = null

async function cachedPick(): Promise<FxPick> {
  const stored = Number(await getSetting('fx_usd_kes', ''))
  const asOf = await getSetting('fx_usd_kes_asof', '')
  const manual = Number(await getSetting('fx_manual_rate', ''))
  return pickFxRate({
    live: null,
    cached: stored > 0 ? { rate: stored, asOf } : null,
    manual: Number.isFinite(manual) ? manual : null,
  })
}

// USD→KES with a 12h cache. On failure: last cached rate → admin manual override.
export async function getFx(force = false): Promise<FxPick> {
  if (!force && mem && Date.now() - mem.at < TTL_MS) {
    return { rate: mem.rate, asOf: mem.asOf, source: 'live' }
  }
  try {
    const res = await fetch(FX_URL, { signal: AbortSignal.timeout(8000) })
    const data = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string }
    const rate = data.rates?.KES
    if (data.result !== 'success' || !rate || rate <= 0) throw new Error('bad FX response')
    const asOf = data.time_last_update_utc ?? new Date().toUTCString()
    mem = { rate, asOf, at: Date.now() }
    await setSetting('fx_usd_kes', String(rate))
    await setSetting('fx_usd_kes_asof', asOf)
    return { rate, asOf, source: 'live' }
  } catch {
    return cachedPick()
  }
}
