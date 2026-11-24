import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pool } from './db.js'
import { log } from './logger.js'

const MIGRATION_LOCK = 727274

export async function runMigrations(dir = path.resolve('migrations')) {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK])
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    )
    const applied = new Set(
      (await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    )
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(path.join(dir, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        log.info({ file }, 'migration applied')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {})
    client.release()
  }
}
