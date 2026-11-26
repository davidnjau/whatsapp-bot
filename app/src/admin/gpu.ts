import type { FastifyPluginAsync } from 'fastify'
import { getSetting, setSetting } from '../lib/settings.js'
import {
  billingConfigured,
  bustBillingCache,
  getBalance,
  getHealth,
  getLimits,
  getUsage,
  photosIngested,
} from '../modules/gpu/billing.js'
import { getFx } from '../modules/gpu/fx.js'
import { computeRunway, failureRate } from '../modules/gpu/logic.js'
import { requireWebAuth } from './auth.js'

const usd = (n: number | null | undefined): string => (n == null ? '—' : `$${n.toFixed(2)}`)
const kes = (n: number | null | undefined): string =>
  n == null ? '—' : `KES ${Math.round(n).toLocaleString('en-KE')}`

// Tolerant fetch: one dead RunPod call shouldn't blank the whole dashboard.
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

export const adminGpuRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWebAuth)

  app.get<{ Querystring: { message?: string } }>('/admin/gpu', async (req, reply) => {
    const configured = billingConfigured()
    const [balance, usage, limits, health, fx, photos7d] = await Promise.all([
      configured ? safe(getBalance) : Promise.resolve(null),
      configured ? safe(getUsage) : Promise.resolve(null),
      configured ? safe(getLimits) : Promise.resolve(null),
      safe(getHealth),
      getFx(),
      safe(() => photosIngested(7)),
    ])

    const warnDays = Number(await getSetting('runway_warn_days', '5'))
    const warnBalance = Number(await getSetting('balance_warn_usd', '10'))
    const manualRate = await getSetting('fx_manual_rate', '')

    const runway =
      balance && usage ? computeRunway(balance.usd, usage.dailySpends, limits?.spendRatePerHour ?? 0) : null
    let runoutDate: string | null = null
    if (runway?.daysLeft != null && Number.isFinite(runway.daysLeft)) {
      const d = new Date(Date.now() + runway.daysLeft * 86_400_000)
      runoutDate = d.toISOString().slice(0, 10)
    }
    const kesVal = balance && fx.rate ? balance.usd * fx.rate : null
    const costPerPhoto = usage && photos7d ? usage.spent7d / photos7d : null

    const lowRunway = runway?.daysLeft != null && runway.daysLeft < warnDays
    const lowBalance = balance != null && balance.usd < warnBalance
    const healthFailRate = health ? failureRate(health.jobs.completed, health.jobs.failed) : 0

    // Daily bar chart heights (0–100%) relative to the busiest day.
    const maxDay = usage ? Math.max(0.0001, ...usage.days.map((d) => d.total)) : 1
    const chart = (usage?.days ?? []).map((d) => ({
      date: d.date.slice(5),
      pct: Math.round((d.total / maxDay) * 100),
      label: usd(d.total),
    }))

    return reply.view('gpu.njk', {
      authed: true,
      configured,
      balance,
      usage,
      limits,
      health,
      fx,
      runway,
      runoutDate,
      photos7d,
      chart,
      lowRunway,
      lowBalance,
      warnDays,
      warnBalance,
      manualRate,
      healthFailRatePct: Math.round(healthFailRate * 100),
      f: {
        balanceUsd: usd(balance?.usd),
        balanceKes: kes(kesVal),
        spentToday: usd(usage?.spentToday),
        spent7d: usd(usage?.spent7d),
        costPerPhoto: costPerPhoto == null ? '—' : usd(costPerPhoto),
        networkMonthly: usd(usage?.networkVolumeMonthly),
        avgDaily: usd(runway?.avgDailyUsd),
        rate: fx.rate ? fx.rate.toFixed(2) : '—',
      },
      message: req.query.message ?? null,
    })
  })

  app.post('/admin/gpu/refresh', async (_req, reply) => {
    bustBillingCache()
    await safe(() => getFx(true))
    return reply.redirect('/admin/gpu?message=Refreshed')
  })

  app.post<{ Body: { runway_warn_days?: string; balance_warn_usd?: string; fx_manual_rate?: string } }>(
    '/admin/gpu/settings',
    async (req, reply) => {
      const b = req.body ?? {}
      if (b.runway_warn_days) await setSetting('runway_warn_days', String(Number(b.runway_warn_days) || 5))
      if (b.balance_warn_usd) await setSetting('balance_warn_usd', String(Number(b.balance_warn_usd) || 10))
      await setSetting('fx_manual_rate', String(Number(b.fx_manual_rate) || '') || '')
      return reply.redirect('/admin/gpu?message=Settings saved')
    },
  )
}
