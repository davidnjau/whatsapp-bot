import { query } from '../../db.js'
import type { KeywordReply } from './logic.js'

export interface GroupSettings {
  group_id: string
  welcome_enabled: boolean
  welcome_text: string | null
  moderation_enabled: boolean
  keyword_replies: KeywordReply[]
  flag_links: boolean
}

const DEFAULTS: Omit<GroupSettings, 'group_id'> = {
  welcome_enabled: false,
  welcome_text: null,
  moderation_enabled: false,
  keyword_replies: [],
  flag_links: false,
}

export async function getGroupSettings(groupId: string): Promise<GroupSettings> {
  const res = await query<GroupSettings>('SELECT * FROM group_settings WHERE group_id = $1', [
    groupId,
  ])
  return res.rows[0] ?? { group_id: groupId, ...DEFAULTS }
}

export async function saveGroupSettings(settings: GroupSettings): Promise<void> {
  await query(
    `INSERT INTO group_settings (group_id, welcome_enabled, welcome_text, moderation_enabled, keyword_replies, flag_links, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (group_id) DO UPDATE SET
       welcome_enabled = EXCLUDED.welcome_enabled,
       welcome_text = EXCLUDED.welcome_text,
       moderation_enabled = EXCLUDED.moderation_enabled,
       keyword_replies = EXCLUDED.keyword_replies,
       flag_links = EXCLUDED.flag_links,
       updated_at = now()`,
    [
      settings.group_id,
      settings.welcome_enabled,
      settings.welcome_text,
      settings.moderation_enabled,
      JSON.stringify(settings.keyword_replies),
      settings.flag_links,
    ],
  )
}
