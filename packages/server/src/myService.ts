import { forbidden } from './errors.js'
import type { Ctx, Tx } from './db.js'

export interface MyStage {
  orderId: string
  po: string
  style: string
  colour: string
  stage: string
  sequence: number
  qty: number
  plannedEnd: string
  /** Pieces recorded so far for this stage, all days. */
  produced: number
  /** Pieces recorded for `today`. */
  todayQty: number
  complete: boolean
}

/**
 * The stages a supervisor is responsible for, with progress. Row-level security limits the
 * rows to the supervisor's own unit; this function only adds the sums. Soonest due first.
 */
export async function getMyStages(tx: Tx, ctx: Ctx, today: string): Promise<MyStage[]> {
  if (ctx.role !== 'supervisor') throw forbidden('This list is for supervisors')
  const rows = await tx.query<{
    order_id: string; po: string; style: string; colour: string; stage: string; sequence: number;
    qty: number; planned_end: string; produced: number; today_qty: number
  }>(
    `select o.id::text as order_id, o.po, o.style, o.colour, m.stage, m.sequence, m.qty,
            m.planned_end::text as planned_end,
            coalesce((select sum(e.qty) from update_event e where e.order_id = m.order_id and e.stage = m.stage), 0)::int as produced,
            coalesce((select sum(e.qty) from update_event e where e.order_id = m.order_id and e.stage = m.stage and e.date = $1), 0)::int as today_qty
       from milestone m join orders o on o.id = m.order_id
      order by m.planned_end, o.po, m.sequence, o.id, m.stage, m.id`, [today])
  return rows.map((r) => ({
    orderId: r.order_id, po: r.po, style: r.style, colour: r.colour, stage: r.stage, sequence: r.sequence,
    qty: r.qty, plannedEnd: r.planned_end, produced: r.produced, todayQty: r.today_qty,
    complete: r.produced >= r.qty,
  }))
}
