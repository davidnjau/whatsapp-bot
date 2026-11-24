import { query } from './db.js'

export interface Contact {
  chat_id: string
  phone: string | null
  name: string | null
  opted_in: boolean
}

export async function upsertContact(
  chatId: string,
  name: string | null,
  phone: string | null,
): Promise<Contact> {
  const res = await query<Contact>(
    `INSERT INTO contacts (chat_id, phone, name, opt_in_source)
     VALUES ($1, $2, $3, 'inbound')
     ON CONFLICT (chat_id)
     DO UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name),
                   phone = COALESCE(EXCLUDED.phone, contacts.phone)
     RETURNING chat_id, phone, name, opted_in`,
    [chatId, phone, name],
  )
  return res.rows[0]
}

export async function setOptIn(chatId: string, optedIn: boolean) {
  await query(
    `UPDATE contacts
     SET opted_in = $2, opted_out_at = CASE WHEN $2 THEN NULL ELSE now() END
     WHERE chat_id = $1`,
    [chatId, optedIn],
  )
}

export async function getContact(chatId: string): Promise<Contact | null> {
  const res = await query<Contact>(
    'SELECT chat_id, phone, name, opted_in FROM contacts WHERE chat_id = $1',
    [chatId],
  )
  return res.rows[0] ?? null
}
