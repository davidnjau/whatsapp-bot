import { config } from '../../config.js'
import { pool, query } from '../../db.js'
import { log } from '../../logger.js'
import { toChatId } from '../../lib/phone.js'
import { enqueueSend } from '../../queue/index.js'
import { formatKsh, productName } from './label.js'
import { cartProducts, clearCart } from './carts.js'
import { getValidCoupon, incrementCouponUse } from './coupons.js'

export interface Order {
  id: number
  access_token: string
  customer_name: string
  phone: string
  town: string
  delivery_option: 'agent' | 'doorstep' | 'errand'
  delivery_location: string
  status: 'pending_payment' | 'paid' | 'packed' | 'dropped' | 'collected' | 'cancelled'
  total_ksh: number
  coupon_code: string | null
  discount_ksh: number
  package_code: string | null
  mpesa_ref: string | null
  internal_notes: string | null
  paid_at: Date | null
  packed_at: Date | null
  dropped_at: Date | null
  cancelled_at: Date | null
  created_at: Date
}

export interface OrderItem {
  product_id: number
  price_ksh: number
  title: string | null
  size: string | null
}

export interface CheckoutForm {
  name: string
  phone: string
  town: string
  deliveryOption: 'agent' | 'doorstep' | 'errand'
  deliveryLocation: string
}

export async function createOrder(cartId: string, form: CheckoutForm): Promise<Order> {
  const items = await cartProducts(cartId)
  if (items.length === 0) throw new Error('Your cart is empty (items may have just sold out).')
  const total = items.reduce((sum, p) => sum + (p.price_ksh ?? 0), 0)
  const inserted = await query<Order>(
    `INSERT INTO orders (customer_name, phone, town, delivery_option, delivery_location, total_ksh)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [form.name, form.phone, form.town, form.deliveryOption, form.deliveryLocation, total],
  )
  const order = inserted.rows[0]
  for (const p of items) {
    await query('INSERT INTO order_items (order_id, product_id, price_ksh) VALUES ($1, $2, $3)', [
      order.id,
      p.id,
      p.price_ksh ?? 0,
    ])
  }
  return order
}

// Delivery options the shop SPA offers (keep in sync with the front-end).
export const SHOP_DELIVERY: Record<string, { label: string; fee: number }> = {
  pickup: { label: 'Pick up in Nairobi', fee: 0 },
  nairobi: { label: 'Delivery within Nairobi', fee: 200 },
  country: { label: 'Countrywide delivery', fee: 350 },
}

export interface ShopCheckout {
  name: string
  phone: string
  del: string
  area: string
}

// Order placed from the shop SPA: total includes the delivery fee minus any
// coupon discount (applied to the dress subtotal, not delivery).
export async function createShopOrder(
  cartId: string,
  form: ShopCheckout,
  couponCode?: string,
): Promise<Order> {
  const items = await cartProducts(cartId)
  if (items.length === 0) throw new Error('Your bag is empty (items may have just sold out).')
  const d = SHOP_DELIVERY[form.del] ?? SHOP_DELIVERY.nairobi
  const subtotal = items.reduce((sum, p) => sum + (p.price_ksh ?? 0), 0)
  let discount = 0
  let usedCode: string | null = null
  if (couponCode) {
    const coupon = await getValidCoupon(couponCode)
    if (coupon) {
      discount = Math.round((subtotal * coupon.percent) / 100)
      usedCode = coupon.code
    }
  }
  const total = subtotal - discount + d.fee
  const location = form.del === 'pickup' ? 'Nairobi CBD pick-up point' : form.area || d.label
  const inserted = await query<Order>(
    `INSERT INTO orders (customer_name, phone, town, delivery_option, delivery_location, total_ksh, coupon_code, discount_ksh)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [form.name, form.phone, location, d.label, location, total, usedCode, discount],
  )
  if (usedCode) await incrementCouponUse(usedCode)
  const order = inserted.rows[0]
  for (const p of items) {
    await query('INSERT INTO order_items (order_id, product_id, price_ksh) VALUES ($1, $2, $3)', [
      order.id,
      p.id,
      p.price_ksh ?? 0,
    ])
  }
  return order
}

// Customer-facing order reference, e.g. DN-1042.
export const dnCode = (id: number): string => `DN-${1000 + id}`

// Map our order status to the shop's 4-step tracker index (0..3).
export function statusIndex(status: Order['status']): number {
  if (status === 'collected') return 3
  if (status === 'dropped' || status === 'packed') return 2
  if (status === 'paid') return 1
  return 0
}

// Single-product order created from the WhatsApp chat flow (no cart).
export async function createDirectOrder(productId: number, form: CheckoutForm): Promise<Order> {
  const res = await query<{ price_ksh: number | null; status: string }>(
    'SELECT price_ksh, status FROM products WHERE id = $1',
    [productId],
  )
  const product = res.rows[0]
  if (!product || product.status !== 'published') {
    throw new Error('That dress is no longer available.')
  }
  const total = product.price_ksh ?? 0
  const inserted = await query<Order>(
    `INSERT INTO orders (customer_name, phone, town, delivery_option, delivery_location, total_ksh)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [form.name, form.phone, form.town, form.deliveryOption, form.deliveryLocation, total],
  )
  const order = inserted.rows[0]
  await query('INSERT INTO order_items (order_id, product_id, price_ksh) VALUES ($1, $2, $3)', [
    order.id,
    productId,
    total,
  ])
  return order
}

export async function getOrder(id: number, accessToken?: string): Promise<Order | null> {
  const res = accessToken
    ? await query<Order>('SELECT * FROM orders WHERE id = $1 AND access_token = $2', [id, accessToken])
    : await query<Order>('SELECT * FROM orders WHERE id = $1', [id])
  return res.rows[0] ?? null
}

export async function orderItems(orderId: number): Promise<OrderItem[]> {
  const res = await query<OrderItem>(
    `SELECT oi.product_id, oi.price_ksh, p.title, p.size
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1 ORDER BY oi.product_id`,
    [orderId],
  )
  return res.rows
}

// Simulated M-Pesa payment. Atomically marks the dresses sold (single pieces —
// first payer wins) and the order paid; a dress that just sold fails the whole
// payment cleanly.
export async function payOrder(
  id: number,
  accessToken: string,
  cartId: string | null,
): Promise<{ ok: true; order: Order } | { ok: false; reason: string }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const orderRes = await client.query<Order>(
      'SELECT * FROM orders WHERE id = $1 AND access_token = $2 FOR UPDATE',
      [id, accessToken],
    )
    const order = orderRes.rows[0]
    if (!order) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'Order not found.' }
    }
    if (order.status === 'paid') {
      await client.query('ROLLBACK')
      return { ok: true, order }
    }
    if (order.status !== 'pending_payment') {
      await client.query('ROLLBACK')
      return { ok: false, reason: `Order is ${order.status}.` }
    }
    const items = await client.query<{ product_id: number }>(
      'SELECT product_id FROM order_items WHERE order_id = $1',
      [id],
    )
    const ids = items.rows.map((r) => r.product_id)
    const sold = await client.query(
      `UPDATE products SET status = 'sold', sold_at = now(), reserved_until = NULL, reserved_by = NULL
       WHERE id = ANY($1::bigint[]) AND status = 'published'`,
      [ids],
    )
    if (sold.rowCount !== ids.length) {
      await client.query('ROLLBACK')
      await query(`UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending_payment'`, [id])
      return {
        ok: false,
        reason: 'Sorry — one of your dresses was just bought by someone else. Each piece is unique!',
      }
    }
    const updated = await client.query<Order>(
      `UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1 RETURNING *`,
      [id],
    )
    await client.query('COMMIT')
    const paid = updated.rows[0]
    if (cartId) await clearCart(cartId).catch(() => {})
    await notifyOrderPaid(paid)
    return { ok: true, order: paid }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function notifyOrderPaid(order: Order) {
  const items = await orderItems(order.id)
  const lines = items.map(
    (i) =>
      `• ${productName({ id: i.product_id, title: i.title, size: i.size, price_ksh: i.price_ksh })} ` +
      `(size ${i.size ?? '?'}) — ${formatKsh(i.price_ksh)}`,
  )

  const staffChatId = config.handoffNumber ? toChatId(config.handoffNumber) : null
  if (staffChatId) {
    await enqueueSend({
      chatId: staffChatId,
      module: 'shop',
      kind: 'order_alert',
      payload: {
        type: 'text',
        text:
          `🛍 New PAID order #${order.id} — ${formatKsh(order.total_ksh)}\n` +
          `${lines.join('\n')}\n` +
          `Customer: ${order.customer_name}, ${order.phone}\n` +
          `Delivery: ${order.delivery_option} — ${order.delivery_location}, ${order.town}\n` +
          `Manage: ${config.appBaseUrl}/admin/orders`,
      },
    }).catch((err) => log.error({ err: err.message }, 'order staff alert failed'))
  }

  const customerChatId = toChatId(order.phone)
  if (customerChatId) {
    await enqueueSend({
      chatId: customerChatId,
      module: 'shop',
      kind: 'order_confirm',
      payload: {
        type: 'text',
        text:
          `Asante ${order.customer_name}! 💃 Your Dress Nation order #${order.id} is confirmed ` +
          `(${formatKsh(order.total_ksh)}).\n${lines.join('\n')}\n` +
          `We'll send your Pickup Mtaani package code once your parcel is dropped off. ` +
          `Note: the delivery fee is separate and confirmed by the shop. No refunds/exchanges — asante for understanding!`,
      },
    }).catch((err) => log.error({ err: err.message }, 'order confirm message failed'))
  }
}

export async function listOrders(): Promise<Array<Order & { items: OrderItem[] }>> {
  const res = await query<Order>(
    `SELECT * FROM orders ORDER BY (status = 'pending_payment'), created_at DESC LIMIT 100`,
  )
  const withItems = []
  for (const order of res.rows) {
    withItems.push({ ...order, items: await orderItems(order.id) })
  }
  return withItems
}

// A conflict = the same single-piece dress sits in more than one live
// (non-cancelled) order. Returns product_id -> the orders claiming it, so the
// admin can spot a dress sold/paid twice.
export async function listConflicts(): Promise<Record<string, Array<{ id: number; status: string }>>> {
  const res = await query<{ product_id: number; order_id: number; status: string }>(
    `SELECT oi.product_id, o.id AS order_id, o.status
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status <> 'cancelled'
       AND oi.product_id IN (
         SELECT oi2.product_id FROM order_items oi2
         JOIN orders o2 ON o2.id = oi2.order_id
         WHERE o2.status <> 'cancelled'
         GROUP BY oi2.product_id
         HAVING count(DISTINCT oi2.order_id) > 1
       )
     ORDER BY oi.product_id, o.id`,
  )
  const map: Record<string, Array<{ id: number; status: string }>> = {}
  for (const r of res.rows) {
    ;(map[r.product_id] ??= []).push({ id: r.order_id, status: r.status })
  }
  return map
}

// Status filter groups shown as chips on the admin list.
export const ORDER_GROUPS = ['all', 'not_handled', 'packed', 'dropped', 'cancelled'] as const
export type OrderGroup = (typeof ORDER_GROUPS)[number]
const GROUP_SQL: Record<OrderGroup, string | null> = {
  all: null,
  not_handled: `status = 'paid'`,
  packed: `status = 'packed'`,
  dropped: `status IN ('dropped', 'collected')`,
  cancelled: `status = 'cancelled'`,
}
const SINCE_INTERVAL: Record<string, string> = {
  '1w': '7 days',
  '2w': '14 days',
  '3w': '21 days',
  '4w': '28 days',
  '1mo': '30 days',
}

// Search (order no / name / phone / location) + date-range conditions, shared by
// the list and the chip counts. Pushes bind params; returns SQL condition parts.
function searchDateConds(q: string, since: string, params: unknown[]): string[] {
  const conds: string[] = []
  const term = q.trim()
  if (term) {
    params.push(`%${term}%`)
    const p = `$${params.length}`
    const digits = term.replace(/\D/g, '')
    const n = digits ? Number(digits) : NaN
    params.push(Number.isFinite(n) ? n - 1000 : -1) // DN-10042 -> id 9042
    const pDn = `$${params.length}`
    params.push(Number.isFinite(n) ? n : -1) // raw id fallback
    const pRaw = `$${params.length}`
    conds.push(
      `(customer_name ILIKE ${p} OR phone ILIKE ${p} OR town ILIKE ${p} OR delivery_location ILIKE ${p} OR id = ${pDn} OR id = ${pRaw})`,
    )
  }
  if (SINCE_INTERVAL[since]) {
    params.push(SINCE_INTERVAL[since])
    conds.push(`created_at > now() - ($${params.length})::interval`)
  } else if (since === 'older') {
    conds.push(`created_at < now() - interval '30 days'`)
  }
  return conds
}

export type OrderCounts = Record<OrderGroup, number>

export async function orderCounts(q = '', since = 'all'): Promise<OrderCounts> {
  const params: unknown[] = []
  const conds = searchDateConds(q, since, params)
  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : ''
  const res = await query<{ status: string; c: string }>(
    `SELECT status, count(*) c FROM orders${where} GROUP BY status`,
    params,
  )
  const counts: OrderCounts = { all: 0, not_handled: 0, packed: 0, dropped: 0, cancelled: 0 }
  for (const r of res.rows) {
    const n = Number(r.c)
    counts.all += n
    if (r.status === 'paid') counts.not_handled += n
    else if (r.status === 'packed') counts.packed += n
    else if (r.status === 'dropped' || r.status === 'collected') counts.dropped += n
    else if (r.status === 'cancelled') counts.cancelled += n
  }
  return counts
}

export async function listOrdersPage(opts: {
  group: OrderGroup
  q?: string
  since?: string
  page?: number
  limit?: number
}): Promise<{ rows: Array<Order & { items: OrderItem[] }>; total: number; page: number; totalPages: number }> {
  const limit = opts.limit ?? 20
  const params: unknown[] = []
  const conds = searchDateConds(opts.q ?? '', opts.since ?? 'all', params)
  const groupCond = GROUP_SQL[opts.group]
  if (groupCond) conds.push(groupCond)
  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : ''
  const countRes = await query<{ c: string }>(`SELECT count(*) c FROM orders${where}`, params)
  const total = Number(countRes.rows[0]?.c ?? 0)
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const page = Math.min(Math.max(1, opts.page ?? 1), totalPages)
  const pageParams = [...params, limit, (page - 1) * limit]
  const res = await query<Order>(
    `SELECT * FROM orders${where}
     ORDER BY (status = 'pending_payment'), created_at DESC
     LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams,
  )
  const rows = []
  for (const order of res.rows) rows.push({ ...order, items: await orderItems(order.id) })
  return { rows, total, page, totalPages }
}

export interface OrderMessage {
  id: number
  body: string
  created_at: Date
  status: string | null
}

export async function orderMessages(orderId: number): Promise<OrderMessage[]> {
  const res = await query<OrderMessage>(
    `SELECT om.id, om.body, om.created_at, s.status
     FROM order_messages om LEFT JOIN sends s ON s.id = om.send_id
     WHERE om.order_id = $1 ORDER BY om.created_at`,
    [orderId],
  )
  return res.rows
}

// Admin → customer message about an order, through the same WhatsApp channel
// Notify uses; logged against the order so delivery status shows in the history.
export async function messageCustomer(
  orderId: number,
  text: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const body = text.trim()
  if (!body) return { ok: false, reason: 'Message is empty.' }
  const order = await getOrder(orderId)
  if (!order) return { ok: false, reason: 'Order not found.' }
  const chatId = toChatId(order.phone)
  if (!chatId) return { ok: false, reason: 'Customer has no valid WhatsApp number.' }
  const sendId = await enqueueSend({
    chatId,
    module: 'shop',
    kind: 'order_message',
    payload: { type: 'text', text: body },
  })
  await query('INSERT INTO order_messages (order_id, body, send_id) VALUES ($1, $2, $3)', [orderId, body, sendId])
  return { ok: true }
}

export async function setOrderNotes(id: number, notes: string): Promise<void> {
  await query('UPDATE orders SET internal_notes = $2 WHERE id = $1', [id, notes.trim() || null])
}

export async function setOrderStatus(id: number, status: Order['status']): Promise<void> {
  const stampCol =
    status === 'packed' ? 'packed_at' : status === 'cancelled' ? 'cancelled_at' : null
  if (stampCol) {
    await query(`UPDATE orders SET status = $2, ${stampCol} = now() WHERE id = $1`, [id, status])
  } else {
    await query('UPDATE orders SET status = $2 WHERE id = $1', [id, status])
  }
  if (status === 'cancelled') {
    await query(
      `UPDATE products SET status = 'published', sold_at = NULL
       WHERE status = 'sold' AND id IN (SELECT product_id FROM order_items WHERE order_id = $1)`,
      [id],
    )
  }
}

// Mark dropped at Pickup Mtaani: records the package code and messages the
// customer with tracking + the 3-day collection reminder.
export async function markDropped(id: number, packageCode: string): Promise<void> {
  await query(`UPDATE orders SET status = 'dropped', package_code = $2, dropped_at = now() WHERE id = $1`, [
    id,
    packageCode,
  ])
  const order = await getOrder(id)
  if (!order) return
  const customerChatId = toChatId(order.phone)
  if (!customerChatId) return
  await enqueueSend({
    chatId: customerChatId,
    module: 'shop',
    kind: 'order_dropped',
    payload: {
      type: 'text',
      text:
        `Your dress is on the way! 🚚 Package code: *${packageCode}*\n` +
        `Track it on the Pickup Mtaani website. ` +
        `Once it arrives, please collect within **3 days** and open & check your parcel at the agent before leaving. ` +
        `Any issue: photograph it there and call us on 0725571239.`,
    },
  })
}
