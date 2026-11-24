import { describe, expect, it } from 'vitest'
import { computeReminderTimes } from '../src/modules/notify/schedule.js'

const HOUR = 3600_000

describe('computeReminderTimes', () => {
  const now = new Date('2026-11-25T12:00:00Z')

  it('schedules 24h and 1h reminders for a far-out appointment', () => {
    const appointment = new Date(now.getTime() + 48 * HOUR)
    expect(computeReminderTimes(appointment, now)).toEqual([
      new Date(appointment.getTime() - 24 * HOUR),
      new Date(appointment.getTime() - 1 * HOUR),
    ])
  })

  it('drops the 24h reminder when the appointment is sooner than that', () => {
    const appointment = new Date(now.getTime() + 5 * HOUR)
    expect(computeReminderTimes(appointment, now)).toEqual([
      new Date(appointment.getTime() - 1 * HOUR),
    ])
  })

  it('returns nothing for appointments within the hour or in the past', () => {
    expect(computeReminderTimes(new Date(now.getTime() + 30 * 60_000), now)).toEqual([])
    expect(computeReminderTimes(new Date(now.getTime() - HOUR), now)).toEqual([])
  })
})
