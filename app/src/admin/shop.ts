import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { listActiveCarts } from '../modules/shop/carts.js'
import {
  catalogueCounts,
  getProduct,
  listCatalogue,
  publishAllDrafts,
  publishProduct,
  scanInbox,
  setProductStatus,
  updateProduct,
  type CatalogueFilter,
} from '../modules/shop/index.js'
import { listOrders, markDropped, setOrderStatus } from '../modules/shop/orders.js'
import { requireWebAuth } from './auth.js'

export const adminShopRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWebAuth)

  // --- catalogue ---
  const FILTERS: CatalogueFilter[] = ['all', 'needs_review', 'draft', 'published', 'sold']
  const parseFilter = (q: unknown): CatalogueFilter =>
    FILTERS.includes(q as CatalogueFilter) ? (q as CatalogueFilter) : 'all'

  async function renderCatalogue(reply: any, filter: CatalogueFilter, extra: Record<string, unknown>) {
    const [products, counts] = await Promise.all([listCatalogue(filter), catalogueCounts()])
    return reply.view('catalogue.njk', {
      authed: true,
      products,
      counts,
      filter,
      scan: null,
      message: null,
      ...extra,
    })
  }

  app.get<{ Querystring: { filter?: string; message?: string } }>('/admin/catalogue', async (req, reply) => {
    return renderCatalogue(reply, parseFilter(req.query.filter), { message: req.query.message ?? null })
  })

  app.post('/admin/catalogue/scan', async (_req, reply) => {
    let scan
    try {
      scan = await scanInbox()
    } catch (err) {
      scan = { imported: [], skipped: 0, failed: [{ file: 'inbox', error: (err as Error).message }] }
    }
    return renderCatalogue(reply, 'all', { scan })
  })

  app.post('/admin/catalogue/publish-all', async (_req, reply) => {
    const { published, skipped } = await publishAllDrafts()
    const message =
      `Published ${published} dress(es) to Status + shop.` +
      (skipped ? ` ${skipped} still need a size/price (review them first).` : '')
    return reply.redirect(`/admin/catalogue?message=${encodeURIComponent(message)}`)
  })

  app.post<{ Params: { id: string }; Querystring: { filter?: string } }>(
    '/admin/catalogue/:id',
    async (req, reply) => {
      const form = z
        .object({ title: z.string().default(''), size: z.string().default(''), price: z.string().default('') })
        .parse(req.body ?? {})
      const price = form.price ? Number.parseInt(form.price.replace(/[^\d]/g, ''), 10) : NaN
      await updateProduct(Number(req.params.id), {
        title: form.title.trim() || null,
        size: form.size.trim() || null,
        price_ksh: Number.isFinite(price) && price > 0 ? price : null,
      })
      return reply.redirect(`/admin/catalogue?filter=${parseFilter(req.query.filter)}&message=Saved`)
    },
  )

  app.post<{ Params: { id: string } }>('/admin/catalogue/:id/publish', async (req, reply) => {
    try {
      await publishProduct(Number(req.params.id))
      return reply.redirect('/admin/catalogue?message=Published - status posted and live in the shop')
    } catch (err) {
      return reply.redirect(`/admin/catalogue?message=${encodeURIComponent((err as Error).message)}`)
    }
  })

  app.post<{ Params: { id: string; status: string } }>(
    '/admin/catalogue/:id/status/:status',
    async (req, reply) => {
      const status = z.enum(['draft', 'published', 'sold', 'archived']).parse(req.params.status)
      const product = await getProduct(Number(req.params.id))
      if (product) await setProductStatus(product.id, status)
      return reply.redirect('/admin/catalogue?message=Updated')
    },
  )

  // --- carts (what people have added) ---
  app.get('/admin/carts', async (_req, reply) => {
    return reply.view('carts.njk', { authed: true, carts: await listActiveCarts() })
  })

  // --- orders dashboard ---
  app.get('/admin/orders', async (req, reply) => {
    return reply.view('orders.njk', {
      authed: true,
      orders: await listOrders(),
      message: (req.query as any)?.message ?? null,
    })
  })

  app.post<{ Params: { id: string } }>('/admin/orders/:id/packed', async (req, reply) => {
    await setOrderStatus(Number(req.params.id), 'packed')
    return reply.redirect('/admin/orders?message=Marked packed')
  })

  app.post<{ Params: { id: string } }>('/admin/orders/:id/dropped', async (req, reply) => {
    const form = z.object({ packageCode: z.string().min(2) }).safeParse(req.body ?? {})
    if (!form.success) return reply.redirect('/admin/orders?message=Package code required')
    await markDropped(Number(req.params.id), form.data.packageCode.trim())
    return reply.redirect('/admin/orders?message=Marked dropped - customer sent the package code')
  })

  app.post<{ Params: { id: string } }>('/admin/orders/:id/collected', async (req, reply) => {
    await setOrderStatus(Number(req.params.id), 'collected')
    return reply.redirect('/admin/orders?message=Marked collected')
  })

  app.post<{ Params: { id: string } }>('/admin/orders/:id/cancel', async (req, reply) => {
    await setOrderStatus(Number(req.params.id), 'cancelled')
    return reply.redirect('/admin/orders?message=Cancelled - dresses returned to the catalogue')
  })
}
