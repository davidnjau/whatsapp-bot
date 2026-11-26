import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { listActiveCarts } from '../modules/shop/carts.js'
import {
  catalogueCounts,
  getProduct,
  importProductImage,
  listCatalogue,
  publishAllDrafts,
  publishProduct,
  scanInbox,
  setFeatured,
  setProductStatus,
  updateProduct,
  updateProductDetails,
  type CatalogueFilter,
  type CatalogueSince,
  type Product,
} from '../modules/shop/index.js'
import { getBool, getSetting, setSetting } from '../lib/settings.js'
import { dnCode, listConflicts, listOrders, markDropped, setOrderStatus } from '../modules/shop/orders.js'
import { addProductMedia, deleteProductMedia, listProductMedia } from '../modules/shop/catalogue.js'
import { createCoupon, listCoupons, setCouponActive } from '../modules/shop/coupons.js'
import { saveMedia } from '../modules/status/media.js'
import { ingestConfigured } from '../modules/shop/runpod.js'
import { enqueueIngest } from '../queue/index.js'
import { requireWebAuth } from './auth.js'

export const adminShopRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWebAuth)

  // --- catalogue ---
  const FILTERS: CatalogueFilter[] = ['all', 'needs_review', 'draft', 'published', 'sold']
  const SINCES: CatalogueSince[] = ['all', '1w', '2w', '3w', '4w', '1mo', 'older']
  const parseFilter = (q: unknown): CatalogueFilter =>
    FILTERS.includes(q as CatalogueFilter) ? (q as CatalogueFilter) : 'all'
  const parseSince = (q: unknown): CatalogueSince =>
    SINCES.includes(q as CatalogueSince) ? (q as CatalogueSince) : 'all'
  const PAGE_SIZE = 12

  async function renderCatalogue(
    reply: any,
    q: { filter: CatalogueFilter; search?: string; since?: CatalogueSince; page?: number },
    extra: Record<string, unknown>,
  ) {
    const page = Math.max(1, q.page ?? 1)
    const [{ rows, total }, counts, hideSold] = await Promise.all([
      listCatalogue({ ...q, page, pageSize: PAGE_SIZE }),
      catalogueCounts(),
      getBool('hide_sold'),
    ])
    return reply.view('catalogue.njk', {
      authed: true,
      products: rows,
      counts,
      filter: q.filter,
      search: q.search ?? '',
      since: q.since ?? 'all',
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
      hideSold,
      scan: null,
      message: null,
      ...extra,
    })
  }

  app.get<{ Querystring: { filter?: string; q?: string; since?: string; page?: string; message?: string } }>(
    '/admin/catalogue',
    async (req, reply) => {
      return renderCatalogue(
        reply,
        {
          filter: parseFilter(req.query.filter),
          search: typeof req.query.q === 'string' ? req.query.q : '',
          since: parseSince(req.query.since),
          page: Number(req.query.page) || 1,
        },
        { message: req.query.message ?? null },
      )
    },
  )

  // Toggle whether sold dresses show on the public shop.
  app.post('/admin/catalogue/hide-sold', async (_req, reply) => {
    const cur = await getBool('hide_sold')
    await setSetting('hide_sold', cur ? 'false' : 'true')
    return reply.redirect(
      `/admin/catalogue?message=${encodeURIComponent(`Sold dresses are now ${cur ? 'shown' : 'hidden'} on the shop`)}`,
    )
  })

  app.post('/admin/catalogue/scan', async (_req, reply) => {
    let scan
    try {
      scan = await scanInbox()
    } catch (err) {
      scan = { imported: [], skipped: 0, failed: [{ file: 'inbox', error: (err as Error).message }] }
    }
    return renderCatalogue(reply, { filter: 'all' }, { scan })
  })

  // Upload photos straight from the browser — each is OCR'd and added as a
  // draft, exactly like dropping into the inbox and scanning.
  app.post('/admin/catalogue/upload', async (req, reply) => {
    const imported: Product[] = []
    const failed: Array<{ file: string; error: string }> = []
    try {
      for await (const part of req.files()) {
        const name = part.filename || 'upload.jpg'
        if (!part.mimetype?.startsWith('image/')) {
          await part.toBuffer().catch(() => {})
          failed.push({ file: name, error: 'not an image' })
          continue
        }
        try {
          const buf = await part.toBuffer()
          imported.push(await importProductImage(name, part.mimetype, buf, null))
        } catch (err) {
          failed.push({ file: name, error: (err as Error).message })
        }
      }
    } catch (err) {
      failed.push({ file: 'upload', error: (err as Error).message })
    }
    return renderCatalogue(reply, { filter: 'all' }, { scan: { imported, skipped: 0, failed } })
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

  app.post<{ Params: { id: string }; Querystring: { filter?: string } }>(
    '/admin/catalogue/:id/featured',
    async (req, reply) => {
      const form = z.object({ featured: z.enum(['on', 'off']) }).parse(req.body ?? {})
      await setFeatured(Number(req.params.id), form.featured === 'on')
      return reply.redirect(`/admin/catalogue?filter=${parseFilter(req.query.filter)}&message=Fitting room updated`)
    },
  )

  // Queue an AI digitization run (dormant if the worker isn't configured).
  app.post<{ Params: { id: string } }>('/admin/catalogue/:id/ingest', async (req, reply) => {
    await enqueueIngest(Number(req.params.id))
    const msg = ingestConfigured()
      ? 'AI enrichment queued - the dress will update shortly, then review it.'
      : 'Queued, but the AI worker is not configured yet (set RUNPOD_ENDPOINT).'
    return reply.redirect(`/admin/catalogue?message=${encodeURIComponent(msg)}`)
  })

  // Full detail review/edit page (the AI-filled or hand-typed content).
  app.get<{ Params: { id: string } }>('/admin/catalogue/:id/edit', async (req, reply) => {
    const product = await getProduct(Number(req.params.id))
    if (!product) return reply.redirect('/admin/catalogue?message=Not found')
    return reply.view('catalogue_edit.njk', {
      authed: true,
      product,
      media: await listProductMedia(product.id),
      occasionsText: (product.occasions ?? []).join(', '),
      ingestConfigured: ingestConfigured(),
      message: (req.query as any)?.message ?? null,
    })
  })

  // Manually add photos/videos to a product's gallery. A "kind" field lets the
  // owner mark a photo as the model or mannequin shot so the fitting room shows
  // the right image; videos are always kind 'video'.
  app.post<{ Params: { id: string } }>('/admin/catalogue/:id/media/upload', async (req, reply) => {
    const productId = Number(req.params.id)
    let kind = 'photo'
    const files: Array<{ name: string; mime: string; buf: Buffer }> = []
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field' && part.fieldname === 'kind') {
          kind = String((part as { value: unknown }).value)
        } else if (part.type === 'file') {
          const mime = part.mimetype || ''
          if (mime.startsWith('image/') || mime.startsWith('video/')) {
            files.push({ name: part.filename || 'upload', mime, buf: await part.toBuffer() })
          } else {
            await part.toBuffer().catch(() => {})
          }
        }
      }
    } catch {
      /* ignore partial upload errors; save what landed */
    }
    const photoKind = ['model', 'mannequin'].includes(kind) ? kind : 'photo'
    for (const f of files) {
      const media = await saveMedia(f.name, f.mime, f.buf)
      await addProductMedia(productId, media.id, f.mime.startsWith('video/') ? 'video' : photoKind)
    }
    return reply.redirect(`/admin/catalogue/${productId}/edit?message=${encodeURIComponent(`Added ${files.length} file(s)`)}`)
  })

  // Delete one gallery item.
  app.post<{ Params: { id: string; rowId: string } }>(
    '/admin/catalogue/:id/media/:rowId/delete',
    async (req, reply) => {
      await deleteProductMedia(Number(req.params.id), Number(req.params.rowId))
      return reply.redirect(`/admin/catalogue/${req.params.id}/edit?message=Photo removed`)
    },
  )

  app.post<{ Params: { id: string } }>('/admin/catalogue/:id/details', async (req, reply) => {
    const form = z
      .object({
        title: z.string().default(''),
        size: z.string().default(''),
        price: z.string().default(''),
        fabric: z.string().default(''),
        colour: z.string().default(''),
        length_desc: z.string().default(''),
        short_desc: z.string().default(''),
        long_desc: z.string().default(''),
        social_caption: z.string().default(''),
        occasions: z.string().default(''),
        silhouette: z.string().default(''),
        stretch_level: z.string().default(''),
        fit_notes: z.string().default(''),
      })
      .parse(req.body ?? {})
    const price = form.price ? Number.parseInt(form.price.replace(/[^\d]/g, ''), 10) : NaN
    const clean = (s: string) => s.trim() || null
    const occasions = form.occasions.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    await updateProductDetails(Number(req.params.id), {
      title: clean(form.title),
      size: clean(form.size),
      price_ksh: Number.isFinite(price) && price > 0 ? price : null,
      fabric: clean(form.fabric),
      colour: clean(form.colour),
      length_desc: clean(form.length_desc),
      short_desc: clean(form.short_desc),
      long_desc: clean(form.long_desc),
      social_caption: clean(form.social_caption),
      occasions: occasions.length ? occasions : null,
      silhouette: clean(form.silhouette),
      stretch_level: clean(form.stretch_level),
      fit_notes: clean(form.fit_notes),
    })
    return reply.redirect(`/admin/catalogue/${req.params.id}/edit?message=Saved`)
  })

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

  // --- coupons ---
  app.get<{ Querystring: { message?: string } }>('/admin/coupons', async (req, reply) => {
    const [coupons, loyaltyN, loyaltyPercent] = await Promise.all([
      listCoupons(),
      getSetting('loyalty_n', '3'),
      getSetting('loyalty_percent', '10'),
    ])
    return reply.view('coupons.njk', {
      authed: true,
      coupons,
      loyaltyN,
      loyaltyPercent,
      message: req.query.message ?? null,
    })
  })

  // Loyalty rule: a coupon after every N paid orders, at a set %.
  app.post('/admin/loyalty', async (req, reply) => {
    const form = z
      .object({ n: z.coerce.number().int().min(1).max(50), percent: z.coerce.number().int().min(1).max(100) })
      .safeParse(req.body ?? {})
    if (!form.success) return reply.redirect('/admin/coupons?message=Enter a valid N and percent')
    await setSetting('loyalty_n', String(form.data.n))
    await setSetting('loyalty_percent', String(form.data.percent))
    return reply.redirect('/admin/coupons?message=Loyalty rule saved')
  })

  app.post('/admin/coupons', async (req, reply) => {
    const form = z
      .object({
        code: z.string().min(2),
        percent: z.coerce.number().int().min(1).max(100),
        expires: z.string().default(''),
        maxUses: z.string().default(''),
      })
      .safeParse(req.body ?? {})
    if (!form.success) return reply.redirect('/admin/coupons?message=Enter a code and a percent (1-100)')
    const expiresAt = form.data.expires ? new Date(form.data.expires) : null
    const maxUses = form.data.maxUses ? Number.parseInt(form.data.maxUses, 10) : null
    await createCoupon(form.data.code, form.data.percent, Number.isNaN(expiresAt?.getTime()) ? null : expiresAt, maxUses)
    return reply.redirect('/admin/coupons?message=Coupon saved')
  })

  app.post<{ Params: { id: string }; Body: { active?: string } }>('/admin/coupons/:id/toggle', async (req, reply) => {
    const active = z.object({ active: z.enum(['on', 'off']) }).parse(req.body ?? {}).active === 'on'
    await setCouponActive(Number(req.params.id), active)
    return reply.redirect('/admin/coupons?message=Updated')
  })

  // --- carts (what people have added) ---
  app.get('/admin/carts', async (_req, reply) => {
    return reply.view('carts.njk', { authed: true, carts: await listActiveCarts() })
  })

  // --- orders dashboard ---
  app.get('/admin/orders', async (req, reply) => {
    const [orders, conflicts] = await Promise.all([listOrders(), listConflicts()])
    // Annotate each item with the OTHER orders claiming the same dress.
    const view = orders.map((o) => ({
      ...o,
      dn: dnCode(o.id),
      items: o.items.map((i) => ({
        ...i,
        conflict_orders: (conflicts[i.product_id] ?? []).filter((c) => c.id !== o.id),
      })),
    }))
    return reply.view('orders.njk', {
      authed: true,
      orders: view,
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
