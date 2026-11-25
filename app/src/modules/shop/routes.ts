import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { readMediaContent } from '../status/media.js'
import { addToCart, cartCount, cartExists, cartProducts, createCart, removeFromCart } from './carts.js'
import { getProduct } from './index.js'
import { isHeldByOther, listAvailable, reserveProduct } from './reservations.js'
import { createOrder, getOrder, orderItems, payOrder } from './orders.js'

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

const POST_LIMIT = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }

export const shopRoutes: FastifyPluginAsync = async (app) => {
  app.get('/shop', async (req, reply) => {
    const cartId = await getCartId(req)
    const [products, count] = await Promise.all([
      listAvailable(cartId ?? ''),
      cartId ? cartCount(cartId) : Promise.resolve(0),
    ])
    return reply.view('shop_index.njk', { products, cartCount: count })
  })

  app.get<{ Params: { id: string } }>('/shop/p/:id', async (req, reply) => {
    const product = await getProduct(Number(req.params.id))
    const cartId = await getCartId(req)
    const count = cartId ? await cartCount(cartId) : 0
    // Drafts/archived dresses aren't public — show a friendly page, not JSON 404.
    if (!product || (product.status !== 'published' && product.status !== 'sold')) {
      return reply.code(404).view('shop_notfound.njk', { cartCount: count })
    }
    const heldByOther = isHeldByOther(product, cartId ?? '')
    return reply.view('shop_product.njk', { product, cartCount: count, heldByOther })
  })

  // Product image (any known product — images are the public catalogue content).
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
    const total = items.reduce((sum, p) => sum + (p.price_ksh ?? 0), 0)
    return reply.view('shop_cart.njk', {
      items,
      total,
      cartCount: items.length,
      error: req.query.taken
        ? 'Sorry — that dress was just reserved by someone else. Each piece is unique!'
        : null,
    })
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
      const total = items.reduce((sum, p) => sum + (p.price_ksh ?? 0), 0)
      return reply.view('shop_cart.njk', {
        items,
        total,
        cartCount: items.length,
        error: form.success ? 'Your cart session expired — please add the dress again.' : 'Please fill in all fields.',
      })
    }
    try {
      const order = await createOrder(cartId, form.data)
      return reply.redirect(`/shop/pay/${order.id}/${order.access_token}`)
    } catch (err) {
      const items = await cartProducts(cartId)
      const total = items.reduce((sum, p) => sum + (p.price_ksh ?? 0), 0)
      return reply.view('shop_cart.njk', {
        items, total, cartCount: items.length, error: (err as Error).message,
      })
    }
  })

  app.get<{ Params: { id: string; token: string } }>('/shop/pay/:id/:token', async (req, reply) => {
    const order = await getOrder(Number(req.params.id), req.params.token)
    if (!order) return reply.callNotFound()
    if (order.status !== 'pending_payment') {
      return reply.redirect(`/shop/order/${order.id}/${order.access_token}`)
    }
    const items = await orderItems(order.id)
    return reply.view('shop_pay.njk', { order, items, error: null })
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
        return reply.view('shop_pay.njk', { order, items, error: result.reason })
      }
      return reply.redirect(`/shop/order/${result.order.id}/${result.order.access_token}`)
    },
  )

  app.get<{ Params: { id: string; token: string } }>('/shop/order/:id/:token', async (req, reply) => {
    const order = await getOrder(Number(req.params.id), req.params.token)
    if (!order) return reply.callNotFound()
    const items = await orderItems(order.id)
    return reply.view('shop_order.njk', { order, items })
  })
}
