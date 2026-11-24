import { query } from '../../db.js'

export { listVariables, renderTemplate } from './render.js'

export interface Template {
  id: number
  name: string
  body: string
  updated_at: Date
}

export async function getTemplate(name: string): Promise<Template | null> {
  const res = await query<Template>('SELECT * FROM templates WHERE name = $1', [name])
  return res.rows[0] ?? null
}

export async function listTemplates(): Promise<Template[]> {
  const res = await query<Template>('SELECT * FROM templates ORDER BY name')
  return res.rows
}

export async function upsertTemplate(name: string, body: string): Promise<void> {
  await query(
    `INSERT INTO templates (name, body) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`,
    [name, body],
  )
}
