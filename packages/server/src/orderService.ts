import { backSchedule, isWorking, type Schedule, type TemplateStep, type UnitCalendar } from '@isocode/engine'
import { workingDaysBack } from '@isocode/engine/dates'
import { badRequest, forbidden, notFound, orDuplicate, AppError } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'
import { isIsoDate } from './today.js'
import { hasUnsafeText } from './textRules.js'

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

/** Limits on the sizes of one order. Generous for a real order (a knitwear PO has a handful of sizes), small enough that nothing absurd is stored. */
export const MAX_SIZES = 30
export const MAX_SIZE_NAME_CHARS = 20
export const MAX_QTY_PER_SIZE = 100_000
export const MAX_ORDER_QTY = 1_000_000

export interface CreatedOrder {
  orderId: string
  qty: number
  milestones: { stage: string; sequence: number; unitId: string; plannedEnd: string }[]
  /** Stages already due today or earlier: the order is real but late; the board will show it. */
  alreadyDue: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_ORDER_TEXT_CHARS = 200
const text = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${name} is required`)
  if (hasUnsafeText(v.trim())) throw badRequest(`${name} has a character that is not allowed`)   // BE-078: tab, newline, bidi override
  // Refused, never cut: two different POs that share their first 200 characters must not turn into one.
  if (v.trim().length > MAX_ORDER_TEXT_CHARS) throw badRequest(`${name} must be at most ${MAX_ORDER_TEXT_CHARS} characters`)
  return v.trim()
}

/**
 * Check the sizes of an order and return them tidied (names trimmed) with their total. Every message says which limit was passed.
 * A name is trimmed before it is kept, so " S" and "S" are one size and listing both is refused rather than stored as two.
 */
export function normaliseSizes(sizes: unknown): { sizes: Record<string, number>; total: number } {
  if (typeof sizes !== 'object' || sizes === null || Array.isArray(sizes) || !Object.keys(sizes).length) throw badRequest('Enter the quantity for at least one size')
  const entries = Object.entries(sizes as Record<string, unknown>)
  if (entries.length > MAX_SIZES) throw badRequest(`An order can have at most ${MAX_SIZES} sizes`)
  const out: Record<string, number> = {}
  let total = 0
  for (const [raw, q] of entries) {
    const size = raw.trim()
    if (!size) throw badRequest('A size has no name')
    if (size.length > MAX_SIZE_NAME_CHARS) throw badRequest(`A size name can be at most ${MAX_SIZE_NAME_CHARS} characters`)
    if (hasUnsafeText(size)) throw badRequest('A size name has a character that is not allowed')   // BE-078: also the bidi controls
    if (Object.hasOwn(out, size)) throw badRequest(`The size ${size} is listed twice`)
    if (!Number.isInteger(q) || (q as number) < 0 || (q as number) > MAX_QTY_PER_SIZE) throw badRequest(`Size ${size.slice(0, 20)}: quantity must be a whole number from 0 to ${MAX_QTY_PER_SIZE}`)
    out[size] = q as number
    total += q as number
  }
  if (total > MAX_ORDER_QTY) throw badRequest(`The order quantity can be at most ${MAX_ORDER_QTY} pieces`)
  return { sizes: out, total }
}

/** The total of an order's sizes, after the same checks. */
export const checkSizes = (sizes: unknown): number => normaliseSizes(sizes).total

async function calendarsFor(tx: Tx, unitIds: string[]): Promise<Record<string, UnitCalendar>> {
  const out: Record<string, UnitCalendar> = {}
  if (!unitIds.length) return out
  const rows = await tx.query<{ unit_id: string; date: string; working: boolean }>(
    `select unit_id::text as unit_id, date::text as date, working from calendar_day where unit_id = any($1::uuid[])`, [unitIds])
  for (const r of rows) (out[r.unit_id] ??= { days: {} }).days![r.date] = r.working
  return out
}

/** A TNA template: its name and its stages, as the engine wants them. */
export async function loadTemplate(tx: Tx, templateId: string): Promise<{ name: string; steps: TemplateStep[] }> {
  const tpl = (await tx.query<{ name: string; offsets: unknown }>('select name, offsets from tna_template where id = $1', [templateId]))[0]
  if (!tpl) throw notFound('No such TNA template')
  const raw = Array.isArray(tpl.offsets) ? tpl.offsets as { stage: string; sequence: number; working_days_before: number; unit_id: string }[] : []
  return { name: tpl.name, steps: raw.map((o) => ({ stage: o.stage, sequence: o.sequence, workingDaysBefore: o.working_days_before, unitId: o.unit_id })) }
}

/**
 * The schedule an order would get, plus the plain reasons (if any) it cannot be created.
 *
 * DEC-023: a saved template can never be one order setup would refuse. Setup checks a template with NO closed days; the
 * engine decides a template's faults from its offsets alone, and closed days only move dates (a later stage is held to
 * the earlier stage's date). So the two checks agree whatever the units' calendars say, now and after closed days change.
 * Should an engine change ever let a closed day refuse a template again, this says WHICH template, stage and closed day,
 * rather than sending the person to fix offsets that are fine.
 */
async function planSchedule(tx: Tx, tpl: { name: string; steps: TemplateStep[] }, exFactory: string, today: string): Promise<{ schedule: Schedule; problems: string[]; namesTemplate: boolean }> {
  const calendars = await calendarsFor(tx, [...new Set(tpl.steps.map((s) => s.unitId))])
  const schedule = backSchedule(exFactory, tpl.steps, calendars, today)
  if (!schedule.problems.length) return { schedule, problems: [], namesTemplate: false }
  const own = backSchedule(exFactory, tpl.steps, {}, today).problems   // what Setup saw
  if (own.length) return { schedule, problems: schedule.problems, namesTemplate: false }
  const clash = await explainClosedDay(tx, tpl, calendars, exFactory)
  return { schedule, problems: clash ? [clash] : schedule.problems, namesTemplate: !!clash }
}

async function explainClosedDay(tx: Tx, tpl: { name: string; steps: TemplateStep[] }, calendars: Record<string, UnitCalendar>, exFactory: string): Promise<string | null> {
  const ordered = [...tpl.steps].sort((a, b) => a.sequence - b.sequence)
  const ends = ordered.map((st) => workingDaysBack(calendars[st.unitId], exFactory, Math.max(0, st.workingDaysBefore)))
  for (let i = 1; i < ordered.length; i++) {
    if (ends[i]! >= ends[i - 1]!) continue
    const cur = ordered[i]!
    // The closed days of that unit that matter: set by hand, on a day the unit would otherwise work, between where the stage landed and ex-factory.
    const closed = Object.entries(calendars[cur.unitId]?.days ?? {})
      .filter(([date, working]) => !working && date >= ends[i]! && date <= exFactory && isWorking({}, date)).map(([date]) => date).sort().slice(0, 3)
    if (!closed.length) continue
    const unit = (await tx.query<{ name: string }>('select name from unit where id = $1', [cur.unitId]))[0]?.name ?? 'The unit'
    return `Template "${tpl.name}": stage "${cur.stage}" would fall before "${ordered[i - 1]!.stage}" because ${unit} is closed on ${closed.join(', ')}. Change the template or that closed day.`
  }
  return null
}

export interface SchedulePreview {
  milestones: { stage: string; sequence: number; unitId: string; unitName: string; plannedEnd: string }[]
  /** Faults in the template: the order cannot be created until these are fixed. */
  problems: string[]
  /** Stages already due today or earlier: the order can still be created, and will show late. */
  alreadyDue: string[]
}

/**
 * What an order would look like if created now, without creating it. Lets the screen show the
 * dates (and say plainly that an order is already late, or that a template is broken) BEFORE
 * the merchandiser commits to it.
 */
export async function previewSchedule(tx: Tx, ctx: Ctx, input: { templateId: string; exFactory: string; sizes?: unknown }, today: string): Promise<SchedulePreview> {
  if (!isStaff(ctx)) throw forbidden('Only merchandisers set up orders')
  if (!UUID.test(String(input.templateId))) throw badRequest('Choose a TNA template')
  if (!isIsoDate(input.exFactory)) throw badRequest('Ex-factory date must be a real date (YYYY-MM-DD)')
  if (input.sizes !== undefined) checkSizes(input.sizes)   // the preview ignores sizes, but refuses absurd ones if the form sends them
  const { schedule, problems } = await planSchedule(tx, await loadTemplate(tx, input.templateId), input.exFactory, today)
  const units = await tx.query<{ id: string; name: string }>('select id::text as id, name from unit')
  const name = new Map(units.map((u) => [u.id, u.name]))
  return {
    milestones: schedule.milestones.map((m) => ({ ...m, unitName: name.get(m.unitId) ?? '' })),
    problems,
    alreadyDue: schedule.alreadyDue,
  }
}

export interface OrderOptions {
  buyers: { id: string; name: string; country: string | null }[]
  templates: { id: string; name: string; stages: { stage: string; workingDaysBefore: number }[] }[]
}

/** What the order form offers in its drop-downs. */
export async function getOrderOptions(tx: Tx, ctx: Ctx): Promise<OrderOptions> {
  if (!isStaff(ctx)) throw forbidden('Only merchandisers set up orders')
  const buyers = await tx.query<{ id: string; name: string; country: string | null }>('select id::text as id, name, country from buyer order by name, id')
  const tpls = await tx.query<{ id: string; name: string; offsets: unknown }>('select id::text as id, name, offsets from tna_template order by name, id')
  return {
    buyers,
    templates: tpls.map((t) => ({
      id: t.id, name: t.name,
      stages: (Array.isArray(t.offsets) ? t.offsets as { stage: string; sequence: number; working_days_before: number }[] : [])
        .sort((a, b) => a.sequence - b.sequence).map((o) => ({ stage: o.stage, workingDaysBefore: o.working_days_before })),
    })),
  }
}

/** Create an order and back-schedule its milestones from the template. Merchandisers only. */
export async function createOrder(tx: Tx, ctx: Ctx, input: NewOrder, today: string): Promise<CreatedOrder> {
  if (!isStaff(ctx)) throw forbidden('Only merchandisers set up orders')
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw badRequest('Send the order as a JSON object')
  const po = text(input.po, 'PO'), style = text(input.style, 'Style'), colour = text(input.colour, 'Colour')
  if (!UUID.test(String(input.buyerId))) throw badRequest('Choose a buyer')
  if (!UUID.test(String(input.templateId))) throw badRequest('Choose a TNA template')
  if (!isIsoDate(input.exFactory)) throw badRequest('Ex-factory date must be a real date (YYYY-MM-DD)')

  const { sizes, total } = normaliseSizes(input.sizes)
  if (total <= 0) throw badRequest('The order quantity must be more than 0')
  // qty is optional (null counts as not sent). When it is sent it must be a number; text such as "300" is told so, not told it differs from 300.
  if (input.qty !== undefined && input.qty !== null) {
    if (typeof input.qty !== 'number') throw badRequest('Quantity must be a number')
    if (input.qty !== total) throw badRequest(`Quantity ${input.qty} does not match the sizes, which add up to ${total}`)
  }

  if (!(await tx.query('select 1 from buyer where id = $1', [input.buyerId])).length) throw notFound('No such buyer')
  const tpl = await loadTemplate(tx, input.templateId)
  const steps = tpl.steps
  const { schedule, problems, namesTemplate } = await planSchedule(tx, tpl, input.exFactory, today)
  if (problems.length) throw badRequest(namesTemplate ? problems.join('; ') : `This template ("${tpl.name}") cannot be used: ${problems.join('; ')}`)

  const duplicate = new AppError(409, 'duplicate_order', `PO ${po} (${style}, ${colour}) already exists for this buyer`)
  if ((await tx.query('select 1 from orders where buyer_id = $1 and po = $2 and style = $3 and colour = $4', [input.buyerId, po, style, colour])).length) throw duplicate
  // The check can lose a race with another request creating the same order; the table's unique rule then refuses the insert, with the same answer.
  const order = (await orDuplicate(() => tx.query<{ id: string }>(
    `insert into orders (buyer_id, po, style, colour, sizes, qty, ex_factory) values ($1, $2, $3, $4, $5::jsonb, $6, $7) returning id::text as id`,
    [input.buyerId, po, style, colour, JSON.stringify(sizes), total, input.exFactory]), duplicate))[0]!

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
  // Same cap as the form; written once per moved row into an append-only table.
  if (reason.trim().length > 300) throw badRequest('Keep the reason to 300 characters')
  if (hasUnsafeText(reason.trim())) throw badRequest('The reason has a character that is not allowed')   // BE-078
  if (!isIsoDate(newDate)) throw badRequest('Ex-factory date must be a real date (YYYY-MM-DD)')
  if (!UUID.test(String(orderId)) || !UUID.test(String(userId))) throw badRequest('Invalid request')

  const order = (await tx.query<{ buyer_id: string; ex_factory: string }>(
    'select buyer_id::text as buyer_id, ex_factory::text as ex_factory from orders where id = $1 for update', [orderId]))[0]   // BE-066: the row lock makes a second change wait, then read the date the first one wrote, so the history chains
  if (!order) throw notFound('No such order')
  if (order.ex_factory === newDate) throw badRequest('That is already the ex-factory date')

  const ms = await tx.query<{ id: string; stage: string; unit_id: string; planned_end: string; working_days_before: number | null }>(
    `select id::text as id, stage, unit_id::text as unit_id, planned_end::text as planned_end, working_days_before from milestone where order_id = $1 order by sequence, stage, id`, [orderId])
  const calendars = await calendarsFor(tx, [...new Set(ms.map((m) => m.unit_id))])

  const log = (entity: string, entityId: string, field: string, oldV: string, newV: string) =>
    tx.query(
      `insert into date_change (entity, entity_id, buyer_id, field, old, new, reason, user_id) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entity, entityId, order.buyer_id, field, oldV, newV, reason.trim(), userId])

  await tx.query('update orders set ex_factory = $2 where id = $1', [orderId, newDate])
  await log('orders', orderId, 'ex_factory', order.ex_factory, newDate)

  const moved: ExFactoryChange['milestones'] = []
  const leftAlone: string[] = []
  let prevEnd: string | null = null // as in backSchedule: closed days never put a later stage before an earlier one
  for (const m of ms) {
    if (m.working_days_before === null) { leftAlone.push(m.stage); continue }
    let next = workingDaysBack(calendars[m.unit_id], newDate, m.working_days_before)
    if (prevEnd !== null && next < prevEnd) next = prevEnd
    prevEnd = next
    if (next === m.planned_end) continue
    await tx.query('update milestone set planned_end = $2 where id = $1', [m.id, next])
    await log('milestone', m.id, 'planned_end', m.planned_end, next)
    moved.push({ stage: m.stage, old: m.planned_end, new: next })
  }
  return { orderId, exFactory: { old: order.ex_factory, new: newDate }, milestones: moved, leftAlone }
}
