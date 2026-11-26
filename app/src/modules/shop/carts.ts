import { query } from '../../db.js'
import { toChatId } from '../../lib/phone.js'
import { enqueueSend } from '../../queue/index.js'
import type { Product } from './index.js'
import { AVAILABLE_TO, releaseReservation, reserveProduct } from './reservations.js'

export async function createCart(): Promise<string> {
  const res = await query<{ id: string }>('INSERT INTO carts DEFAULT VALUES RETURNING id')
  return res.rows[0].id
}

// Attach a logged-in customer to their cart so an abandoned cart has a contact.
export async function linkCartCustomer(cartId: string, customerId: number): Promise<void> {
  await query('UPDATE carts SET customer_id = $2 WHERE id = $1', [cartId, customerId])
}

// Capture the phone an anonymous shopper typed at checkout (already normalized).
export async function setCartContact(cartId: string, phone: string): Promise<void> {
  await query('UPDATE carts SET contact_phone = $2 WHERE id = $1', [cartId, phone])
}

export async function cartExists(cartId: string): Promise<boolean> {
  const res = await query('SELECT 1 FROM carts WHERE id = $1', [cartId])
  return !!res.rowCount
}

// Adding to cart places a hold. Returns false if another shopper holds it.
export async function addToCart(cartId: string, productId: number): Promise<boolean> {
  const held = await reserveProduct(productId, cartId)
  if (!held) return false
  await query(
    'INSERT INTO cart_items (cart_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [cartId, productId],
  )
  await query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId])
  return true
}

export async function removeFromCart(cartId: string, productId: number): Promise<void> {
  await query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId])
  await releaseReservation(productId, cartId)
  await query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId])
}

// Items this cart can still buy: own holds (or lapsed), never others' live holds.
export async function cartProducts(cartId: string): Promise<Product[]> {
  const res = await query<Product>(
    `SELECT p.* FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = $1::uuid AND ${AVAILABLE_TO('$1::text')}
     ORDER BY ci.added_at`,
    [cartId],
  )
  return res.rows
}

export async function cartCount(cartId: string): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT count(*) FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = $1::uuid AND ${AVAILABLE_TO('$1::text')}`,
    [cartId],
  )
  return Number(res.rows[0].count)
}

export async function clearCart(cartId: string): Promise<void> {
  await query('DELETE FROM cart_items WHERE cart_id = $1', [cartId])
}

export interface ActiveCart {
  cart_id: string
  updated_at: Date
  customer_name: string | null
  customer_phone: string | null
  items: Array<{ product_id: number; title: string | null; size: string | null; price_ksh: number | null }>
}

// For the admin "what people have added" view. A contact (name/phone) is present
// when the shopper logged in OR typed their number at checkout before abandoning.
export async function listActiveCarts(): Promise<ActiveCart[]> {
  const res = await query<{
    cart_id: string
    updated_at: Date
    customer_name: string | null
    customer_phone: string | null
    product_id: number
    title: string | null
    size: string | null
    price_ksh: number | null
  }>(
    `SELECT c.id AS cart_id, c.updated_at, cu.name AS customer_name,
            COALESCE(cu.phone, c.contact_phone) AS customer_phone,
            p.id AS product_id, p.title, p.size, p.price_ksh
     FROM carts c
     JOIN cart_items ci ON ci.cart_id = c.id
     JOIN products p ON p.id = ci.product_id
     LEFT JOIN customers cu ON cu.id = c.customer_id
     WHERE c.updated_at > now() - interval '7 days'
     ORDER BY c.updated_at DESC, c.id`,
  )
  const byCart = new Map<string, ActiveCart>()
  for (const row of res.rows) {
    let cart = byCart.get(row.cart_id)
    if (!cart) {
      cart = {
        cart_id: row.cart_id,
        updated_at: row.updated_at,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone,
        items: [],
      }
      byCart.set(row.cart_id, cart)
    }
    cart.items.push({
      product_id: row.product_id,
      title: row.title,
      size: row.size,
      price_ksh: row.price_ksh,
    })
  }
  return [...byCart.values()]
}

// Follow up on an abandoned cart — only works when the cart has a logged-in
// customer. A nudge, so it respects opt-out (kind not exempt in policy.ts).
export async function messageCartCustomer(
  cartId: string,
  text: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const body = text.trim()
  if (!body) return { ok: false, reason: 'Message is empty.' }
  const res = await query<{ phone: string | null }>(
    'SELECT COALESCE(cu.phone, c.contact_phone) AS phone FROM carts c LEFT JOIN customers cu ON cu.id = c.customer_id WHERE c.id = $1',
    [cartId],
  )
  const phone = res.rows[0]?.phone
  if (!phone) return { ok: false, reason: 'This cart has no contact on file (shopper was not logged in).' }
  const chatId = toChatId(phone)
  if (!chatId) return { ok: false, reason: 'Customer has no valid WhatsApp number.' }
  await enqueueSend({ chatId, module: 'shop', kind: 'cart_followup', payload: { type: 'text', text: body } })
  return { ok: true }
}

// Carts with items touched in the last 7 days that never became an order.
export async function countAbandonedCarts(): Promise<number> {
  const res = await query<{ c: string }>(
    `SELECT count(DISTINCT c.id) c
     FROM carts c JOIN cart_items ci ON ci.cart_id = c.id
     WHERE c.updated_at > now() - interval '7 days'`,
  )
  return Number(res.rows[0]?.c ?? 0)
}
