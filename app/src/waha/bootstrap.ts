import { config } from '../config.js'
import { log } from '../logger.js'
import { waha } from './client.js'

const WEBHOOK_EVENTS = [
  'message.any',
  'message.ack',
  'session.status',
  'group.v2.join',
  'group.v2.leave',
  'group.v2.participants',
  'group.v2.update',
]

export async function ensureSession() {
  const existing = await waha.getSession()
  if (!existing) {
    await waha.createSession(config.wahaSession, {
      webhooks: [
        {
          url: config.wahaWebhookUrl,
          events: WEBHOOK_EVENTS,
          hmac: { key: config.webhookSecret },
          retries: { policy: 'exponential', delaySeconds: 2, attempts: 5 },
        },
      ],
    })
    log.info({ session: config.wahaSession }, 'WAHA session created — scan the QR in the admin panel')
    return
  }
  if (existing.status === 'FAILED') {
    // WAHA treats FAILED sessions as "already running" — start is a no-op, restart recovers.
    await waha.restartSession()
    log.info({ session: config.wahaSession }, 'WAHA session restarted after FAILED')
  } else if (existing.status === 'STOPPED') {
    await waha.startSession()
    log.info({ session: config.wahaSession }, 'WAHA session started')
  } else {
    log.info({ session: config.wahaSession, status: existing.status }, 'WAHA session present')
  }
}

// WAHA may boot slower than the app; keep trying in the background.
export function ensureSessionWithRetry() {
  void (async () => {
    for (;;) {
      try {
        await ensureSession()
        return
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'WAHA not reachable yet, retrying in 10s')
        await new Promise((r) => setTimeout(r, 10_000))
      }
    }
  })()
}
