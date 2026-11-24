export type StatusType = 'text' | 'image' | 'video' | 'voice'

export interface StatusFile {
  mimetype?: string
  filename?: string
  url?: string
  data?: string
}

export interface StatusInput {
  type: StatusType
  text?: string
  backgroundColor?: string
  font?: number
  caption?: string
  convert?: boolean
  file?: StatusFile
}

// Builds the request body for WAHA's POST /api/{session}/status/{type}.
// contacts = null → default audience (all contacts).
export function buildStatusBody(
  input: StatusInput,
  contacts: string[] | null,
): Record<string, unknown> {
  const audience = contacts && contacts.length ? { contacts } : {}
  switch (input.type) {
    case 'text':
      return {
        text: input.text ?? '',
        ...(input.backgroundColor ? { backgroundColor: input.backgroundColor } : {}),
        ...(input.font !== undefined ? { font: input.font } : {}),
        ...audience,
      }
    case 'image':
      return {
        file: input.file,
        ...(input.caption ? { caption: input.caption } : {}),
        ...audience,
      }
    case 'video':
      return {
        file: input.file,
        convert: input.convert ?? true, // WhatsApp needs MP4/H.264; let WAHA convert by default
        ...(input.backgroundColor ? { backgroundColor: input.backgroundColor } : {}),
        ...audience,
      }
    case 'voice':
      return {
        file: input.file,
        convert: input.convert ?? true,
        ...(input.backgroundColor ? { backgroundColor: input.backgroundColor } : {}),
        ...audience,
      }
  }
}

// "09:00" → "0 9 * * *"
export function cronForDailyTime(hhmm: string): string | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return `${minute} ${hour} * * *`
}
