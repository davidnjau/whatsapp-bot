import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { toChatId } from '../lib/phone.js'
import { waha } from '../waha/client.js'
import { buildAnnouncementContent, createAnnouncement, listAnnouncements } from '../modules/groups/announcements.js'
import { extractAdminIds, formatKeywordReplies, parseKeywordReplies, phoneFromId } from '../modules/groups/logic.js'
import { getGroupSettings, saveGroupSettings } from '../modules/groups/settings.js'
import { requireWebAuth } from './auth.js'

interface GroupSummary {
  id: string
  name: string
  participantCount: number | null
}

function summarizeGroup(raw: Record<string, any>): GroupSummary | null {
  const id =
    typeof raw.id === 'string' ? raw.id : typeof raw.id?._serialized === 'string' ? raw.id._serialized : null
  if (!id) return null
  return {
    id,
    name: raw.subject ?? raw.name ?? id,
    participantCount: Array.isArray(raw.participants) ? raw.participants.length : null,
  }
}

async function fetchGroups(): Promise<GroupSummary[]> {
  const raw = await waha.getGroups()
  return (raw as Record<string, any>[]).map(summarizeGroup).filter((g): g is GroupSummary => !!g)
}

export const adminGroupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWebAuth)

  app.get('/admin/groups', async (_req, reply) => {
    let groups: GroupSummary[] = []
    let error: string | null = null
    try {
      groups = await fetchGroups()
    } catch (err) {
      error = `Could not load groups from WAHA: ${(err as Error).message}`
    }
    return reply.view('groups.njk', { authed: true, groups, error })
  })

  app.get<{ Params: { groupId: string } }>('/admin/groups/:groupId', async (req, reply) => {
    const groupId = req.params.groupId
    const [settings, participantsRaw] = await Promise.all([
      getGroupSettings(groupId),
      waha.getParticipants(groupId).catch(() => []),
    ])
    const participants = (participantsRaw as Record<string, any>[])
      .map((p) => (typeof p.id === 'string' ? p : { ...p, id: p.id?._serialized }))
      .filter((p) => typeof p.id === 'string')
    const adminIds = new Set(extractAdminIds(participants))
    let inviteLink: string | null = null
    try {
      const code = await waha.getInviteCode(groupId)
      const value = typeof code === 'string' ? code : ((code as any)?.code ?? (code as any)?.inviteCode)
      if (typeof value === 'string') {
        inviteLink = value.startsWith('http') ? value : `https://chat.whatsapp.com/${value}`
      }
    } catch {
      // not an admin of this group, or engine refuses — leave null
    }
    return reply.view('group.njk', {
      authed: true,
      groupId,
      settings: { ...settings, keyword_replies_text: formatKeywordReplies(settings.keyword_replies) },
      participants: participants.map((p) => ({
        id: p.id,
        phone: phoneFromId(p.id),
        isAdmin: adminIds.has(p.id),
      })),
      inviteLink,
      message: (req.query as any)?.message ?? null,
    })
  })

  app.post<{ Params: { groupId: string } }>('/admin/groups/:groupId/settings', async (req, reply) => {
    const form = z
      .object({
        welcome_enabled: z.string().optional(),
        welcome_text: z.string().default(''),
        moderation_enabled: z.string().optional(),
        keyword_replies: z.string().default(''),
        flag_links: z.string().optional(),
      })
      .parse(req.body ?? {})
    await saveGroupSettings({
      group_id: req.params.groupId,
      welcome_enabled: form.welcome_enabled === 'on',
      welcome_text: form.welcome_text.trim() || null,
      moderation_enabled: form.moderation_enabled === 'on',
      keyword_replies: parseKeywordReplies(form.keyword_replies),
      flag_links: form.flag_links === 'on',
    })
    return reply.redirect(`/admin/groups/${encodeURIComponent(req.params.groupId)}?message=Settings saved`)
  })

  app.post<{ Params: { groupId: string } }>('/admin/groups/:groupId/participants', async (req, reply) => {
    const form = z
      .object({ action: z.enum(['add', 'remove', 'promote', 'demote']), phone: z.string() })
      .parse(req.body ?? {})
    const participantId = form.phone.endsWith('@c.us') ? form.phone : toChatId(form.phone)
    const groupId = req.params.groupId
    let message = ''
    if (!participantId) {
      message = 'Invalid phone number'
    } else {
      try {
        if (form.action === 'add') await waha.addParticipants(groupId, [participantId])
        if (form.action === 'remove') await waha.removeParticipants(groupId, [participantId])
        if (form.action === 'promote') await waha.promoteAdmins(groupId, [participantId])
        if (form.action === 'demote') await waha.demoteAdmins(groupId, [participantId])
        message = `${form.action} ok`
      } catch (err) {
        message = `${form.action} failed: ${(err as Error).message.slice(0, 120)}`
      }
    }
    return reply.redirect(
      `/admin/groups/${encodeURIComponent(groupId)}?message=${encodeURIComponent(message)}`,
    )
  })

  app.post<{ Params: { groupId: string } }>('/admin/groups/:groupId/invite/revoke', async (req, reply) => {
    await waha.revokeInviteCode(req.params.groupId).catch(() => {})
    return reply.redirect(`/admin/groups/${encodeURIComponent(req.params.groupId)}?message=Invite link revoked`)
  })

  app.post<{ Params: { groupId: string } }>('/admin/groups/:groupId/leave', async (req, reply) => {
    await waha.leaveGroup(req.params.groupId)
    return reply.redirect('/admin/groups')
  })

  // --- announcements ---
  app.get('/admin/announcements', async (_req, reply) => {
    const [groups, history] = await Promise.all([
      fetchGroups().catch(() => [] as GroupSummary[]),
      listAnnouncements(),
    ])
    return reply.view('announcements.njk', { authed: true, groups, history, error: null, queued: null })
  })

  app.post('/admin/announcements', async (req, reply) => {
    const form = z
      .object({
        groupIds: z.union([z.string(), z.array(z.string())]).optional(),
        text: z.string().min(1),
        attachmentUrl: z.string().default(''),
        attachmentType: z.enum(['none', 'image', 'file']).default('none'),
        sendAt: z.string().default(''),
      })
      .parse(req.body ?? {})
    const groupIds = (Array.isArray(form.groupIds) ? form.groupIds : [form.groupIds]).filter(
      (g): g is string => !!g,
    )
    const [groups, history] = await Promise.all([
      fetchGroups().catch(() => [] as GroupSummary[]),
      listAnnouncements(),
    ])
    if (groupIds.length === 0) {
      return reply.view('announcements.njk', {
        authed: true, groups, history, queued: null, error: 'Pick at least one group.',
      })
    }
    const sendAt = form.sendAt ? new Date(form.sendAt) : undefined
    if (sendAt && Number.isNaN(sendAt.getTime())) {
      return reply.view('announcements.njk', {
        authed: true, groups, history, queued: null, error: 'Invalid schedule time.',
      })
    }
    const content = buildAnnouncementContent(form.text, form.attachmentUrl.trim(), form.attachmentType)
    const id = await createAnnouncement(groupIds, content, sendAt)
    const refreshed = await listAnnouncements()
    return reply.view('announcements.njk', {
      authed: true, groups, history: refreshed, error: null,
      queued: { id, count: groupIds.length, scheduled: !!sendAt },
    })
  })
}
