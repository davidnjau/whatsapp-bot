import { z } from 'zod'
import { log } from '../logger.js'
import { sendAlert } from '../alerts/index.js'
import { handleAck, handleMessageAny } from './messages.js'
import { handleGroupJoin } from '../modules/groups/index.js'

export const WahaEventSchema = z
  .object({
    id: z.string().optional(),
    event: z.string(),
    session: z.string().optional(),
    timestamp: z.number().optional(),
    payload: z.unknown(),
  })
  .passthrough()

export type WahaEvent = z.infer<typeof WahaEventSchema>

export async function routeEvent(evt: WahaEvent) {
  switch (evt.event) {
    case 'message.any':
      return handleMessageAny(evt)
    case 'message.ack':
      return handleAck(evt)
    case 'session.status':
      return handleSessionStatus(evt)
    case 'group.v2.join':
      return handleGroupJoin(evt.payload)
    default:
      // other group.v2.* events are stored raw for now
      return
  }
}

async function handleSessionStatus(evt: WahaEvent) {
  const status = (evt.payload as { status?: string } | undefined)?.status ?? 'UNKNOWN'
  log.info({ session: evt.session, status }, 'session status changed')
  // STOPPED/STARTING/SCAN_QR_CODE occur transiently during linking and restarts;
  // only FAILED warrants an instant alert. The 5-minute watchdog alerts if any
  // non-WORKING state persists.
  if (status === 'FAILED') {
    await sendAlert(`WhatsApp session "${evt.session}" FAILED — check the admin panel.`)
  }
}
