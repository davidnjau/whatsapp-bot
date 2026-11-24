import { query } from '../../db.js'
import { enqueueSend } from '../../queue/index.js'

export interface AnnouncementContent {
  type: 'text' | 'image' | 'file'
  text?: string
  file?: { url: string; mimetype?: string; filename?: string }
  caption?: string
}

export function buildAnnouncementContent(
  text: string,
  attachmentUrl: string,
  attachmentType: 'none' | 'image' | 'file',
): AnnouncementContent {
  if (attachmentType !== 'none' && attachmentUrl) {
    return { type: attachmentType, file: { url: attachmentUrl }, caption: text }
  }
  return { type: 'text', text }
}

// Sends go through the shared queue, so delivery is automatically throttled
// between groups by the global pacing delay.
export async function createAnnouncement(
  groupIds: string[],
  content: AnnouncementContent,
  sendAt?: Date,
): Promise<number> {
  const sendIds: number[] = []
  for (const groupId of groupIds) {
    sendIds.push(
      await enqueueSend({
        chatId: groupId,
        module: 'groups',
        kind: 'announcement',
        payload: content as unknown as Record<string, unknown>,
        sendAt,
      }),
    )
  }
  const inserted = await query<{ id: number }>(
    `INSERT INTO announcements (group_ids, content, send_ids, scheduled_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [JSON.stringify(groupIds), JSON.stringify(content), JSON.stringify(sendIds), sendAt ?? null],
  )
  return inserted.rows[0].id
}

export interface AnnouncementRow {
  id: number
  group_ids: string[]
  content: AnnouncementContent
  send_ids: number[]
  scheduled_at: Date | null
  created_at: Date
  statuses: Record<string, number>
}

export async function listAnnouncements(): Promise<AnnouncementRow[]> {
  const res = await query<Omit<AnnouncementRow, 'statuses'>>(
    'SELECT * FROM announcements ORDER BY created_at DESC LIMIT 20',
  )
  const rows: AnnouncementRow[] = []
  for (const row of res.rows) {
    const statuses: Record<string, number> = {}
    if (row.send_ids.length) {
      const counts = await query<{ status: string; count: string }>(
        'SELECT status, count(*) FROM sends WHERE id = ANY($1::bigint[]) GROUP BY status',
        [row.send_ids],
      )
      for (const c of counts.rows) statuses[c.status] = Number(c.count)
    }
    rows.push({ ...row, statuses })
  }
  return rows
}
