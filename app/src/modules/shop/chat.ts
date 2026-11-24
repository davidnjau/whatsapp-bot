import { config } from '../../config.js'
import { query } from '../../db.js'
import { log } from '../../logger.js'
import { enqueueSend } from '../../queue/index.js'
import { formatKsh, productName } from './label.js'
import { detectShopIntent, parseDeliveryOption, type DeliveryOption } from './chat-intent.js'
import { getProduct, listProducts } from './index.js'
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

async function sendCatalogue(chatId: string) {
  const products = (await listProducts('published')).slice(0, 10)
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
      `To order, reply "buy <number>" (e.g. buy ${products[0].id}).\n` +
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
      await clearSession(chatId)
      await reply(chatId, 'Order cancelled 👍 Niko hapa ukihitaji kitu kingine.')
      return true
    }
    return false
  }

  // Mid-flow: the next message is the answer to our current question.
  if (session) {
    return advanceSession(session, body, contactName, contactPhone)
  }

  if (intent.kind === 'catalogue') {
    await sendCatalogue(chatId)
    return true
  }

  if (intent.kind === 'buy') {
    const product = await getProduct(intent.productId)
    if (!product || product.status !== 'published') {
      await reply(
        chatId,
        `Pole, dress #${intent.productId} haipo available. Reply "catalogue" to see what's in stock. 💕`,
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
      `${productName(product)} — ${product.size ? `SIZE ${product.size}, ` : ''}${formatKsh(product.price_ksh ?? 0)} is available ✅\n` +
        `(Single piece, no refunds/exchanges — unaweza omba measurements/video kwanza.)\n\n` +
        `Let's arrange delivery. Which town/area are you in?`,
    )
    return true
  }

  return false
}

async function advanceSession(
  session: Session,
  body: string,
  contactName: string | null,
  contactPhone: string | null,
): Promise<boolean> {
  const chatId = session.chat_id
  const text = body.trim()

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
