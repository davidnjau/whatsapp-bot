import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireApiAuth } from '../../admin/auth.js'
import { createNotification, NotifyError } from './index.js'
import { computeReminderTimes } from './schedule.js'

const AttachmentSchema = z.object({
  url: z.string().url(),
  mimetype: z.string().optional(),
  filename: z.string().optional(),
  type: z.enum(['image', 'file']).optional(),
})

const NotifySchema = z.object({
  phone: z.string().min(7),
  template: z.string().min(1),
  variables: z.record(z.union([z.string(), z.number()])).default({}),
  sendAt: z.coerce.date().optional(),
  attachment: AttachmentSchema.optional(),
})

const AppointmentSchema = z.object({
  phone: z.string().min(7),
  template: z.string().min(1).default('appointment_reminder'),
  variables: z.record(z.union([z.string(), z.number()])).default({}),
  appointmentAt: z.coerce.date(),
})

export const notifyRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireApiAuth)

  app.post('/notify', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = NotifySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') })
    }
    try {
      const result = await createNotification(parsed.data)
      return { ok: true, ...result }
    } catch (err) {
      if (err instanceof NotifyError) return reply.code(err.statusCode).send({ error: err.message })
      throw err
    }
  })

  // Schedules reminders 24h and 1h before the appointment (skipping past times).
  app.post('/notify/appointment', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = AppointmentSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') })
    }
    const times = computeReminderTimes(parsed.data.appointmentAt, new Date())
    if (times.length === 0) {
      return reply.code(400).send({ error: 'appointment is in the past or starts within the hour' })
    }
    try {
      const reminders = []
      for (const sendAt of times) {
        reminders.push(
          await createNotification({
            phone: parsed.data.phone,
            template: parsed.data.template,
            variables: parsed.data.variables,
            sendAt,
          }),
        )
      }
      return { ok: true, reminders }
    } catch (err) {
      if (err instanceof NotifyError) return reply.code(err.statusCode).send({ error: err.message })
      throw err
    }
  })
}
