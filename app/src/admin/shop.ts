import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { countAbandonedCarts, listActiveCarts, messageCartCustomer } from '../modules/shop/carts.js'
import {
  catalogueCounts,
  getProduct,
  importProductImage,
  listAwaitingEnrichment,
  listCatalogue,
  markEnrichQueued,
  setAiSkipped,
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
import {
  dnCode,
  getOrder,
  listConflicts,
  listOrdersPage,
  markDropped,
  messageCustomer,
  orderCounts,
  orderItems,
  orderMessages,
  ORDER_GROUPS,
  setOrderNotes,
  setOrderStatus,
  statusIndex,
  type Order,
  type OrderGroup,
} from '../modules/shop/orders.js'
import { productName } from '../modules/shop/label.js'
import { toChatId } from '../lib/phone.js'
import { addProductMedia, deleteProductMedia, listProductMedia } from '../modules/shop/catalogue.js'
import { createCoupon, defaultCouponExpiry, deleteCoupon, listCoupons, setCouponActive } from '../modules/shop/coupons.js'
import { saveMedia } from '../modules/status/media.js'
import { ingestConfigured } from '../modules/shop/runpod.js'
import { enqueueIngest } from '../queue/index.js'
import type { IngestMode } from '../modules/shop/ingest.js'
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
    const [{ rows, total }, counts, hideSold, awaiting] = await Promise.all([
      listCatalogue({ ...q, page, pageSize: PAGE_SIZE }),
      catalogueCounts(),
      getBool('hide_sold'),
      listAwaitingEnrichment(),
    ])
    return reply.view('catalogue.njk', {
      authed: true,
      products: rows,
      counts,
      awaiting,
      enrichingCount: awaiting.filter((a) => a.enriching).length,
      ingestConfigured: ingestConfigured(),
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
    const id = Number(req.params.id)
    await setAiSkipped(id, false) // re-including a skipped one
    await markEnrichQueued([id])
    await enqueueIngest(id)
    const msg = ingestConfigured()
      ? 'AI enrichment queued - the dress will update shortly, then review it.'
      : 'Queued, but the AI worker is not configured yet (set RUNPOD_ENDPOINT).'
    return reply.redirect(`/admin/catalogue?message=${encodeURIComponent(msg)}`)
  })

  // Enrich a selected batch of recent uploads (checkboxes from the panel).
  app.post<{ Body: { ids?: string | string[]; mode?: string } }>('/admin/catalogue/enrich-batch', async (req, reply) => {
    const raw = req.body?.ids
    const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    const mode: IngestMode = req.body?.mode === 'images' || req.body?.mode === 'text' ? req.body.mode : 'both'
    await markEnrichQueued(ids)
    for (const id of ids) {
      await setAiSkipped(id, false)
      await enqueueIngest(id, mode)
    }
    const msg = !ids.length
      ? 'Pick at least one photo to enrich.'
      : ingestConfigured()
        ? `AI enrichment queued for ${ids.length} photo(s) — they'll update shortly, then review them.`
        : `Queued ${ids.length}, but the AI worker is not configured yet (set RUNPOD_ENDPOINT).`
    return reply.redirect(`/admin/catalogue?message=${encodeURIComponent(msg)}`)
  })

  // Exclude one upload from AI enrichment (stays a hand-editable draft).
  app.post<{ Params: { id: string } }>('/admin/catalogue/:id/skip-ai', async (req, reply) => {
    await setAiSkipped(Number(req.params.id), true)
    return reply.redirect('/admin/catalogue?message=Excluded from AI enrichment')
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
    const [rawCoupons, loyaltyN, loyaltyPercent, couponDays] = await Promise.all([
      listCoupons(),
      getSetting('loyalty_n', '3'),
      getSetting('loyalty_percent', '10'),
      getSetting('coupon_default_days', '7'),
    ])
    const now = Date.now()
    const coupons = rawCoupons.map((c) => {
      let status: 'active' | 'paused' | 'expired' | 'used_up' = 'active'
      if (c.expires_at && new Date(c.expires_at).getTime() < now) status = 'expired'
      else if (c.max_uses && c.used_count >= c.max_uses) status = 'used_up'
      else if (!c.active) status = 'paused'
      return { ...c, _status: status }
    })
    return reply.view('coupons.njk', {
      authed: true,
      coupons,
      loyaltyN,
      loyaltyPercent,
      couponDays,
      message: req.query.message ?? null,
    })
  })

  // Loyalty rule + default coupon lifetime.
  app.post('/admin/loyalty', async (req, reply) => {
    const form = z
      .object({
        n: z.coerce.number().int().min(1).max(50),
        percent: z.coerce.number().int().min(1).max(100),
        couponDays: z.coerce.number().int().min(1).max(365),
      })
      .safeParse(req.body ?? {})
    if (!form.success) return reply.redirect('/admin/coupons?message=Enter valid values')
    await setSetting('loyalty_n', String(form.data.n))
    await setSetting('loyalty_percent', String(form.data.percent))
    await setSetting('coupon_default_days', String(form.data.couponDays))
    return reply.redirect('/admin/coupons?message=Settings saved')
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
    // Empty expiry → use the admin's default lifetime (default 7 days).
    const explicit = form.data.expires ? new Date(form.data.expires) : null
    const expiresAt = explicit && !Number.isNaN(explicit.getTime()) ? explicit : await defaultCouponExpiry()
    const maxUses = form.data.maxUses ? Number.parseInt(form.data.maxUses, 10) : null
    await createCoupon(form.data.code, form.data.percent, expiresAt, maxUses)
    return reply.redirect('/admin/coupons?message=Coupon saved')
  })

  app.post<{ Params: { id: string }; Body: { active?: string } }>('/admin/coupons/:id/toggle', async (req, reply) => {
    const active = z.object({ active: z.enum(['on', 'off']) }).parse(req.body ?? {}).active === 'on'
    await setCouponActive(Number(req.params.id), active)
    return reply.redirect('/admin/coupons?message=Updated')
  })

  app.post<{ Params: { id: string } }>('/admin/coupons/:id/delete', async (req, reply) => {
    await deleteCoupon(Number(req.params.id))
    return reply.redirect('/admin/coupons?message=Coupon deleted')
  })

  // --- carts (abandoned — added but never ordered) ---
  app.get<{ Querystring: { message?: string } }>('/admin/carts', async (req, reply) => {
    return reply.view('carts.njk', {
      authed: true,
      carts: await listActiveCarts(),
      message: req.query.message ?? null,
    })
  })

  app.post<{ Params: { cartId: string }; Body: { body?: string } }>('/admin/carts/:cartId/message', async (req, reply) => {
    const form = z.object({ body: z.string().min(1) }).safeParse(req.body ?? {})
    if (!form.success) return reply.redirect('/admin/carts?message=Message was empty')
    const res = await messageCartCustomer(req.params.cartId, form.data.body)
    return reply.redirect(`/admin/carts?message=${encodeURIComponent(res.ok ? 'Message sent' : res.reason)}`)
  })

  // Redirect back to wherever the action came from (list with filters, or detail).
  const backTo = (ret: unknown, msg: string): string => {
    const base = typeof ret === 'string' && ret.startsWith('/admin/orders') ? ret : '/admin/orders'
    return `${base}${base.includes('?') ? '&' : '?'}message=${encodeURIComponent(msg)}`
  }

  // --- orders dashboard (filter chips, search, date range, pagination) ---
  app.get<{ Querystring: { status?: string; q?: string; since?: string; page?: string; message?: string } }>(
    '/admin/orders',
    async (req, reply) => {
      const group: OrderGroup = (ORDER_GROUPS as readonly string[]).includes(req.query.status ?? '')
        ? (req.query.status as OrderGroup)
        : 'not_handled' // work queue is the default view
      const q = req.query.q ?? ''
      const since = req.query.since ?? 'all'
      const page = Number(req.query.page) || 1
      const [{ rows, total, page: cur, totalPages }, counts, conflicts, abandoned] = await Promise.all([
        listOrdersPage({ group, q, since, page }),
        orderCounts(q, since),
        listConflicts(),
        countAbandonedCarts(),
      ])
      const nbiDay = (d: Date | string) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(d))
      const view = rows.map((o) => ({
        ...o,
        dn: dnCode(o.id),
        paid_same_day: o.paid_at ? nbiDay(o.created_at) === nbiDay(o.paid_at) : false,
        items: o.items.map((i) => ({
          ...i,
          conflict_orders: (conflicts[i.product_id] ?? []).filter((c) => c.id !== o.id),
        })),
      }))
      return reply.view('orders.njk', {
        authed: true,
        orders: view,
        counts,
        abandoned,
        group,
        search: q,
        since,
        page: cur,
        totalPages,
        total,
        message: req.query.message ?? null,
      })
    },
  )

  // --- single order detail ---
  app.get<{ Params: { id: string }; Querystring: { back?: string; message?: string } }>(
    '/admin/orders/:id',
    async (req, reply) => {
      const id = Number(req.params.id)
      const order = await getOrder(id)
      if (!order) return reply.callNotFound()
      const [items, messages, conflicts] = await Promise.all([
        orderItems(id),
        orderMessages(id),
        listConflicts(),
      ])
      const first = items[0]
      const dress = first ? productName({ id: first.product_id, title: first.title, size: first.size, price_ksh: first.price_ksh }) : `order ${dnCode(id)}`
      const name = order.customer_name
      const code = order.package_code ?? '{code}'
      const quick = [
        { label: 'Packed', text: `Hi ${name}, your ${dress} (size ${first?.size ?? '?'}) is packed and will be dispatched today.` },
        { label: 'Dropped', text: `Hi ${name}, your order ${dnCode(id)} has been dropped at ${order.delivery_location}. Package code: ${code}.` },
        { label: 'Delay', text: `Hi ${name}, there's a small delay on order ${dnCode(id)}. We'll update you shortly.` },
      ]
      // Timeline steps with their timestamps (cancelled replaces the tail).
      const steps = order.status === 'cancelled'
        ? [
            { label: 'Ordered', at: order.created_at, done: true },
            { label: 'Paid', at: order.paid_at, done: !!order.paid_at },
            { label: 'Cancelled', at: order.cancelled_at, done: true },
          ]
        : [
            { label: 'Ordered', at: order.created_at, done: true },
            { label: 'Paid', at: order.paid_at, done: !!order.paid_at },
            { label: 'Packed', at: order.packed_at, done: !!order.packed_at },
            { label: 'Dropped', at: order.dropped_at, done: !!order.dropped_at },
          ]
      const back = typeof req.query.back === 'string' ? req.query.back : ''
      const wa = toChatId(order.phone)
      return reply.view('order_detail.njk', {
        authed: true,
        o: { ...order, dn: dnCode(id), wa: wa ? wa.replace('@c.us', '') : '' },
        items: items.map((i) => ({ ...i, conflict_orders: (conflicts[i.product_id] ?? []).filter((c) => c.id !== id) })),
        messages,
        quick,
        steps,
        tracker: statusIndex(order.status),
        back,
        ret: `/admin/orders/${id}${back ? '?back=' + encodeURIComponent(back) : ''}`,
        message: req.query.message ?? null,
      })
    },
  )

  app.post<{ Params: { id: string }; Body: { ret?: string; notify?: string } }>(
    '/admin/orders/:id/packed',
    async (req, reply) => {
      const id = Number(req.params.id)
      await setOrderStatus(id, 'packed')
      if (req.body?.notify) {
        const order = await getOrder(id)
        const items = await orderItems(id)
        const first = items[0]
        if (order) {
          const dress = first ? productName({ id: first.product_id, title: first.title, size: first.size, price_ksh: first.price_ksh }) : `order ${dnCode(id)}`
          await messageCustomer(id, `Hi ${order.customer_name}, your ${dress} (size ${first?.size ?? '?'}) is packed and will be dispatched today.`)
        }
      }
      return reply.redirect(backTo(req.body?.ret, 'Marked packed'))
    },
  )

  app.post<{ Params: { id: string }; Body: { packageCode?: string; ret?: string } }>(
    '/admin/orders/:id/dropped',
    async (req, reply) => {
      const form = z.object({ packageCode: z.string().min(2) }).safeParse(req.body ?? {})
      if (!form.success) return reply.redirect(backTo(req.body?.ret, 'Package code required'))
      await markDropped(Number(req.params.id), form.data.packageCode.trim())
      return reply.redirect(backTo(req.body?.ret, 'Marked dropped — customer notified'))
    },
  )

  app.post<{ Params: { id: string }; Body: { ret?: string } }>('/admin/orders/:id/collected', async (req, reply) => {
    await setOrderStatus(Number(req.params.id), 'collected')
    return reply.redirect(backTo(req.body?.ret, 'Marked collected'))
  })

  app.post<{ Params: { id: string }; Body: { ret?: string } }>('/admin/orders/:id/cancel', async (req, reply) => {
    await setOrderStatus(Number(req.params.id), 'cancelled')
    return reply.redirect(backTo(req.body?.ret, 'Cancelled — dresses returned to the catalogue'))
  })

  app.post<{ Params: { id: string }; Body: { body?: string; ret?: string } }>(
    '/admin/orders/:id/message',
    async (req, reply) => {
      const form = z.object({ body: z.string().min(1), ret: z.string().optional() }).safeParse(req.body ?? {})
      if (!form.success) return reply.redirect(backTo(req.body?.ret, 'Message was empty'))
      const res = await messageCustomer(Number(req.params.id), form.data.body)
      return reply.redirect(backTo(req.body?.ret, res.ok ? 'Message sent' : res.reason))
    },
  )

  app.post<{ Params: { id: string }; Body: { notes?: string; ret?: string } }>(
    '/admin/orders/:id/notes',
    async (req, reply) => {
      await setOrderNotes(Number(req.params.id), req.body?.notes ?? '')
      return reply.redirect(backTo(req.body?.ret, 'Notes saved'))
    },
  )
}
