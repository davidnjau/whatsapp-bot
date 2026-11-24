import { config } from '../config.js'
import { log } from '../logger.js'
import { waha } from '../waha/client.js'
import { boss } from '../queue/index.js'
import { sendAlert } from './index.js'

const WATCHDOG_QUEUE = 'watchdog-check'

export async function scheduleWatchdog() {
  await boss.createQueue(WATCHDOG_QUEUE, { name: WATCHDOG_QUEUE })
  await boss.work(WATCHDOG_QUEUE, async () => {
    await checkSession()
  })
  await boss.schedule(WATCHDOG_QUEUE, '*/5 * * * *', {}, { tz: config.tz })
  log.info('session watchdog scheduled (every 5 min)')
}

export async function checkSession() {
  try {
    const session = await waha.getSession()
    const status = session?.status ?? 'MISSING'
    if (status !== 'WORKING') {
      await sendAlert(
        `WhatsApp session "${config.wahaSession}" is ${status}. ` +
          `Open the admin panel to relink: ${config.appBaseUrl}/admin`,
      )
    }
  } catch (err) {
    await sendAlert(`Cannot reach WAHA: ${(err as Error).message}`)
  }
}
