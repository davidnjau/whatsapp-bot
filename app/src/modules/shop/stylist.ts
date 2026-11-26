import { config } from '../../config.js'
import { query } from '../../db.js'
import { getValidCoupon, incrementCouponUse } from './coupons.js'

export async function grantStylistAccess(visitor: string, dressId: number, kind: string): Promise<void> {
  await query('INSERT INTO stylist_access (visitor, dress_id, kind) VALUES ($1, $2, $3)', [visitor, dressId, kind])
}

export async function hasStylistAccess(visitor: string, dressId: number, kind: string): Promise<boolean> {
  const res = await query('SELECT 1 FROM stylist_access WHERE visitor = $1 AND dress_id = $2 AND kind = $3 LIMIT 1', [
    visitor,
    dressId,
    kind,
  ])
  return !!res.rowCount
}

// The amount due for a stylist answer after an optional coupon (never below 0).
export async function stylistAmount(couponCode?: string): Promise<{ amount: number; coupon: string | null }> {
  const price = config.stylistPrice
  if (!couponCode) return { amount: price, coupon: null }
  const coupon = await getValidCoupon(couponCode)
  if (!coupon) return { amount: price, coupon: null }
  const discount = Math.round((price * coupon.percent) / 100)
  return { amount: Math.max(0, price - discount), coupon: coupon.code }
}

export { incrementCouponUse }
