import { query } from '../../db.js'

export interface Campaign {
  id: number
  name: string
  banner_type: 'text' | 'photo'
  headline: string | null
  subtext: string | null
  button_text: string | null
  button_link: string | null
  desktop_media_id: number | null
  mobile_media_id: number | null
  photo_alt: string | null
  bg_color: string
  text_color: string
  starts_at: Date
  ends_at: Date
  show_countdown: boolean
  whatsapp_message: string | null
  active: boolean
  created_at: Date
  updated_at: Date
}

export interface CampaignFields {
  name: string
  banner_type: 'text' | 'photo'
  headline: string | null
  subtext: string | null
  button_text: string | null
  button_link: string | null
  photo_alt: string | null
  bg_color: string
  text_color: string
  starts_at: Date
  ends_at: Date
  show_countdown: boolean
  whatsapp_message: string | null
  active: boolean
}

export type CampaignStatus = 'draft' | 'scheduled' | 'live' | 'ended'

export function campaignStatus(c: Campaign, now = new Date()): CampaignStatus {
  if (!c.active) return 'draft'
  if (now < new Date(c.starts_at)) return 'scheduled'
  if (now > new Date(c.ends_at)) return 'ended'
  return 'live'
}

export function isLive(c: Campaign, now = new Date()): boolean {
  return c.active && new Date(c.starts_at) <= now && new Date(c.ends_at) > now
}

export async function listCampaigns(): Promise<Campaign[]> {
  const res = await query<Campaign>('SELECT * FROM campaigns ORDER BY starts_at DESC')
  return res.rows
}

export async function getCampaign(id: number): Promise<Campaign | null> {
  const res = await query<Campaign>('SELECT * FROM campaigns WHERE id = $1', [id])
  return res.rows[0] ?? null
}

// The campaign to show right now. On overlap, the one that starts later wins.
export async function liveCampaign(): Promise<Campaign | null> {
  const res = await query<Campaign>(
    `SELECT * FROM campaigns WHERE active AND starts_at <= now() AND ends_at > now()
     ORDER BY starts_at DESC LIMIT 1`,
  )
  return res.rows[0] ?? null
}

const COLS = `name, banner_type, headline, subtext, button_text, button_link, photo_alt,
  bg_color, text_color, starts_at, ends_at, show_countdown, whatsapp_message, active`

function vals(f: CampaignFields): unknown[] {
  return [
    f.name, f.banner_type, f.headline, f.subtext, f.button_text, f.button_link, f.photo_alt,
    f.bg_color, f.text_color, f.starts_at, f.ends_at, f.show_countdown, f.whatsapp_message, f.active,
  ]
}

export async function createCampaign(f: CampaignFields): Promise<number> {
  const res = await query<{ id: number }>(
    `INSERT INTO campaigns (${COLS})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    vals(f),
  )
  return res.rows[0].id
}

export async function updateCampaign(id: number, f: CampaignFields): Promise<void> {
  await query(
    `UPDATE campaigns SET
       name=$2, banner_type=$3, headline=$4, subtext=$5, button_text=$6, button_link=$7, photo_alt=$8,
       bg_color=$9, text_color=$10, starts_at=$11, ends_at=$12, show_countdown=$13, whatsapp_message=$14,
       active=$15, updated_at=now()
     WHERE id=$1`,
    [id, ...vals(f)],
  )
}

export async function setCampaignActive(id: number, active: boolean): Promise<void> {
  await query('UPDATE campaigns SET active=$2, updated_at=now() WHERE id=$1', [id, active])
}

export async function deleteCampaign(id: number): Promise<void> {
  await query('DELETE FROM campaigns WHERE id=$1', [id])
}

// Copy a campaign (optionally with new dates). Returns the new id.
export async function duplicateCampaign(id: number, startsAt?: Date, endsAt?: Date): Promise<number | null> {
  const c = await getCampaign(id)
  if (!c) return null
  const res = await query<{ id: number }>(
    `INSERT INTO campaigns (${COLS}, desktop_media_id, mobile_media_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [
      `${c.name} (copy)`, c.banner_type, c.headline, c.subtext, c.button_text, c.button_link, c.photo_alt,
      c.bg_color, c.text_color, startsAt ?? c.starts_at, endsAt ?? c.ends_at, c.show_countdown,
      c.whatsapp_message, c.active, c.desktop_media_id, c.mobile_media_id,
    ],
  )
  return res.rows[0].id
}

// --- photos (set current + keep history) ---
export async function setCampaignPhoto(
  campaignId: number,
  desktopMediaId: number,
  mobileMediaId: number | null,
): Promise<void> {
  await query('UPDATE campaigns SET desktop_media_id=$2, mobile_media_id=$3, updated_at=now() WHERE id=$1', [
    campaignId,
    desktopMediaId,
    mobileMediaId,
  ])
  await query(
    'INSERT INTO campaign_photos (campaign_id, desktop_media_id, mobile_media_id) VALUES ($1,$2,$3)',
    [campaignId, desktopMediaId, mobileMediaId],
  )
}

export interface CampaignPhoto {
  id: number
  desktop_media_id: number
  mobile_media_id: number | null
  created_at: Date
}

export async function listCampaignPhotos(campaignId: number): Promise<CampaignPhoto[]> {
  const res = await query<CampaignPhoto>(
    'SELECT id, desktop_media_id, mobile_media_id, created_at FROM campaign_photos WHERE campaign_id=$1 ORDER BY created_at DESC',
    [campaignId],
  )
  return res.rows
}

// Switch the current photo back to an earlier history entry.
export async function restoreCampaignPhoto(campaignId: number, photoId: number): Promise<void> {
  const res = await query<CampaignPhoto>(
    'SELECT desktop_media_id, mobile_media_id FROM campaign_photos WHERE id=$1 AND campaign_id=$2',
    [photoId, campaignId],
  )
  const p = res.rows[0]
  if (!p) return
  await query('UPDATE campaigns SET desktop_media_id=$2, mobile_media_id=$3, updated_at=now() WHERE id=$1', [
    campaignId,
    p.desktop_media_id,
    p.mobile_media_id,
  ])
}

// Public banner payload for the live-campaign endpoint.
export function bannerDTO(c: Campaign) {
  const img = (id: number | null) => (id ? `/shop/media/${id}` : null)
  return {
    id: c.id,
    type: c.banner_type,
    headline: c.headline,
    subtext: c.subtext,
    buttonText: c.button_text,
    buttonLink: c.button_link,
    desktop: img(c.desktop_media_id),
    mobile: img(c.mobile_media_id),
    alt: c.photo_alt || c.name,
    bg: c.bg_color,
    text: c.text_color,
    endsAt: new Date(c.ends_at).toISOString(),
    countdown: c.show_countdown,
    wa: c.whatsapp_message || '',
  }
}
