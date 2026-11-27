import { config } from '../../config.js'
import { query } from '../../db.js'
import type { Product } from './index.js'

// SQL fragment: a product is purchasable by `holder` if it's published and
// either unreserved, its hold has lapsed, or the hold is the holder's own.
export const AVAILABLE_TO = (holderParam: string) =>
  `status = 'published' AND (reserved_until IS NULL OR reserved_until <= now() OR reserved_by = ${holderParam})`

// Atomically place/extend a hold. Returns true if the holder now owns it.
export async function reserveProduct(productId: number, holder: string): Promise<boolean> {
  const res = await query(
    `UPDATE products
     SET reserved_until = now() + make_interval(mins => $3), reserved_by = $2
     WHERE id = $1 AND ${AVAILABLE_TO('$2')}
     RETURNING id`,
    [productId, holder, config.shopReserveMinutes],
  )
  return res.rowCount === 1
}

export async function releaseReservation(productId: number, holder: string): Promise<void> {
  await query(
    'UPDATE products SET reserved_until = NULL, reserved_by = NULL WHERE id = $1 AND reserved_by = $2',
    [productId, holder],
  )
}

export async function clearReservation(productId: number): Promise<void> {
  await query('UPDATE products SET reserved_until = NULL, reserved_by = NULL WHERE id = $1', [
    productId,
  ])
}

// Published dresses this holder can still buy (hides others' live holds).
export async function listAvailable(holder: string): Promise<Product[]> {
  const res = await query<Product>(
    `SELECT * FROM products WHERE ${AVAILABLE_TO('$1')} ORDER BY id DESC`,
    [holder],
  )
  return res.rows
}

export function isHeldByOther(
  product: { reserved_until: Date | null; reserved_by: string | null },
  holder: string,
): boolean {
  if (!product.reserved_until || !product.reserved_by) return false
  return product.reserved_by !== holder && new Date(product.reserved_until) > new Date()
}
