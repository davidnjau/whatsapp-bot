import { config } from '../config.js'

export class WahaError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'WahaError'
  }
}

export interface WahaFile {
  mimetype?: string
  filename?: string
  url?: string
  data?: string
}

type Json = Record<string, unknown>

class WahaClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private session: string,
  ) {}

  private async request<T>(method: string, path: string, body?: Json): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'X-Api-Key': this.apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new WahaError(res.status, `WAHA ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`)
    }
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  // --- sessions ---
  async getSession(name = this.session): Promise<{ status: string; config?: Json } | null> {
    try {
      return await this.request('GET', `/api/sessions/${name}`)
    } catch (err) {
      if (err instanceof WahaError && err.status === 404) return null
      throw err
    }
  }

  createSession(name: string, sessionConfig: Json) {
    return this.request('POST', '/api/sessions', { name, start: true, config: sessionConfig })
  }

  startSession(name = this.session) {
    return this.request('POST', `/api/sessions/${name}/start`)
  }

  restartSession(name = this.session) {
    return this.request('POST', `/api/sessions/${name}/restart`)
  }

  logoutSession(name = this.session) {
    return this.request('POST', `/api/sessions/${name}/logout`)
  }

  getMe(name = this.session): Promise<{ id?: string; pushName?: string } | null> {
    return this.request('GET', `/api/sessions/${name}/me`)
  }

  async getQrPng(name = this.session): Promise<Buffer> {
    const res = await fetch(`${this.baseUrl}/api/${name}/auth/qr?format=image`, {
      headers: { 'X-Api-Key': this.apiKey, Accept: 'image/png' },
    })
    if (!res.ok) {
      throw new WahaError(res.status, `WAHA QR → ${res.status}`)
    }
    return Buffer.from(await res.arrayBuffer())
  }

  // --- messaging (all go through the send queue, never call directly from modules) ---
  sendText(chatId: string, text: string) {
    return this.request<Json>('POST', '/api/sendText', { session: this.session, chatId, text })
  }

  sendImage(chatId: string, file: WahaFile, caption?: string) {
    return this.request<Json>('POST', '/api/sendImage', { session: this.session, chatId, file, caption })
  }

  sendFile(chatId: string, file: WahaFile, caption?: string) {
    return this.request<Json>('POST', '/api/sendFile', { session: this.session, chatId, file, caption })
  }

  sendVoice(chatId: string, file: WahaFile, convert = true) {
    return this.request<Json>('POST', '/api/sendVoice', { session: this.session, chatId, file, convert })
  }

  sendVideo(chatId: string, file: WahaFile, caption?: string, convert = true) {
    return this.request<Json>('POST', '/api/sendVideo', { session: this.session, chatId, file, caption, convert })
  }

  // --- groups ---
  getGroups(): Promise<Json[]> {
    return this.request('GET', `/api/${this.session}/groups`)
  }

  createGroup(name: string, participantIds: string[]) {
    return this.request('POST', `/api/${this.session}/groups`, {
      name,
      participants: participantIds.map((id) => ({ id })),
    })
  }

  getGroup(groupId: string): Promise<Json> {
    return this.request('GET', `/api/${this.session}/groups/${encodeURIComponent(groupId)}`)
  }

  leaveGroup(groupId: string) {
    return this.request('POST', `/api/${this.session}/groups/${encodeURIComponent(groupId)}/leave`)
  }

  setGroupSubject(groupId: string, subject: string) {
    return this.request('PUT', `/api/${this.session}/groups/${encodeURIComponent(groupId)}/subject`, { subject })
  }

  setGroupDescription(groupId: string, description: string) {
    return this.request('PUT', `/api/${this.session}/groups/${encodeURIComponent(groupId)}/description`, { description })
  }

  setGroupPicture(groupId: string, file: WahaFile) {
    return this.request('PUT', `/api/${this.session}/groups/${encodeURIComponent(groupId)}/picture`, { file })
  }

  getInviteCode(groupId: string): Promise<unknown> {
    return this.request('GET', `/api/${this.session}/groups/${encodeURIComponent(groupId)}/invite-code`)
  }

  revokeInviteCode(groupId: string): Promise<unknown> {
    return this.request('POST', `/api/${this.session}/groups/${encodeURIComponent(groupId)}/invite-code/revoke`)
  }

  getParticipants(groupId: string): Promise<Json[]> {
    return this.request('GET', `/api/${this.session}/groups/${encodeURIComponent(groupId)}/participants`)
  }

  addParticipants(groupId: string, ids: string[]) {
    return this.request('POST', `/api/${this.session}/groups/${encodeURIComponent(groupId)}/participants/add`, {
      participants: ids.map((id) => ({ id })),
    })
  }

  removeParticipants(groupId: string, ids: string[]) {
    return this.request('POST', `/api/${this.session}/groups/${encodeURIComponent(groupId)}/participants/remove`, {
      participants: ids.map((id) => ({ id })),
    })
  }

  promoteAdmins(groupId: string, ids: string[]) {
    return this.request('POST', `/api/${this.session}/groups/${encodeURIComponent(groupId)}/admin/promote`, {
      participants: ids.map((id) => ({ id })),
    })
  }

  demoteAdmins(groupId: string, ids: string[]) {
    return this.request('POST', `/api/${this.session}/groups/${encodeURIComponent(groupId)}/admin/demote`, {
      participants: ids.map((id) => ({ id })),
    })
  }

  // --- status (stories) ---
  sendTextStatus(body: Json) {
    return this.request<Json>('POST', `/api/${this.session}/status/text`, body)
  }

  sendImageStatus(body: Json) {
    return this.request<Json>('POST', `/api/${this.session}/status/image`, body)
  }

  sendVideoStatus(body: Json) {
    return this.request<Json>('POST', `/api/${this.session}/status/video`, body)
  }

  sendVoiceStatus(body: Json) {
    return this.request<Json>('POST', `/api/${this.session}/status/voice`, body)
  }

  deleteStatus(body: Json) {
    return this.request('POST', `/api/${this.session}/status/delete`, body)
  }

  sendSeen(chatId: string) {
    return this.request('POST', '/api/sendSeen', { session: this.session, chatId })
  }

  startTyping(chatId: string) {
    return this.request('POST', '/api/startTyping', { session: this.session, chatId })
  }

  stopTyping(chatId: string) {
    return this.request('POST', '/api/stopTyping', { session: this.session, chatId })
  }
}

// Message id shape varies by engine: plain string or { id, _serialized }.
export function extractMessageId(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const id = (result as Json).id
  if (typeof id === 'string') return id
  if (id && typeof id === 'object') {
    const obj = id as Json
    if (typeof obj._serialized === 'string') return obj._serialized
    if (typeof obj.id === 'string') return obj.id
  }
  return null
}

export const waha = new WahaClient(config.wahaUrl, config.wahaApiKey, config.wahaSession)
