import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { readMediaContent } from '../status/media.js'
import { addToCart, cartCount, cartExists, cartProducts, createCart, removeFromCart } from './carts.js'
import { getProduct, type Product } from './index.js'
import { isHeldByOther, listAvailable, reserveProduct } from './reservations.js'
import {
  createOrder,
  createShopOrder,
  dnCode,
  getOrder,
  orderItems,
  payOrder,
  statusIndex,
} from './orders.js'
import { formatKsh, productName } from './label.js'
import { brand } from './brand.js'
import { getCatalogue, getDress } from './catalogue.js'
import { fitAdvice, stylingAdvice } from './advisor.js'

const CART_COOKIE = 'cart_id'

async function getCartId(req: FastifyRequest): Promise<string | null> {
  const cookie = req.cookies[CART_COOKIE]
  if (!cookie) return null
  const { valid, value } = req.unsignCookie(cookie)
  if (!valid || !value) return null
  return (await cartExists(value)) ? value : null
}

async function ensureCartId(req: FastifyRequest, reply: FastifyReply): Promise<string> {
  const existing = await getCartId(req)
  if (existing) return existing
  const cartId = await createCart()
  reply.setCookie(CART_COOKIE, cartId, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    path: '/',
    maxAge: 30 * 24 * 3600,
  })
  return cartId
}

// Every shop view gets the brand strings.
function shopView(reply: FastifyReply, template: string, data: Record<string, unknown>) {
  return reply.view(template, { brand, ...data })
}

// Attach a display-formatted price + title to a product for the templates.
function decorate(p: Product) {
  return { ...p, name: productName(p), priceFmt: formatKsh(p.price_ksh ?? 0) }
}

// Dress sizes present in the catalogue (splitting "8/10" into 8 and 10).
function sizesOf(products: Product[]): string[] {
  const set = new Set<string>()
  for (const p of products) {
    for (const s of (p.size ?? '').split('/')) {
      const t = s.trim()
      if (/^\d{1,2}$/.test(t)) set.add(t)
    }
  }
  return [...set].sort((a, b) => Number(a) - Number(b))
}

function matchesSize(p: Product, size: string): boolean {
  if (size === 'All') return true
  return (p.size ?? '').split('/').map((s) => s.trim()).includes(size)
}

const POST_LIMIT = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }

export const shopRoutes: FastifyPluginAsync = async (app) => {
  // The shop is a single-page app (ported reference design); it loads the
  // catalogue from /shop/api/catalogue and handles its own hash routes.
  app.get('/shop', async (_req, reply) => {
    return reply.view('shop_app.njk', { wa: brand.whatsapp })
  })

  app.get<{ Params: { id: string } }>('/shop/p/:id', async (req, reply) => {
    const product = await getProduct(Number(req.params.id))
    const cartId = await getCartId(req)
    const count = cartId ? await cartCount(cartId) : 0
    // Drafts/archived dresses aren't public — show a friendly page, not JSON 404.
    if (!product || (product.status !== 'published' && product.status !== 'sold')) {
      return reply.code(404).view('shop_notfound.njk', { brand, cartCount: count })
    }
    const heldByOther = isHeldByOther(product, cartId ?? '')
    return shopView(reply, 'shop_product.njk', { product: decorate(product), cartCount: count, heldByOther })
  })

  // JSON catalogue for the shop front-end (dresses in the reference shape).
  app.get('/shop/api/catalogue', async (_req, reply) => {
    return reply.header('Cache-Control', 'no-store').send({ dresses: await getCatalogue() })
  })

  // A single dress (detail view / direct load).
  app.get<{ Params: { id: string } }>('/shop/api/dress/:id', async (req, reply) => {
    const dress = await getDress(Number(req.params.id))
    if (!dress) return reply.code(404).send({ error: 'not found' })
    return reply.send(dress)
  })

  // --- shop SPA cart + orders (real reservations / orders / WhatsApp) ---

  // Current bag: product ids still held by this browser's cart (holds extended).
  app.get('/shop/api/cart', async (req, reply) => {
    const cartId = await getCartId(req)
    const items = cartId ? await cartProducts(cartId) : []
    if (cartId) await Promise.all(items.map((p) => reserveProduct(p.id, cartId)))
    return reply.header('Cache-Control', 'no-store').send({ ids: items.map((p) => Number(p.id)) })
  })

  app.post('/shop/api/cart/add', POST_LIMIT, async (req, reply) => {
    const { productId } = z.object({ productId: z.coerce.number() }).parse(req.body ?? {})
    const product = await getProduct(productId)
    if (product?.status !== 'published') return reply.send({ ok: false, taken: true, ids: [] })
    const cartId = await ensureCartId(req, reply)
    const held = await addToCart(cartId, productId)
    const ids = (await cartProducts(cartId)).map((p) => Number(p.id))
    return reply.send({ ok: held, taken: !held, ids })
  })

  app.post('/shop/api/cart/remove', POST_LIMIT, async (req, reply) => {
    const { productId } = z.object({ productId: z.coerce.number() }).parse(req.body ?? {})
    const cartId = await getCartId(req)
    if (cartId) await removeFromCart(cartId, productId)
    const ids = cartId ? (await cartProducts(cartId)).map((p) => Number(p.id)) : []
    return reply.send({ ids })
  })

  // Place + pay for an order (payment simulated; marks dresses sold and sends
  // the WhatsApp confirmation via the existing order pipeline).
  app.post('/shop/api/order', POST_LIMIT, async (req, reply) => {
    const form = z
      .object({
        name: z.string().min(2),
        phone: z.string().min(9),
        del: z.enum(['pickup', 'nairobi', 'country']),
        area: z.string().default(''),
        method: z.enum(['stk', 'till']).default('stk'),
      })
      .safeParse(req.body ?? {})
    if (!form.success) return reply.send({ error: 'Please check your details and try again.' })
    const cartId = await getCartId(req)
    if (!cartId) return reply.send({ error: 'Your bag is empty.' })
    let order
    try {
      order = await createShopOrder(cartId, form.data)
    } catch (err) {
      return reply.send({ error: (err as Error).message })
    }
    const result = await payOrder(order.id, order.access_token, cartId)
    if (!result.ok) return reply.send({ error: result.reason })
    const items = await orderItems(result.order.id)
    return reply.send({
      order: {
        id: result.order.id,
        token: result.order.access_token,
        dn: dnCode(result.order.id),
        status: statusIndex(result.order.status),
        total: result.order.total_ksh,
        name: result.order.customer_name,
        phone: result.order.phone,
        del: result.order.delivery_option,
        method: form.data.method,
        items: items.map((i) => ({
          id: Number(i.product_id),
          name: i.title ?? `Dress #${i.product_id}`,
          size: i.size,
          price: i.price_ksh,
        })),
      },
    })
  })

  // "Will it fit me?" — AI stylist answer for a dress (unavailable if the
  // worker isn't configured; the UI then points to WhatsApp).
  app.post<{ Params: { id: string } }>('/shop/api/fit/:id', POST_LIMIT, async (req, reply) => {
    const { message } = z.object({ message: z.string().min(2).max(500) }).parse(req.body ?? {})
    const product = await getProduct(Number(req.params.id))
    if (!product) return reply.code(404).send({ error: 'not found' })
    const advice = await fitAdvice(product, message)
    return reply.send(advice ?? { unavailable: true })
  })

  // "How to style it" — styling advice for a dress.
  app.get<{ Params: { id: string } }>('/shop/api/style/:id', async (req, reply) => {
    const product = await getProduct(Number(req.params.id))
    if (!product) return reply.code(404).send({ error: 'not found' })
    const advice = await stylingAdvice(product)
    return reply.send(advice ?? { unavailable: true })
  })

  // Live status for a placed order (My orders tracker).
  app.get<{ Params: { id: string; token: string } }>('/shop/api/order/:id/:token', async (req, reply) => {
    const order = await getOrder(Number(req.params.id), req.params.token)
    if (!order) return reply.code(404).send({ error: 'not found' })
    const items = await orderItems(order.id)
    return reply.header('Cache-Control', 'no-store').send({
      dn: dnCode(order.id),
      status: statusIndex(order.status),
      rawStatus: order.status,
      total: order.total_ksh,
      del: order.delivery_option,
      items: items.map((i) => Number(i.product_id)),
      at: order.created_at,
    })
  })

  // Gallery image by media-library id (distinct from /shop/img/:productId).
  app.get<{ Params: { id: string } }>('/shop/media/:id', async (req, reply) => {
    const media = await readMediaContent(Number(req.params.id))
    if (!media) return reply.callNotFound()
    return reply
      .type(media.item.mimetype ?? 'image/jpeg')
      .header('Cache-Control', 'public, max-age=86400')
      .send(media.content)
  })

  // Gallery video stream (media library id).
  app.get<{ Params: { id: string } }>('/shop/video/:id', async (req, reply) => {
    const media = await readMediaContent(Number(req.params.id))
    if (!media) return reply.callNotFound()
    return reply
      .type(media.item.mimetype ?? 'video/mp4')
      .header('Cache-Control', 'public, max-age=86400')
      .send(media.content)
  })

  // Product image: a product's primary photo, or any media-library id directly.
  app.get<{ Params: { id: string } }>('/shop/img/:id', async (req, reply) => {
    const product = await getProduct(Number(req.params.id))
    if (!product) return reply.callNotFound()
    const media = await readMediaContent(product.media_id)
    if (!media) return reply.callNotFound()
    return reply
      .type(media.item.mimetype ?? 'image/jpeg')
      .header('Cache-Control', 'public, max-age=86400')
      .send(media.content)
  })

  app.post('/shop/cart/add', POST_LIMIT, async (req, reply) => {
    const form = z.object({ productId: z.coerce.number() }).parse(req.body ?? {})
    const product = await getProduct(form.productId)
    if (product?.status === 'published') {
      const cartId = await ensureCartId(req, reply)
      const held = await addToCart(cartId, form.productId)
      if (!held) return reply.redirect('/shop/cart?taken=1')
    }
    return reply.redirect('/shop/cart')
  })

  app.post('/shop/cart/remove', POST_LIMIT, async (req, reply) => {
    const form = z.object({ productId: z.coerce.number() }).parse(req.body ?? {})
    const cartId = await getCartId(req)
    if (cartId) await removeFromCart(cartId, form.productId)
    return reply.redirect('/shop/cart')
  })

  app.get<{ Querystring: { taken?: string } }>('/shop/cart', async (req, reply) => {
    const cartId = await getCartId(req)
    // Extend the hold on everything still in the cart while they're here.
    const items = cartId ? await cartProducts(cartId) : []
    if (cartId) await Promise.all(items.map((p) => reserveProduct(p.id, cartId)))
    return renderCart(reply, items, req.query.taken ? 'Sorry — that dress was just reserved by someone else. Each piece is unique!' : null)
  })

  app.post('/shop/checkout', POST_LIMIT, async (req, reply) => {
    const form = z
      .object({
        name: z.string().min(2),
        phone: z.string().min(9),
        town: z.string().min(2),
        deliveryOption: z.enum(['agent', 'doorstep', 'errand']),
        deliveryLocation: z.string().min(2),
      })
      .safeParse(req.body ?? {})
    const cartId = await getCartId(req)
    if (!form.success || !cartId) {
      const items = cartId ? await cartProducts(cartId) : []
      return renderCart(
        reply,
        items,
        form.success ? 'Your cart session expired — please add the dress again.' : 'Please fill in all fields.',
      )
    }
    try {
      const order = await createOrder(cartId, form.data)
      return reply.redirect(`/shop/pay/${order.id}/${order.access_token}`)
    } catch (err) {
      const items = await cartProducts(cartId)
      return renderCart(reply, items, (err as Error).message)
    }
  })

  app.get<{ Params: { id: string; token: string } }>('/shop/pay/:id/:token', async (req, reply) => {
    const order = await getOrder(Number(req.params.id), req.params.token)
    if (!order) return reply.callNotFound()
    if (order.status !== 'pending_payment') {
      return reply.redirect(`/shop/order/${order.id}/${order.access_token}`)
    }
    const items = await orderItems(order.id)
    return shopView(reply, 'shop_pay.njk', { order, items, totalFmt: formatKsh(order.total_ksh), error: null })
  })

  app.post<{ Params: { id: string; token: string } }>(
    '/shop/pay/:id/:token',
    POST_LIMIT,
    async (req, reply) => {
      const cartId = await getCartId(req)
      const result = await payOrder(Number(req.params.id), req.params.token, cartId)
      if (!result.ok) {
        const order = await getOrder(Number(req.params.id), req.params.token)
        if (!order) return reply.callNotFound()
        const items = await orderItems(order.id)
        return shopView(reply, 'shop_pay.njk', { order, items, totalFmt: formatKsh(order.total_ksh), error: result.reason })
      }
      return reply.redirect(`/shop/order/${result.order.id}/${result.order.access_token}`)
    },
  )

  app.get<{ Params: { id: string; token: string } }>('/shop/order/:id/:token', async (req, reply) => {
    const order = await getOrder(Number(req.params.id), req.params.token)
    if (!order) return reply.callNotFound()
    const items = await orderItems(order.id)
    return shopView(reply, 'shop_order.njk', { order, items, totalFmt: formatKsh(order.total_ksh) })
  })

  function renderCart(reply: FastifyReply, items: Product[], error: string | null) {
    const total = items.reduce((sum, p) => sum + (p.price_ksh ?? 0), 0)
    const waText = items.length
      ? `Hi ${brand.name}! I would like to order:\n` +
        items.map((p) => `- ${productName(p)} (size ${p.size ?? '?'})`).join('\n') +
        `\nTotal: ${formatKsh(total)}`
      : `Hi ${brand.name}! I would like to see your latest dresses.`
    return shopView(reply, 'shop_cart.njk', {
      items: items.map(decorate),
      total,
      totalFmt: formatKsh(total),
      cartCount: items.length,
      waLink: `https://wa.me/${brand.whatsapp}?text=${encodeURIComponent(waText)}`,
      error,
    })
  }
}
