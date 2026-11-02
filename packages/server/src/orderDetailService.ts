import { formatMaths, projectOrder, type Status } from '@isocode/engine'
import { badRequest, forbidden, notFound } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'
import { loadEngineData } from './engineData.js'

export interface StageDetail {
  stage: string
  sequence: number
  unitName: string
  qty: number
  produced: number
  remaining: number
  complete: boolean
  status: Status
  reasons: string[]
  /** The date the template says this stage must finish. */
  plannedEnd: string
  /** The date it will finish at the current rate, or null when there is not enough to project. */
  projectedEnd: string | null
  /** "Need 467/day · making 350/day · 700 pcs short by 11 Nov." */
  maths: string
  needed: number | null
  made: number | null
  madeIsEstimate: boolean
  shortBy: number | null
  bufferDays: number | null
  noRecentUpdate: boolean
}

export interface HistoryEntry {
  at: string          // ISO instant, UTC
  by: string | null   // who made the change
  what: string        // "Ex-factory" or "Sewing finish date"
  from: string | null
  to: string | null
  reason: string
}

export interface OrderDetail {
  order: {
    id: string; po: string; buyerId: string; buyerName: string; style: string; colour: string
    sizes: Record<string, number>; qty: number; exFactory: string; status: Status
  }
  stages: StageDetail[]
  history: HistoryEntry[]
}

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * One order in full: every stage with the dates the template planned beside the dates the
 * current rate projects, the sum behind each colour, and every date change ever made to it.
 * Staff only, for the same reason as the board.
 */
export async function getOrderDetail(tx: Tx, ctx: Ctx, orderId: string, today: string): Promise<OrderDetail> {
  if (!isStaff(ctx)) throw forbidden('Order details are for merchandisers')
  if (!/^[0-9a-f-]{36}$/i.test(String(orderId))) throw badRequest('Invalid order')

  const { orders, stagesBy, eventsBy, calendars, settings } = await loadEngineData(tx, orderId)
  const o = orders[0]
  if (!o) throw notFound('No such order')
  const stages = (stagesBy.get(o.id) ?? []).sort((a, b) => a.sequence - b.sequence)
  const result = projectOrder({ id: o.id, exFactory: o.exFactory }, stages, eventsBy.get(o.id) ?? [], calendars, today, settings)

  const units = await tx.query<{ id: string; name: string }>('select id::text as id, name from unit')
  const unitName = new Map(units.map((u) => [u.id, u.name]))

  const detail: StageDetail[] = result.stages.map((r) => {
    const st = stages.find((s) => s.stage === r.stage)!
    return {
      stage: r.stage, sequence: st.sequence, unitName: unitName.get(st.unitId) ?? '', qty: r.qty, produced: r.produced,
      remaining: r.remaining, complete: r.complete, status: r.status, reasons: r.reasons, plannedEnd: st.milestone,
      projectedEnd: r.projectedEnd, maths: formatMaths(r, st.milestone), needed: r.needed, made: r.made,
      madeIsEstimate: r.madeIsEstimate, shortBy: r.shortBy, bufferDays: r.bufferDays, noRecentUpdate: r.noRecentUpdate,
    }
  })

  const rows = await tx.query<{ at: string; by: string | null; entity: string; field: string; old: string | null; new: string | null; reason: string; stage: string | null }>(
    `select to_char(d.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at, a.email as by, d.entity, d.field,
            d.old, d.new, d.reason, m.stage
       from date_change d
       left join account a on a.id = d.user_id
       left join milestone m on d.entity = 'milestone' and m.id = d.entity_id
      where (d.entity = 'orders' and d.entity_id = $1) or (d.entity = 'milestone' and m.order_id = $1)
      order by d.at desc, d.id`, [orderId])

  return {
    order: {
      id: o.id, po: o.po, buyerId: o.buyerId, buyerName: o.buyerName, style: o.style, colour: o.colour, sizes: o.sizes,
      qty: o.qty, exFactory: o.exFactory, status: stages.length ? result.status : 'grey',
    },
    stages: detail,
    history: rows.map((r) => ({
      at: r.at, by: r.by, what: r.entity === 'orders' ? 'Ex-factory date' : `${label(r.stage ?? 'stage')} finish date`,
      from: r.old, to: r.new, reason: r.reason,
    })),
  }
}
