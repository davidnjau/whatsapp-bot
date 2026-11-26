import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { config } from '../../config.js'
import { enqueueSend } from '../../queue/index.js'
import { normalizePhone, toChatId } from '../../lib/phone.js'
import { readMediaContent } from '../status/media.js'
import {
  addToCart,
  cartCount,
  cartExists,
  cartProducts,
  createCart,
  linkCartCustomer,
  removeFromCart,
  setCartContact,
} from './carts.js'
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
import { getValidCoupon } from './coupons.js'
import { grantStylistAccess, hasStylistAccess, incrementCouponUse, stylistAmount } from './stylist.js'
import { bannerDTO, getCampaign, isLive, liveCampaign } from './campaigns.js'
import {
  accountOrder,
  getCustomer,
  getCustomerCoupons,
  getCustomerOrders,
  grantLoyaltyIfDue,
  requestLoginCode,
  verifyLoginCode,
} from './accounts.js'
import { fitAdvice, stylingAdvice, type FitAdvice, type StylingAdvice } from './advisor.js'

const CART_COOKIE = 'cart_id'
const CUST_COOKIE = 'cust'

async function getCustomerId(req: FastifyRequest): Promise<number | null> {
  const cookie = req.cookies[CUST_COOKIE]
  if (!cookie) return null
  const { valid, value } = req.unsignCookie(cookie)
  if (!valid || !value) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function setCustomerCookie(reply: FastifyReply, id: number) {
  reply.setCookie(CUST_COOKIE, String(id), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    path: '/',
    maxAge: 60 * 24 * 3600,
  })
}

// Is this request from a logged-in admin (for the shop's admin-only footer)?
function isAdminReq(req: FastifyRequest): boolean {
  const cookie = req.cookies['admin_session']
  if (!cookie) return false
  const { valid, value } = req.unsignCookie(cookie)
  return valid && value === 'ok'
}

// Admins designated by phone get the same signed admin_session as a
// username/password login once they verify a normal customer code.
function grantAdminIfPhone(reply: FastifyReply, phone: string) {
  if (!config.adminPhones.has(phone)) return
  reply.setCookie('admin_session', 'ok', {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    path: '/',
    maxAge: 30 * 24 * 3600,
  })
}

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

// WhatsApp-ready text for a stylist answer (sent as the dress photo's caption).
function stylistText(product: Product, mode: 'fit' | 'style', advice: FitAdvice | StylingAdvice): string {
  const name = productName(product)
  if (mode === 'fit') {
    const a = advice as FitAdvice
    return `👗 ${name} — fit advice\n\n${a.stylist_reply}` + (a.recommended_size ? `\n\nSuggested size: ${a.recommended_size}` : '')
  }
  const a = advice as StylingAdvice
  const lines = [`✨ ${name} — styling ideas`, '', ...a.styling_tips.map((t) => `• ${t}`)]
  for (const [occ, tip] of Object.entries(a.by_occasion)) lines.push(`${occ}: ${tip}`)
  return lines.join('\n')
}

const POST_LIMIT = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }

export const shopRoutes: FastifyPluginAsync = async (app) => {
  // The shop is a single-page app (ported reference design); it loads the
  // catalogue from /shop/api/catalogue and handles its own hash routes.
  const renderShell = async (req: FastifyRequest, reply: FastifyReply) => {
    const promoId = Number((req.query as { promo?: string }).promo)
    const promo = promoId ? await getCampaign(promoId) : null
    const og = promo
      ? {
          title: promo.headline || promo.name,
          desc: promo.subtext || 'Quality mtumba dresses, delivered across Kenya.',
          image: promo.desktop_media_id ? `${config.appBaseUrl}/shop/media/${promo.desktop_media_id}` : '',
        }
      : null
    return reply.view('shop_app.njk', {
      wa: brand.whatsapp,
      stylistPrice: config.stylistPrice,
      isAdmin: isAdminReq(req),
      og,
    })
  }
  app.get('/', renderShell)
  app.get('/shop', renderShell)

  // The one promotional banner to show right now (or {} if none).
  app.get<{ Querystring: { id?: string } }>('/api/campaign/live', async (req, reply) => {
    const id = Number(req.query.id)
    let c = id ? await getCampaign(id) : null
    if (!(c && isLive(c))) c = await liveCampaign()
    return reply.header('Cache-Control', 'no-store').send(c ? bannerDTO(c) : {})
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
    const custId = await getCustomerId(req)
    if (custId) await linkCartCustomer(cartId, custId).catch(() => {})
    const ids = (await cartProducts(cartId)).map((p) => Number(p.id))
    return reply.send({ ok: held, taken: !held, ids })
  })

  // Capture the checkout phone onto the cart so an abandoned checkout is
  // reachable, even for anonymous shoppers who never log in or pay.
  app.post('/shop/api/cart/contact', POST_LIMIT, async (req, reply) => {
    const { phone } = z.object({ phone: z.string().min(9) }).parse(req.body ?? {})
    const normalized = normalizePhone(phone)
    if (!normalized) return reply.send({ ok: false })
    const cartId = await ensureCartId(req, reply)
    await setCartContact(cartId, normalized)
    return reply.send({ ok: true })
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
        coupon: z.string().optional(),
      })
      .safeParse(req.body ?? {})
    if (!form.success) return reply.send({ error: 'Please check your details and try again.' })
    const cartId = await getCartId(req)
    if (!cartId) return reply.send({ error: 'Your bag is empty.' })
    let order
    try {
      order = await createShopOrder(cartId, form.data, form.data.coupon)
    } catch (err) {
      return reply.send({ error: (err as Error).message })
    }
    const result = await payOrder(order.id, order.access_token, cartId)
    if (!result.ok) return reply.send({ error: result.reason })
    // Loyalty: a coupon after every N paid orders (fire-and-forget).
    grantLoyaltyIfDue(result.order.phone, result.order.customer_name).catch(() => {})
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

  // Paid AI stylist: fit or styling advice, delivered on the web or as a
  // WhatsApp message carrying the dress photo. Payment is simulated for now —
  // real M-Pesa STK slots in before the advice is generated.
  app.post<{ Params: { id: string } }>('/shop/api/stylist/:id', POST_LIMIT, async (req, reply) => {
    const form = z
      .object({
        mode: z.enum(['fit', 'style']),
        message: z.string().max(500).optional(),
        channel: z.enum(['web', 'whatsapp']),
        phone: z.string().optional(),
      })
      .safeParse(req.body ?? {})
    if (!form.success) return reply.send({ error: 'Please check your details.' })
    const { mode, message, channel, phone } = form.data
    const product = await getProduct(Number(req.params.id))
    if (!product) return reply.code(404).send({ error: 'not found' })

    // Access: logged-in customers are free; anyone else needs a paid/redeemed
    // access for this dress + kind (a client flag alone is not trusted).
    const custId = await getCustomerId(req)
    if (!custId) {
      const cartId = await getCartId(req)
      const allowed = cartId ? await hasStylistAccess(cartId, product.id, mode) : false
      if (!allowed) return reply.send({ error: 'Payment required.', payRequired: true })
    }

    const advice =
      mode === 'fit'
        ? await fitAdvice(product, message || 'Will this dress fit me?')
        : await stylingAdvice(product)
    if (!advice) return reply.send({ unavailable: true })

    if (channel === 'whatsapp') {
      const chatId = phone ? toChatId(phone) : null
      if (!chatId) return reply.send({ error: 'Enter a valid Kenyan number.' })
      await enqueueSend({
        chatId,
        module: 'shop',
        kind: 'stylist',
        payload: {
          type: 'image',
          file: { url: `${config.internalBaseUrl}/shop/img/${product.id}` },
          caption: stylistText(product, mode, advice),
        },
      })
      return reply.send({ sent: true })
    }
    return reply.send({ mode, advice })
  })

  // --- stylist pay / coupon (logged-in users are free) ---
  app.post('/api/stylist/coupon', POST_LIMIT, async (req, reply) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(req.body ?? {})
    const coupon = await getValidCoupon(code)
    if (!coupon) return reply.send({ ok: false, error: "That code isn't valid." })
    const { amount } = await stylistAmount(code)
    return reply.send({ ok: true, amount })
  })

  app.post('/api/stylist/pay', POST_LIMIT, async (req, reply) => {
    const form = z
      .object({
        phone: z.string().optional(),
        dressId: z.coerce.number(),
        kind: z.enum(['fit', 'style']),
        coupon: z.string().optional(),
      })
      .safeParse(req.body ?? {})
    if (!form.success) return reply.send({ ok: false, error: 'Invalid request.' })
    const { phone, dressId, kind, coupon } = form.data
    const { amount, coupon: validCoupon } = await stylistAmount(coupon)
    const visitor = await ensureCartId(req, reply)
    if (amount <= 0) {
      if (validCoupon) await incrementCouponUse(validCoupon)
      await grantStylistAccess(visitor, dressId, kind)
      return reply.send({ ok: true })
    }
    // Paid path — validate the Safaricom number; M-Pesa STK is simulated for now.
    const digits = (phone ?? '').replace(/\D/g, '').replace(/^0/, '254')
    if (!/^254(7|1)\d{8}$/.test(digits)) return reply.send({ ok: false, error: 'Enter a valid Safaricom number' })
    if (validCoupon) await incrementCouponUse(validCoupon)
    await grantStylistAccess(visitor, dressId, kind)
    return reply.send({ ok: true })
  })

  // --- customer accounts (phone + WhatsApp code login) ---
  app.post('/shop/api/auth/request', POST_LIMIT, async (req, reply) => {
    const { phone } = z.object({ phone: z.string().min(6) }).parse(req.body ?? {})
    const res = await requestLoginCode(phone)
    return reply.send(res.ok ? { sent: true } : { error: res.error })
  })

  app.post('/shop/api/auth/verify', POST_LIMIT, async (req, reply) => {
    const { phone, code } = z.object({ phone: z.string().min(6), code: z.string().min(4) }).parse(req.body ?? {})
    const customer = await verifyLoginCode(phone, code)
    if (!customer) return reply.send({ error: 'That code is wrong or expired.' })
    setCustomerCookie(reply, customer.id)
    // Attach any in-progress cart to the account so it can be followed up.
    const existingCart = await getCartId(req)
    if (existingCart) await linkCartCustomer(existingCart, customer.id).catch(() => {})
    grantAdminIfPhone(reply, customer.phone)
    return reply.send({ ok: true, phone: customer.phone, name: customer.name, admin: config.adminPhones.has(customer.phone) })
  })

  app.post('/shop/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(CUST_COOKIE, { path: '/' })
    reply.clearCookie('admin_session', { path: '/' })
    return reply.send({ ok: true })
  })

  app.get('/shop/api/account', async (req, reply) => {
    const id = await getCustomerId(req)
    const customer = id ? await getCustomer(id) : null
    if (!customer) return reply.header('Cache-Control', 'no-store').send({ loggedIn: false })
    const [orders, coupons] = await Promise.all([
      getCustomerOrders(customer.phone),
      getCustomerCoupons(customer.id),
    ])
    return reply.header('Cache-Control', 'no-store').send({
      loggedIn: true,
      admin: config.adminPhones.has(customer.phone),
      phone: customer.phone,
      name: customer.name,
      orders: orders.map(accountOrder),
      coupons,
    })
  })

  // Validate a coupon code at checkout → { valid, percent } or { valid:false }.
  app.get<{ Params: { code: string } }>('/shop/api/coupon/:code', async (req, reply) => {
    const coupon = await getValidCoupon(req.params.code)
    return reply.header('Cache-Control', 'no-store').send(
      coupon ? { valid: true, code: coupon.code, percent: coupon.percent } : { valid: false },
    )
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
