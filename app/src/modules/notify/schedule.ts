export const REMINDER_OFFSETS_HOURS = [24, 1]

// Reminder times before an appointment, dropping any that are already past.
export function computeReminderTimes(appointmentAt: Date, now: Date): Date[] {
  return REMINDER_OFFSETS_HOURS.map(
    (hours) => new Date(appointmentAt.getTime() - hours * 3600_000),
  ).filter((t) => t.getTime() > now.getTime())
}
