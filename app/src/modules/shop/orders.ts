import { config } from '../../config.js'
import { pool, query } from '../../db.js'
import { log } from '../../logger.js'
import { toChatId } from '../../lib/phone.js'
import { enqueueSend } from '../../queue/index.js'
import { formatKsh, productName } from './label.js'
import { cartProducts, clearCart } from './carts.js'

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
  package_code: string | null
  paid_at: Date | null
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
      `UPDATE products SET status = 'sold', sold_at = now()
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

export async function setOrderStatus(id: number, status: Order['status']): Promise<void> {
  await query('UPDATE orders SET status = $2 WHERE id = $1', [id, status])
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
  await query(`UPDATE orders SET status = 'dropped', package_code = $2 WHERE id = $1`, [
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
