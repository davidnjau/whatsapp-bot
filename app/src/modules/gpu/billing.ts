import { config } from '../../config.js'
import { query } from '../../db.js'

const API = 'https://api.runpod.io'

// Tiny TTL cache so a dashboard refresh doesn't hammer RunPod (it only bills
// every 5 min anyway). Keyed by request; health gets a shorter TTL.
const cache = new Map<string, { at: number; val: unknown }>()
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.val as T
  const val = await fn()
  cache.set(key, { at: Date.now(), val })
  return val
}
export function bustBillingCache(): void {
  cache.clear()
}

export function billingConfigured(): boolean {
  return !!config.runpodBillingKey
}

async function rpBilling<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${config.runpodBillingKey}` } })
  if (!res.ok) throw new Error(`RunPod billing ${path} -> HTTP ${res.status}`)
  return (await res.json()) as T
}

function serverlessId(): string {
  // The billing API keys serverless spend by the same id we POST jobs to.
  return config.runpodEndpoint.replace(/\/$/, '').split('/').pop() ?? ''
}

function utcMidnight(daysAgo = 0): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d
}

export interface Balance {
  usd: number
  billingMode: string
}
export async function getBalance(): Promise<Balance> {
  return cached('balance', 5 * 60_000, async () => {
    const r = await rpBilling<{ balanceAmount: number; billingMode: string }>('/v2/billing/balance')
    return { usd: r.balanceAmount, billingMode: r.billingMode }
  })
}

interface DayRecord {
  totalAmount: number
  gpuAmount: number
  startTime: string
}

export interface Usage {
  spentToday: number
  spent7d: number
  dailySpends: number[] // per-day totals, oldest→newest, for the runway average
  days: { date: string; total: number }[] // for the bar chart (last 7)
  networkVolumeMonthly: number // storageHighPerformanceAmount over the window
}

// Per-endpoint serverless spend, daily buckets, last 7 days.
export async function getUsage(): Promise<Usage> {
  return cached('usage', 5 * 60_000, async () => {
    const start = utcMidnight(7).toISOString()
    const end = utcMidnight(-1).toISOString()
    const sid = serverlessId()
    const [sl, acct] = await Promise.all([
      rpBilling<{ records: DayRecord[] }>(
        `/v2/billing/serverless?serverlessId=${sid}&bucketSize=day&startTime=${start}&endTime=${end}`,
      ),
      rpBilling<{ totals: { storageHighPerformanceAmount: number } } | { metadata: { totals: { storageHighPerformanceAmount: number } } }>(
        `/v2/billing?bucketSize=day&startTime=${start}&endTime=${end}`,
      ),
    ])
    const todayIso = utcMidnight(0).toISOString()
    const recs = (sl.records ?? []).slice().sort((a, b) => a.startTime.localeCompare(b.startTime))
    const spentToday = recs.find((r) => r.startTime === todayIso)?.totalAmount ?? 0
    const spent7d = recs.reduce((a, r) => a + r.totalAmount, 0)
    // network volume comes from the account-level storage line
    const acctTotals = 'metadata' in acct ? acct.metadata.totals : acct.totals
    return {
      spentToday,
      spent7d,
      dailySpends: recs.map((r) => r.totalAmount),
      days: recs.map((r) => ({ date: r.startTime.slice(0, 10), total: r.totalAmount })),
      networkVolumeMonthly: (acctTotals?.storageHighPerformanceAmount ?? 0) * (30 / 7),
    }
  })
}

export interface Limits {
  spendRatePerHour: number
  workerLimit: number
}
export async function getLimits(): Promise<Limits> {
  return cached('limits', 5 * 60_000, async () => {
    const r = await rpBilling<{ serverlessWorkers?: { limit: number }; spendRate?: { current: number } }>(
      '/v2/account/limits',
    )
    return { spendRatePerHour: r.spendRate?.current ?? 0, workerLimit: r.serverlessWorkers?.limit ?? 0 }
  })
}

export interface Health {
  jobs: { completed: number; failed: number; inProgress: number; inQueue: number; retried: number }
  workers: { idle: number; initializing: number; ready: number; running: number; throttled: number; unhealthy: number }
}
export async function getHealth(): Promise<Health> {
  return cached('health', 30_000, async () => {
    const base = config.runpodEndpoint.replace(/\/$/, '')
    const res = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${config.runpodApiKey}` } })
    if (!res.ok) throw new Error(`RunPod health -> HTTP ${res.status}`)
    return (await res.json()) as Health
  })
}

// Photos the worker finished digitizing in the trailing `days` days — the
// denominator for cost-per-photo.
export async function photosIngested(days: number): Promise<number> {
  const res = await query<{ c: string }>(
    `SELECT count(*) c FROM products WHERE ai_ingested_at >= now() - ($1 || ' days')::interval`,
    [String(days)],
  )
  return Number(res.rows[0]?.c ?? 0)
}
