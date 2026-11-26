import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { query } from '../db.js'
import { resizeWebp } from '../lib/images.js'
import { saveMedia } from '../modules/status/media.js'
import {
  bannerDTO,
  campaignStatus,
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  getCampaign,
  listCampaignPhotos,
  listCampaigns,
  restoreCampaignPhoto,
  setCampaignActive,
  setCampaignPhoto,
  updateCampaign,
  type CampaignFields,
} from '../modules/shop/campaigns.js'
import { requireWebAuth } from './auth.js'

const clean = (s: unknown): string | null => (typeof s === 'string' && s.trim() ? s.trim() : null)

function parseFields(body: Record<string, string>): { fields?: CampaignFields; error?: string } {
  const name = (body.name || '').trim()
  const starts = new Date(body.starts)
  const ends = new Date(body.ends)
  if (!name) return { error: 'Campaign name is required.' }
  if (isNaN(starts.getTime()) || isNaN(ends.getTime())) return { error: 'Start and end date/time are required.' }
  if (ends <= starts) return { error: 'End must be after the start.' }
  return {
    fields: {
      name,
      banner_type: body.banner_type === 'photo' ? 'photo' : 'text',
      headline: clean(body.headline),
      subtext: clean(body.subtext),
      button_text: clean(body.button_text),
      button_link: clean(body.button_link),
      photo_alt: clean(body.photo_alt),
      bg_color: body.bg_color || '#faf9f5',
      text_color: body.text_color || '#2b2724',
      starts_at: starts,
      ends_at: ends,
      show_countdown: body.show_countdown === 'on',
      whatsapp_message: clean(body.whatsapp_message),
      active: body.active === 'on',
    },
  }
}

async function overlapWarning(starts: Date, ends: Date, excludeId = 0): Promise<string> {
  const res = await query<{ name: string }>(
    'SELECT name FROM campaigns WHERE active AND id <> $3 AND starts_at < $2 AND ends_at > $1 ORDER BY starts_at DESC LIMIT 1',
    [starts, ends, excludeId],
  )
  return res.rows[0] ? ` (Note: overlaps "${res.rows[0].name}" — the later-starting one shows.)` : ''
}

const ok = /^image\/(jpeg|png|webp)$/

export const adminCampaignRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWebAuth)

  app.get<{ Querystring: { message?: string } }>('/admin/campaigns', async (req, reply) => {
    const campaigns = (await listCampaigns()).map((c) => ({ ...c, _status: campaignStatus(c) }))
    return reply.view('campaigns.njk', { authed: true, campaigns, message: req.query.message ?? null })
  })

  app.get('/admin/campaigns/new', async (_req, reply) => {
    return reply.view('campaign_edit.njk', { authed: true, campaign: null, photos: [] })
  })

  app.get<{ Params: { id: string } }>('/admin/campaigns/:id/edit', async (req, reply) => {
    const campaign = await getCampaign(Number(req.params.id))
    if (!campaign) return reply.redirect('/admin/campaigns?message=Not found')
    return reply.view('campaign_edit.njk', {
      authed: true,
      campaign,
      photos: await listCampaignPhotos(campaign.id),
    })
  })

  app.post('/admin/campaigns', async (req, reply) => {
    const parsed = parseFields((req.body ?? {}) as Record<string, string>)
    if (!parsed.fields) return reply.redirect(`/admin/campaigns?message=${encodeURIComponent(parsed.error!)}`)
    const id = await createCampaign(parsed.fields)
    const warn = await overlapWarning(parsed.fields.starts_at, parsed.fields.ends_at, id)
    return reply.redirect(`/admin/campaigns/${id}/edit?message=${encodeURIComponent('Campaign saved.' + warn)}`)
  })

  app.post<{ Params: { id: string } }>('/admin/campaigns/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const parsed = parseFields((req.body ?? {}) as Record<string, string>)
    if (!parsed.fields) return reply.redirect(`/admin/campaigns/${id}/edit?message=${encodeURIComponent(parsed.error!)}`)
    await updateCampaign(id, parsed.fields)
    const warn = await overlapWarning(parsed.fields.starts_at, parsed.fields.ends_at, id)
    return reply.redirect(`/admin/campaigns/${id}/edit?message=${encodeURIComponent('Saved.' + warn)}`)
  })

  app.post<{ Params: { id: string }; Body: { active?: string } }>('/admin/campaigns/:id/toggle', async (req, reply) => {
    await setCampaignActive(Number(req.params.id), (req.body as { active?: string })?.active === 'on')
    return reply.redirect('/admin/campaigns?message=Updated')
  })

  app.post<{ Params: { id: string } }>('/admin/campaigns/:id/delete', async (req, reply) => {
    await deleteCampaign(Number(req.params.id))
    return reply.redirect('/admin/campaigns?message=Campaign deleted')
  })

  app.post<{ Params: { id: string } }>('/admin/campaigns/:id/duplicate', async (req, reply) => {
    const newId = await duplicateCampaign(Number(req.params.id))
    return newId
      ? reply.redirect(`/admin/campaigns/${newId}/edit?message=Duplicated - edit the copy`)
      : reply.redirect('/admin/campaigns?message=Not found')
  })

  // Reuse with new dates (e.g. Christmas every year).
  app.post<{ Params: { id: string }; Body: { starts?: string; ends?: string } }>(
    '/admin/campaigns/:id/reuse',
    async (req, reply) => {
      const b = req.body as { starts?: string; ends?: string }
      const starts = new Date(b.starts || '')
      const ends = new Date(b.ends || '')
      if (isNaN(starts.getTime()) || isNaN(ends.getTime()) || ends <= starts) {
        return reply.redirect('/admin/campaigns?message=Enter valid new dates (end after start)')
      }
      const newId = await duplicateCampaign(Number(req.params.id), starts, ends)
      return newId
        ? reply.redirect(`/admin/campaigns/${newId}/edit?message=Reused with new dates`)
        : reply.redirect('/admin/campaigns?message=Not found')
    },
  )

  // Change / add the photo (keeps history). Accepts desktop (required) + mobile.
  app.post<{ Params: { id: string } }>('/admin/campaigns/:id/photo', async (req, reply) => {
    const id = Number(req.params.id)
    let desktopBuf: Buffer | null = null
    let mobileBuf: Buffer | null = null
    try {
      for await (const part of req.parts()) {
        if (part.type !== 'file') continue
        const mime = part.mimetype || ''
        const buf = await part.toBuffer()
        if (!ok.test(mime) || buf.length > 5 * 1024 * 1024) continue
        if (part.fieldname === 'desktop') desktopBuf = buf
        else if (part.fieldname === 'mobile') mobileBuf = buf
      }
    } catch {
      /* ignore */
    }
    if (!desktopBuf) return reply.redirect(`/admin/campaigns/${id}/edit?message=Add a desktop photo (JPG/PNG/WebP, max 5MB)`)
    // Resize to a desktop (1600px) and mobile (800px) WebP; mobile falls back to
    // the desktop upload if none was given.
    const desktop = await saveMedia('banner.webp', 'image/webp', await resizeWebp(desktopBuf, 1600))
    const mobile = await saveMedia('banner-m.webp', 'image/webp', await resizeWebp(mobileBuf ?? desktopBuf, 800))
    await setCampaignPhoto(id, desktop.id, mobile.id)
    return reply.redirect(`/admin/campaigns/${id}/edit?message=Photo updated`)
  })

  app.post<{ Params: { id: string; photoId: string } }>(
    '/admin/campaigns/:id/photo/:photoId/restore',
    async (req, reply) => {
      await restoreCampaignPhoto(Number(req.params.id), Number(req.params.photoId))
      return reply.redirect(`/admin/campaigns/${req.params.id}/edit?message=Switched to that photo`)
    },
  )

  // Preview the banner exactly as customers see it (desktop + phone).
  app.get<{ Params: { id: string } }>('/admin/campaigns/:id/preview', async (req, reply) => {
    const campaign = await getCampaign(Number(req.params.id))
    if (!campaign) return reply.redirect('/admin/campaigns?message=Not found')
    return reply.view('campaign_preview.njk', { authed: true, c: bannerDTO(campaign), name: campaign.name })
  })
}
