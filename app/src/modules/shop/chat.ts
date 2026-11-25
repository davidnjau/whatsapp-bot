import { config } from '../../config.js'
import { query } from '../../db.js'
import { log } from '../../logger.js'
import { enqueueSend } from '../../queue/index.js'
import { formatKsh, productName } from './label.js'
import { detectShopIntent, parseDeliveryOption, type DeliveryOption } from './chat-intent.js'
import { getProduct } from './index.js'
import { listAvailable, releaseReservation, reserveProduct } from './reservations.js'
import { createDirectOrder } from './orders.js'

interface Session {
  chat_id: string
  state: 'awaiting_town' | 'awaiting_delivery' | 'awaiting_location'
  product_id: number | null
  town: string | null
  delivery_option: string | null
}

async function getSession(chatId: string): Promise<Session | null> {
  const res = await query<Session>('SELECT * FROM chat_shop_sessions WHERE chat_id = $1', [chatId])
  return res.rows[0] ?? null
}

async function setSession(s: Session): Promise<void> {
  await query(
    `INSERT INTO chat_shop_sessions (chat_id, state, product_id, town, delivery_option, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (chat_id) DO UPDATE SET
       state = EXCLUDED.state, product_id = EXCLUDED.product_id,
       town = EXCLUDED.town, delivery_option = EXCLUDED.delivery_option, updated_at = now()`,
    [s.chat_id, s.state, s.product_id, s.town, s.delivery_option],
  )
}

async function clearSession(chatId: string): Promise<void> {
  await query('DELETE FROM chat_shop_sessions WHERE chat_id = $1', [chatId])
}

function reply(chatId: string, text: string) {
  return enqueueSend({ chatId, module: 'shop', kind: 'order_chat', payload: { type: 'text', text, typing: true } })
}

// Exported so the support menu (reply "1") can show the catalogue too.
export async function sendCatalogueTo(chatId: string) {
  const products = (await listAvailable(chatId)).slice(0, 10)
  if (products.length === 0) {
    await reply(chatId, 'Hakuna dresses available kwa sasa — check back soon! 💕 Or see the shop: ' + `${config.appBaseUrl}/shop`)
    return
  }
  const lines = products.map(
    (p) => `#${p.id} — ${p.size ? `SIZE ${p.size}, ` : ''}${formatKsh(p.price_ksh ?? 0)}`,
  )
  await reply(
    chatId,
    `Here's what's available 💃\n${lines.join('\n')}\n\n` +
      `Reply with a dress number to reserve it (e.g. #${products[0].id}), or "mine".\n` +
      `See photos & more: ${config.appBaseUrl}/shop`,
  )
}

// Returns true if the shop flow consumed the message (support bot should stop).
export async function handleShopMessage(
  chatId: string,
  body: string,
  contactName: string | null,
  contactPhone: string | null,
): Promise<boolean> {
  const session = await getSession(chatId)
  const intent = detectShopIntent(body)

  if (intent.kind === 'cancel') {
    if (session) {
      if (session.product_id) await releaseReservation(session.product_id, chatId)
      await clearSession(chatId)
      await reply(chatId, 'Order cancelled 👍 Dress imerudishwa. Niko hapa ukihitaji kitu kingine.')
      return true
    }
    return false
  }

  // Mid-flow: the next message is the answer to our current question.
  if (session) {
    return advanceSession(session, body, contactName, contactPhone)
  }

  if (intent.kind === 'catalogue') {
    await sendCatalogueTo(chatId)
    return true
  }

  if (intent.kind === 'reserve_prompt') {
    const available = await listAvailable(chatId)
    if (available.length === 1) {
      return startOrder(chatId, available[0].id)
    }
    await reply(chatId, 'Which dress would you like? Reply with its number, e.g. #21. 🙂')
    return true
  }

  if (intent.kind === 'buy') {
    return startOrder(chatId, intent.productId)
  }

  return false
}

// Reserve the dress (3-min hold) and begin the delivery questions.
async function startOrder(chatId: string, productId: number): Promise<boolean> {
  const product = await getProduct(productId)
  if (!product || product.status !== 'published') {
    await reply(
      chatId,
      `Pole, dress #${productId} haipo available. Reply "catalogue" to see what's in stock. 💕`,
    )
    return true
  }
  const held = await reserveProduct(productId, chatId)
  if (!held) {
    await reply(
      chatId,
      `Pole, dress #${productId} imeshikwa na mtu mwingine kwa sasa 😔 (each piece is unique). ` +
        `Reply "catalogue" to see what's still available.`,
    )
    return true
  }
  await setSession({
    chat_id: chatId,
    state: 'awaiting_town',
    product_id: product.id,
    town: null,
    delivery_option: null,
  })
  await reply(
    chatId,
    `${productName(product)} — ${product.size ? `SIZE ${product.size}, ` : ''}${formatKsh(product.price_ksh ?? 0)} is yours to reserve ✅\n` +
      `I'll hold it for you for ${config.shopReserveMinutes} min while we sort delivery.\n` +
      `(Single piece, no refunds/exchanges — unaweza omba measurements/video kwanza.)\n\n` +
      `Which town/area are you in?`,
  )
  return true
}

async function advanceSession(
  session: Session,
  body: string,
  contactName: string | null,
  contactPhone: string | null,
): Promise<boolean> {
  const chatId = session.chat_id
  const text = body.trim()

  // Keep the hold alive while they're actively answering. If it lapsed and
  // someone else grabbed the dress, stop cleanly.
  if (session.product_id && !(await reserveProduct(session.product_id, chatId))) {
    await clearSession(chatId)
    await reply(
      chatId,
      `Pole — that dress was just reserved by someone else 😔 Reply "catalogue" to see what's still available.`,
    )
    return true
  }

  if (session.state === 'awaiting_town') {
    if (text.length < 2) {
      await reply(chatId, 'Tuambie town/area yako (e.g. Nairobi, Eldoret) ili tuconfirm delivery. 🙏')
      return true
    }
    await setSession({ ...session, state: 'awaiting_delivery', town: text })
    await reply(
      chatId,
      `Sawa, ${text} ✅ How do you want delivery?\n` +
        `1 — Pickup Mtaani agent (cheapest, collect near you)\n` +
        `2 — Doorstep (rider to your door)\n` +
        `3 — Upcountry via SACCO/courier (e.g. Easy Coach, 2NK)\n` +
        `Reply 1, 2 or 3.`,
    )
    return true
  }

  if (session.state === 'awaiting_delivery') {
    const option = parseDeliveryOption(text)
    if (!option) {
      await reply(chatId, 'Reply 1 (agent), 2 (doorstep) or 3 (upcountry) for delivery. 🙂')
      return true
    }
    await setSession({ ...session, state: 'awaiting_location', delivery_option: option })
    const prompt: Record<DeliveryOption, string> = {
      agent: 'Which Pickup Mtaani agent/stage is nearest you? (e.g. "Roysambu, TRM stage")',
      doorstep: 'What delivery address should the rider use? (building/estate + landmark)',
      errand: 'Which SACCO/courier and town should we send it through? (e.g. "Easy Coach, Eldoret")',
    }
    await reply(chatId, prompt[option])
    return true
  }

  if (session.state === 'awaiting_location') {
    if (text.length < 2) {
      await reply(chatId, 'Please share the pickup point / address so we can arrange delivery. 🙏')
      return true
    }
    if (!session.product_id || !session.town || !session.delivery_option) {
      await clearSession(chatId)
      return false
    }
    try {
      const order = await createDirectOrder(session.product_id, {
        name: contactName || 'WhatsApp customer',
        phone: contactPhone || chatId.split('@')[0].split(':')[0],
        town: session.town,
        deliveryOption: session.delivery_option as DeliveryOption,
        deliveryLocation: text,
      })
      await clearSession(chatId)
      await reply(
        chatId,
        `Order #${order.id} created! 🎉 Total ${formatKsh(order.total_ksh)} (delivery fee separate, we'll confirm it).\n\n` +
          `Pay here to confirm your dress 👉 ${config.appBaseUrl}/shop/pay/${order.id}/${order.access_token}\n\n` +
          `Once paid we'll pack it and send your Pickup Mtaani tracking code. No refunds/exchanges — asante! 💃`,
      )
      log.info({ chatId, orderId: order.id }, 'whatsapp order created')
    } catch (err) {
      await clearSession(chatId)
      await reply(chatId, `Pole — ${(err as Error).message} Reply "catalogue" to see what's still available.`)
    }
    return true
  }

  return false
}
