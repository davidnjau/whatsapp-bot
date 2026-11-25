import { config } from './config.js'
import { log } from './logger.js'
import { runMigrations } from './migrate.js'
import { startQueue } from './queue/index.js'
import { scheduleWatchdog } from './alerts/watchdog.js'
import { registerRecurringStatuses } from './modules/status/index.js'
import { seedReferenceDresses } from './modules/shop/seed.js'
import { ensureSessionWithRetry } from './waha/bootstrap.js'
import { buildApp } from './app.js'

async function main() {
  await runMigrations()
  if (process.env.SEED_REFERENCE_DRESSES !== 'false') {
    await seedReferenceDresses().catch((err) => log.warn({ err: err.message }, 'dress seed failed'))
  }
  await startQueue()
  await scheduleWatchdog()
  await registerRecurringStatuses()
  const app = buildApp()
  await app.listen({ port: config.appPort, host: '0.0.0.0' })
  ensureSessionWithRetry()
  log.info({ port: config.appPort }, 'app started')
}

main().catch((err) => {
  log.error(err, 'fatal startup error')
  process.exit(1)
})
