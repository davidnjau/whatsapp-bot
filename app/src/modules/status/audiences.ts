import { query } from '../../db.js'

export interface Audience {
  id: number
  name: string
  member_count?: number
}

export async function listAudiences(): Promise<Audience[]> {
  const res = await query<Audience>(
    `SELECT a.id, a.name, count(m.chat_id)::int AS member_count
     FROM audiences a LEFT JOIN audience_members m ON m.audience_id = a.id
     GROUP BY a.id ORDER BY a.name`,
  )
  return res.rows
}

export async function createAudience(name: string): Promise<number> {
  const res = await query<{ id: number }>(
    `INSERT INTO audiences (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name],
  )
  return res.rows[0].id
}

export async function addAudienceMembers(audienceId: number, chatIds: string[]): Promise<void> {
  for (const chatId of chatIds) {
    await query(
      `INSERT INTO audience_members (audience_id, chat_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [audienceId, chatId],
    )
  }
}

export async function deleteAudience(audienceId: number): Promise<void> {
  await query('DELETE FROM audiences WHERE id = $1', [audienceId])
}

export async function listAudienceMembers(audienceId: number): Promise<string[]> {
  const res = await query<{ chat_id: string }>(
    'SELECT chat_id FROM audience_members WHERE audience_id = $1 ORDER BY chat_id',
    [audienceId],
  )
  return res.rows.map((r) => r.chat_id)
}

// null → no audience restriction (WAHA default: all contacts)
export async function resolveAudience(audienceId: number | null): Promise<string[] | null> {
  if (!audienceId) return null
  return listAudienceMembers(audienceId)
}
