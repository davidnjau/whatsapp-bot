import { query } from '../../db.js'
import { getSetting } from '../../lib/settings.js'

// Admin-configurable default lifetime when a coupon has no explicit expiry.
export async function defaultCouponExpiry(): Promise<Date> {
  const days = Number(await getSetting('coupon_default_days', '7')) || 7
  return new Date(Date.now() + days * 24 * 3600 * 1000)
}

export interface Coupon {
  id: number
  code: string
  percent: number
  active: boolean
  expires_at: Date | null
  max_uses: number | null
  used_count: number
  created_at: Date
}

export async function listCoupons(): Promise<Coupon[]> {
  const res = await query<Coupon>('SELECT * FROM coupons ORDER BY created_at DESC')
  return res.rows
}

export async function createCoupon(
  code: string,
  percent: number,
  expiresAt: Date | null,
  maxUses: number | null,
): Promise<void> {
  await query(
    `INSERT INTO coupons (code, percent, expires_at, max_uses, active)
     VALUES (upper($1), $2, $3, $4, true)
     ON CONFLICT (code) DO UPDATE
       SET percent = $2, expires_at = $3, max_uses = $4, active = true`,
    [code.trim(), percent, expiresAt, maxUses],
  )
}

export async function setCouponActive(id: number, active: boolean): Promise<void> {
  await query('UPDATE coupons SET active = $2 WHERE id = $1', [id, active])
}

// A usable coupon: active, not expired, under its usage cap.
export async function getValidCoupon(code: string): Promise<Coupon | null> {
  const res = await query<Coupon>(
    `SELECT * FROM coupons
     WHERE upper(code) = upper($1) AND active
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR used_count < max_uses)`,
    [code.trim()],
  )
  return res.rows[0] ?? null
}

export async function incrementCouponUse(code: string): Promise<void> {
  await query('UPDATE coupons SET used_count = used_count + 1 WHERE upper(code) = upper($1)', [code.trim()])
}
