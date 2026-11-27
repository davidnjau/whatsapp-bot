import { query } from '../db.js'

export async function getSetting(key: string, def = ''): Promise<string> {
  const res = await query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [key])
  return res.rows[0]?.value ?? def
}

export async function setSetting(key: string, value: string): Promise<void> {
  await query(
    'INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [key, value],
  )
}

export async function getBool(key: string, def = false): Promise<boolean> {
  return (await getSetting(key, def ? 'true' : 'false')) === 'true'
}
