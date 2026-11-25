import path from 'node:path'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import fastifyFormbody from '@fastify/formbody'
import fastifyMultipart from '@fastify/multipart'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import fastifyView from '@fastify/view'
import nunjucks from 'nunjucks'
import { config } from './config.js'
import { query } from './db.js'
import { waha } from './waha/client.js'
import { webhookRoutes } from './webhooks/routes.js'
import { adminRoutes } from './admin/routes.js'
import { adminSupportRoutes } from './admin/support.js'
import { adminNotifyRoutes } from './admin/notify.js'
import { adminGroupRoutes } from './admin/groups.js'
import { adminStatusRoutes } from './admin/status.js'
import { adminShopRoutes } from './admin/shop.js'
import { shopRoutes } from './modules/shop/routes.js'
import { notifyRoutes } from './modules/notify/routes.js'

export function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: true,
  })

  app.register(fastifyCookie, { secret: config.sessionSecret })
  app.register(fastifyFormbody)
  app.register(fastifyMultipart, { limits: { fileSize: 64 * 1024 * 1024, files: 50 } })
  // global: false — limits are opted into per route (login, /notify, /health).
  // The WAHA webhook is exempt: it's HMAC-verified and legitimately bursty.
  app.register(fastifyRateLimit, { global: false })
  app.register(fastifyStatic, { root: path.resolve('static'), prefix: '/static/' })
  app.register(fastifyView, {
    engine: { nunjucks },
    root: path.resolve('views'),
    options: {
      onConfigure: (env: { addFilter: (name: string, fn: (v: unknown) => string) => void }) => {
        env.addFilter('date', (v) => {
          if (!v) return ''
          const d = new Date(v as string)
          return isNaN(d.getTime())
            ? String(v)
            : d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
        })
      },
    },
  })

  app.register(webhookRoutes)
  app.register(adminRoutes)
  app.register(adminSupportRoutes)
  app.register(adminNotifyRoutes)
  app.register(adminGroupRoutes)
  app.register(adminStatusRoutes)
  app.register(adminShopRoutes)
  app.register(shopRoutes)
  app.register(notifyRoutes)

  app.get('/health', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async () => {
    await query('SELECT 1')
    let wahaStatus = 'unknown'
    try {
      const session = await waha.getSession()
      wahaStatus = session?.status ?? 'MISSING'
    } catch {
      wahaStatus = 'WAHA_UNREACHABLE'
    }
    return { status: 'ok', waha: wahaStatus }
  })

  app.get('/', async (_req, reply) => reply.redirect('/admin'))

  return app
}
