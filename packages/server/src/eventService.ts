import { compareDates } from '@isocode/engine/dates'
import { badRequest, forbidden, notFound } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'
import { isIsoDate } from './today.js'

export interface EventInput {
  clientUuid: string
  orderId: string
  stage: string
  date: string      // the date the supervisor sees, YYYY-MM-DD
  qty: number
  photoId?: string
  noteId?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_QTY = 1_000_000

/**
 * Record today's pieces for one stage. Idempotent on clientUuid: a retried send
 * (flaky network, app killed mid-sync) is reported as a duplicate and never counted
 * twice. Row-level security decides whether the caller may post to this stage at all.
 */
export async function submitEvent(
  tx: Tx, ctx: Ctx, input: EventInput, today: string,
): Promise<{ duplicate: boolean }> {
  if (ctx.role !== 'supervisor' && !isStaff(ctx)) throw forbidden()
  if (!UUID.test(input.clientUuid)) throw badRequest('clientUuid must be a UUID')
  if (!UUID.test(input.orderId)) throw badRequest('orderId must be a UUID')
  if (typeof input.stage !== 'string' || !input.stage.trim()) throw badRequest('stage is required')
  if (!Number.isInteger(input.qty) || input.qty < 0 || input.qty > MAX_QTY) {
    throw badRequest(`qty must be a whole number from 0 to ${MAX_QTY}`)
  }
  if (!isIsoDate(input.date)) throw badRequest('date must be YYYY-MM-DD')
  // A phone with a wrong clock must not post into the future; the engine would ignore it anyway.
  if (compareDates(input.date, today) > 0) throw badRequest('date is in the future')

  // Visible only if this caller's unit runs the stage (row-level security filters the rows).
  const stage = await tx.query<{ buyer_id: string; unit_id: string }>(
    'select buyer_id::text as buyer_id, unit_id::text as unit_id from milestone where order_id = $1 and stage = $2',
    [input.orderId, input.stage],
  )
  const m = stage[0]
  if (!m) throw notFound('No such stage for your unit')

  const inserted = await tx.query(
    `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty, photo_id, note_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (client_uuid) do nothing
     returning id`,
    [input.clientUuid, input.orderId, m.buyer_id, input.stage, m.unit_id, input.date, input.qty,
     input.photoId ?? null, input.noteId ?? null],
  )
  return { duplicate: inserted.length === 0 }
}
