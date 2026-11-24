import nodemailer from 'nodemailer'
import { config } from '../config.js'
import { log } from '../logger.js'
import { toChatId } from '../lib/phone.js'
import { enqueueSend } from '../queue/index.js'

const ALERT_COOLDOWN_MS = 15 * 60 * 1000
let lastAlertAt = 0

export async function sendAlert(text: string) {
  const now = Date.now()
  if (now - lastAlertAt < ALERT_COOLDOWN_MS) return
  lastAlertAt = now
  log.warn({ alert: text }, 'sending alert')

  if (config.alertWhatsappNumber) {
    const chatId = toChatId(config.alertWhatsappNumber)
    if (chatId) {
      await enqueueSend({
        chatId,
        module: 'system',
        kind: 'alert',
        payload: { type: 'text', text: `⚠️ ${text}` },
      }).catch((err) => log.error({ err: err.message }, 'failed to queue WhatsApp alert'))
    }
  }

  if (config.smtpHost && config.alertEmail) {
    try {
      const transport = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        auth: config.smtpUser
          ? { user: config.smtpUser, pass: config.smtpPassword }
          : undefined,
      })
      await transport.sendMail({
        from: config.smtpUser || 'whatsapp-bot@localhost',
        to: config.alertEmail,
        subject: 'WhatsApp bot alert',
        text,
      })
    } catch (err) {
      log.error({ err: (err as Error).message }, 'email alert failed')
    }
  }
}
