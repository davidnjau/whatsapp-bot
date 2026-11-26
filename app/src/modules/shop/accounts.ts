import { query } from '../../db.js'
import { enqueueSend } from '../../queue/index.js'
import { normalizePhone, toChatId } from '../../lib/phone.js'
import { getSetting } from '../../lib/settings.js'
import { dnCode, statusIndex, type Order } from './orders.js'

export interface Customer {
  id: number
  phone: string
  name: string | null
  created_at: Date
}

const gen6 = () => String(Math.floor(100000 + Math.random() * 900000))
const last9 = `right(regexp_replace(phone, '\\D', '', 'g'), 9) = right($1, 9)`

export async function requestLoginCode(rawPhone: string): Promise<{ ok: boolean; error?: string }> {
  const phone = normalizePhone(rawPhone)
  if (!phone) return { ok: false, error: 'Enter a valid Kenyan number.' }
  const code = gen6()
  await query(
    `INSERT INTO login_codes (phone, code, expires_at) VALUES ($1, $2, now() + interval '10 minutes')
     ON CONFLICT (phone) DO UPDATE SET code = $2, expires_at = now() + interval '10 minutes'`,
    [phone, code],
  )
  const chatId = toChatId(phone)
  if (chatId) {
    await enqueueSend({
      chatId,
      module: 'shop',
      kind: 'login',
      payload: { type: 'text', text: `Your Dress Nation login code is ${code}. It expires in 10 minutes.` },
    }).catch(() => {})
  }
  return { ok: true }
}

export async function upsertCustomer(phone: string, name: string | null): Promise<Customer> {
  const res = await query<Customer>(
    `INSERT INTO customers (phone, name) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET name = COALESCE(customers.name, $2) RETURNING *`,
    [phone, name],
  )
  return res.rows[0]
}

export async function verifyLoginCode(rawPhone: string, code: string): Promise<Customer | null> {
  const phone = normalizePhone(rawPhone)
  if (!phone) return null
  const res = await query<{ code: string }>(
    'SELECT code FROM login_codes WHERE phone = $1 AND expires_at > now()',
    [phone],
  )
  if (!res.rows[0] || res.rows[0].code !== code.trim()) return null
  await query('DELETE FROM login_codes WHERE phone = $1', [phone])
  return upsertCustomer(phone, null)
}

export async function getCustomer(id: number): Promise<Customer | null> {
  const res = await query<Customer>('SELECT * FROM customers WHERE id = $1', [id])
  return res.rows[0] ?? null
}

export async function getCustomerOrders(phone: string): Promise<Order[]> {
  const res = await query<Order>(
    `SELECT * FROM orders WHERE ${last9} ORDER BY created_at DESC LIMIT 50`,
    [phone],
  )
  return res.rows
}

export interface AccountCoupon {
  code: string
  percent: number
  used: boolean
}

export async function getCustomerCoupons(customerId: number): Promise<AccountCoupon[]> {
  const res = await query<AccountCoupon>(
    `SELECT c.code, c.percent, (c.used_count >= 1) AS used
     FROM customer_coupons cc JOIN coupons c ON c.id = cc.coupon_id
     WHERE cc.customer_id = $1 ORDER BY cc.created_at DESC`,
    [customerId],
  )
  return res.rows
}

// Grant a loyalty coupon after every N paid orders (admin-set N and %).
export async function grantLoyaltyIfDue(rawPhone: string, name: string | null): Promise<void> {
  const phone = normalizePhone(rawPhone)
  if (!phone) return
  const customer = await upsertCustomer(phone, name)
  const n = Number(await getSetting('loyalty_n', '3')) || 3
  const pct = Number(await getSetting('loyalty_percent', '10')) || 10
  const paid = await query<{ c: string }>(
    `SELECT count(*) c FROM orders WHERE ${last9} AND status IN ('paid','packed','dropped','collected')`,
    [phone],
  )
  const should = Math.floor(Number(paid.rows[0].c) / n)
  const have = await query<{ c: string }>('SELECT count(*) c FROM customer_coupons WHERE customer_id = $1', [customer.id])
  let haveN = Number(have.rows[0].c)
  while (haveN < should) {
    haveN++
    const code = 'DNL-' + Math.random().toString(36).slice(2, 8).toUpperCase()
    const ins = await query<{ id: number }>(
      'INSERT INTO coupons (code, percent, max_uses) VALUES ($1, $2, 1) RETURNING id',
      [code, pct],
    )
    await query(
      'INSERT INTO customer_coupons (customer_id, coupon_id, milestone) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [customer.id, ins.rows[0].id, haveN],
    )
    const chatId = toChatId(phone)
    if (chatId) {
      await enqueueSend({
        chatId,
        module: 'shop',
        kind: 'loyalty',
        payload: {
          type: 'text',
          text: `🎁 Asante for shopping with Dress Nation! You've earned a ${pct}% loyalty coupon: ${code}. Use it on your next order.`,
        },
      }).catch(() => {})
    }
  }
}

// Shape an order for the account view (same as the My-orders tracker).
export function accountOrder(o: Order) {
  return {
    dn: dnCode(o.id),
    status: statusIndex(o.status),
    rawStatus: o.status,
    total: o.total_ksh,
    del: o.delivery_option,
    at: o.created_at,
  }
}
