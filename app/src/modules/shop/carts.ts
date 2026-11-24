import { query } from '../../db.js'
import type { Product } from './index.js'

export async function createCart(): Promise<string> {
  const res = await query<{ id: string }>('INSERT INTO carts DEFAULT VALUES RETURNING id')
  return res.rows[0].id
}

export async function cartExists(cartId: string): Promise<boolean> {
  const res = await query('SELECT 1 FROM carts WHERE id = $1', [cartId])
  return !!res.rowCount
}

export async function addToCart(cartId: string, productId: number): Promise<void> {
  await query(
    'INSERT INTO cart_items (cart_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [cartId, productId],
  )
  await query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId])
}

export async function removeFromCart(cartId: string, productId: number): Promise<void> {
  await query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId])
  await query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId])
}

// Only items still purchasable count — sold dresses silently drop out.
export async function cartProducts(cartId: string): Promise<Product[]> {
  const res = await query<Product>(
    `SELECT p.* FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = $1 AND p.status = 'published'
     ORDER BY ci.added_at`,
    [cartId],
  )
  return res.rows
}

export async function cartCount(cartId: string): Promise<number> {
  const res = await query<{ count: string }>(
    `SELECT count(*) FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = $1 AND p.status = 'published'`,
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
  items: Array<{ product_id: number; title: string | null; size: string | null; price_ksh: number | null }>
}

// For the admin "what people have added" view.
export async function listActiveCarts(): Promise<ActiveCart[]> {
  const res = await query<{
    cart_id: string
    updated_at: Date
    product_id: number
    title: string | null
    size: string | null
    price_ksh: number | null
  }>(
    `SELECT c.id AS cart_id, c.updated_at, p.id AS product_id, p.title, p.size, p.price_ksh
     FROM carts c
     JOIN cart_items ci ON ci.cart_id = c.id
     JOIN products p ON p.id = ci.product_id
     WHERE c.updated_at > now() - interval '7 days'
     ORDER BY c.updated_at DESC, c.id`,
  )
  const byCart = new Map<string, ActiveCart>()
  for (const row of res.rows) {
    let cart = byCart.get(row.cart_id)
    if (!cart) {
      cart = { cart_id: row.cart_id, updated_at: row.updated_at, items: [] }
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
