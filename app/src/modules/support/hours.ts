const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export interface BusinessHours {
  startDay: number
  endDay: number
  startMinute: number
  endMinute: number
}

// Parses specs like "Mon-Sat 08:00-18:00".
export function parseBusinessHours(spec: string): BusinessHours | null {
  const m = spec
    .trim()
    .toLowerCase()
    .match(/^([a-z]{3})[a-z]*\s*-\s*([a-z]{3})[a-z]*\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const startDay = DAYS.indexOf(m[1])
  const endDay = DAYS.indexOf(m[2])
  if (startDay === -1 || endDay === -1) return null
  return {
    startDay,
    endDay,
    startMinute: Number(m[3]) * 60 + Number(m[4]),
    endMinute: Number(m[5]) * 60 + Number(m[6]),
  }
}

export function isWithinBusinessHours(spec: string, date: Date, tz: string): boolean {
  const hours = parseBusinessHours(spec)
  if (!hours) return true // unparseable spec → treat as always open

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = DAYS.indexOf(get('weekday').toLowerCase().slice(0, 3))
  const minute = (Number(get('hour')) % 24) * 60 + Number(get('minute'))

  const dayInRange =
    hours.startDay <= hours.endDay
      ? day >= hours.startDay && day <= hours.endDay
      : day >= hours.startDay || day <= hours.endDay
  return dayInRange && minute >= hours.startMinute && minute < hours.endMinute
}
