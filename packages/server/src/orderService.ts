import { backSchedule, type TemplateStep, type UnitCalendar } from '@isocode/engine'
import { workingDaysBack } from '@isocode/engine/dates'
import { badRequest, forbidden, notFound, AppError } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'
import { isIsoDate } from './today.js'

export interface NewOrder {
  buyerId: string
  po: string
  style: string
  colour: string
  /** Size -> quantity, e.g. { S: 500, M: 1200 }. The order quantity is their sum. */
  sizes: Record<string, number>
  qty?: number
  exFactory: string
  templateId: string
}

export interface CreatedOrder {
  orderId: string
  qty: number
  milestones: { stage: string; sequence: number; unitId: string; plannedEnd: string }[]
  /** Stages already due today or earlier: the order is real but late; the board will show it. */
  alreadyDue: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${name} is required`)
  return v.trim().slice(0, 200)
}

async function calendarsFor(tx: Tx, unitIds: string[]): Promise<Record<string, UnitCalendar>> {
  const out: Record<string, UnitCalendar> = {}
  if (!unitIds.length) return out
  const rows = await tx.query<{ unit_id: string; date: string; working: boolean }>(
    `select unit_id::text as unit_id, date::text as date, working from calendar_day where unit_id = any($1::uuid[])`, [unitIds])
  for (const r of rows) (out[r.unit_id] ??= { days: {} }).days![r.date] = r.working
  return out
}

/** Create an order and back-schedule its milestones from the template. Merchandisers only. */
export async function createOrder(tx: Tx, ctx: Ctx, input: NewOrder, today: string): Promise<CreatedOrder> {
  if (!isStaff(ctx)) throw forbidden('Only merchandisers set up orders')
  const po = text(input.po, 'PO'), style = text(input.style, 'Style'), colour = text(input.colour, 'Colour')
  if (!UUID.test(String(input.buyerId))) throw badRequest('Choose a buyer')
  if (!UUID.test(String(input.templateId))) throw badRequest('Choose a TNA template')
  if (!isIsoDate(input.exFactory)) throw badRequest('Ex-factory date must be a real date (YYYY-MM-DD)')

  const sizes = input.sizes
  if (typeof sizes !== 'object' || sizes === null || Array.isArray(sizes) || !Object.keys(sizes).length) throw badRequest('Enter the quantity for at least one size')
  let total = 0
  for (const [size, q] of Object.entries(sizes)) {
    if (!size.trim()) throw badRequest('A size has no name')
    if (!Number.isInteger(q) || q < 0) throw badRequest(`Size ${size}: quantity must be a whole number, 0 or more`)
    total += q
  }
  if (total <= 0) throw badRequest('The order quantity must be more than 0')
  if (input.qty !== undefined && input.qty !== total) throw badRequest(`Quantity ${input.qty} does not match the sizes, which add up to ${total}`)

  if (!(await tx.query('select 1 from buyer where id = $1', [input.buyerId])).length) throw notFound('No such buyer')
  const tpl = (await tx.query<{ offsets: unknown }>('select offsets from tna_template where id = $1', [input.templateId]))[0]
  if (!tpl) throw notFound('No such TNA template')
  const raw = Array.isArray(tpl.offsets) ? tpl.offsets as { stage: string; sequence: number; working_days_before: number; unit_id: string }[] : []
  const steps: TemplateStep[] = raw.map((o) => ({ stage: o.stage, sequence: o.sequence, workingDaysBefore: o.working_days_before, unitId: o.unit_id }))

  const calendars = await calendarsFor(tx, [...new Set(steps.map((s) => s.unitId))])
  const schedule = backSchedule(input.exFactory, steps, calendars, today)
  if (schedule.problems.length) throw badRequest(`This template cannot be used: ${schedule.problems.join('; ')}`)

  if ((await tx.query('select 1 from orders where buyer_id = $1 and po = $2 and style = $3 and colour = $4', [input.buyerId, po, style, colour])).length) {
    throw new AppError(409, 'duplicate_order', `PO ${po} (${style}, ${colour}) already exists for this buyer`)
  }
  const order = (await tx.query<{ id: string }>(
    `insert into orders (buyer_id, po, style, colour, sizes, qty, ex_factory) values ($1, $2, $3, $4, $5::jsonb, $6, $7) returning id::text as id`,
    [input.buyerId, po, style, colour, JSON.stringify(sizes), total, input.exFactory]))[0]!

  const offsetOf = new Map(steps.map((s) => [s.stage, s.workingDaysBefore]))
  for (const m of schedule.milestones) {
    await tx.query(
      `insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty, working_days_before) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [order.id, input.buyerId, m.stage, m.unitId, m.plannedEnd, m.sequence, total, offsetOf.get(m.stage) ?? null])
  }
  return { orderId: order.id, qty: total, milestones: schedule.milestones, alreadyDue: schedule.alreadyDue }
}

export interface ExFactoryChange {
  orderId: string
  exFactory: { old: string; new: string }
  milestones: { stage: string; old: string; new: string }[]
  /** Milestones whose date was set by hand and so were left where they are. */
  leftAlone: string[]
}

/**
 * Move the ex-factory date and re-schedule every milestone that was scheduled from the
 * template. Each change is written to the append-only date_change log with who, when,
 * old, new and the reason. All or nothing: it runs in the caller's transaction.
 */
export async function changeExFactory(
  tx: Tx, ctx: Ctx, userId: string, orderId: string, newDate: string, reason: string,
): Promise<ExFactoryChange> {
  if (!isStaff(ctx)) throw forbidden('Only merchandisers change dates')
  if (typeof reason !== 'string' || !reason.trim()) throw badRequest('Give a reason for the change')
  if (!isIsoDate(newDate)) throw badRequest('Ex-factory date must be a real date (YYYY-MM-DD)')
  if (!UUID.test(String(orderId)) || !UUID.test(String(userId))) throw badRequest('Invalid request')

  const order = (await tx.query<{ buyer_id: string; ex_factory: string }>(
    'select buyer_id::text as buyer_id, ex_factory::text as ex_factory from orders where id = $1', [orderId]))[0]
  if (!order) throw notFound('No such order')
  if (order.ex_factory === newDate) throw badRequest('That is already the ex-factory date')

  const ms = await tx.query<{ id: string; stage: string; unit_id: string; planned_end: string; working_days_before: number | null }>(
    `select id::text as id, stage, unit_id::text as unit_id, planned_end::text as planned_end, working_days_before from milestone where order_id = $1 order by sequence`, [orderId])
  const calendars = await calendarsFor(tx, [...new Set(ms.map((m) => m.unit_id))])

  const log = (entity: string, entityId: string, field: string, oldV: string, newV: string) =>
    tx.query(
      `insert into date_change (entity, entity_id, buyer_id, field, old, new, reason, user_id) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entity, entityId, order.buyer_id, field, oldV, newV, reason.trim(), userId])

  await tx.query('update orders set ex_factory = $2 where id = $1', [orderId, newDate])
  await log('orders', orderId, 'ex_factory', order.ex_factory, newDate)

  const moved: ExFactoryChange['milestones'] = []
  const leftAlone: string[] = []
  for (const m of ms) {
    if (m.working_days_before === null) { leftAlone.push(m.stage); continue }
    const next = workingDaysBack(calendars[m.unit_id], newDate, m.working_days_before)
    if (next === m.planned_end) continue
    await tx.query('update milestone set planned_end = $2 where id = $1', [m.id, next])
    await log('milestone', m.id, 'planned_end', m.planned_end, next)
    moved.push({ stage: m.stage, old: m.planned_end, new: next })
  }
  return { orderId, exFactory: { old: order.ex_factory, new: newDate }, milestones: moved, leftAlone }
}
