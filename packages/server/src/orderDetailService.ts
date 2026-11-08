import { compareDates, formatMaths, isSunday, MAX_DATE, MIN_DATE, projectOrder, type IsoDate, type Status } from '@isocode/engine'
import { badRequest, forbidden, notFound } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'
import { calendarOfStages, lowConfidenceStages } from './confidence.js'
import { loadEngineData } from './engineData.js'
import { listOrderNotes, loadReasons, type Reason } from './noteService.js'

export interface StageDetail {
  stage: string
  sequence: number
  unitId: string
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
  /** The recent updates behind this stage's rate were entered by a merchandiser on a visit, not sent from the floor. */
  lowConfidence: boolean
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
  /** The factory's date today (India), so a form can default to the same day the server will accept. */
  today: string
  order: {
    id: string; po: string; buyerId: string; buyerName: string; style: string; colour: string
    sizes: Record<string, number>; qty: number; exFactory: string; status: Status
  }
  stages: StageDetail[]
  /** The closed days of each stage's unit across the order's dates, for the horizontal timeline. */
  calendar: TimelineCalendar
  history: HistoryEntry[]
  /** What supervisors reported, in their words, with the reason. Internal: buyers never see notes. */
  notes: Awaited<ReturnType<typeof listOrderNotes>>
  /** The reason list from settings, to label the notes' reasons in the client's own wording. */
  reasons: Reason[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface ClosedDay { date: string; reason: string }
export interface TimelineUnit { unitId: string; unitName: string; closed: ClosedDay[] }
/** The days each unit does not work between the first date that matters and the last, for the horizontal stage timeline. */
export interface TimelineCalendar { from: string; to: string; units: TimelineUnit[] }

/**
 * Every day in [from, to] a unit is closed, with the reason in words: the note the merchandiser wrote,
 * "Sunday" for the ordinary weekly closure, otherwise "Closed". A Sunday marked as worked is not closed.
 * Nothing is left out for being far away (BE-006); the only bound is the window of real dates
 * (2000-2100), so a stray year-9999 date cannot make this walk for minutes. Sundays are visited a week
 * at a time and the calendar entries are looked at once, not every day in between.
 */
export function closedDaysIn(entries: { date: string; working: boolean; note: string | null }[], from: IsoDate, to: IsoDate): ClosedDay[] {
  const lo = compareDates(from, MIN_DATE) < 0 ? MIN_DATE : from
  const hi = compareDates(to, MAX_DATE) > 0 ? MAX_DATE : to
  if (compareDates(lo, hi) > 0) return []
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const closed = new Set<IsoDate>()
  const DAY = 86_400_000
  const first = Date.parse(`${lo}T00:00:00Z`) / DAY, last = Date.parse(`${hi}T00:00:00Z`) / DAY
  // Day number 3 (4 Jan 1970) was a Sunday, so Sundays are 3 mod 7.
  for (let k = first + ((((3 - first) % 7) + 7) % 7); k <= last; k += 7) {
    const day = new Date(k * DAY).toISOString().slice(0, 10)
    if (byDate.get(day)?.working !== true) closed.add(day)
  }
  for (const e of entries) if (e.working === false && compareDates(e.date, lo) >= 0 && compareDates(e.date, hi) <= 0) closed.add(e.date)
  return [...closed].sort().map((date) => ({
    date, reason: byDate.get(date)?.note?.trim() || (isSunday(date) ? 'Sunday' : 'Closed'),
  }))
}

/** From the earliest of today, the first update and every order date, to the latest of ex-factory and every stage date. */
export function timelineSpan(exFactory: IsoDate, today: IsoDate, firstUpdate: IsoDate | null, stageDates: (IsoDate | null)[]): { from: IsoDate; to: IsoDate } {
  const ends = [exFactory, ...stageDates].filter((x): x is IsoDate => !!x)
  const starts = [today, ...(firstUpdate ? [firstUpdate] : []), ...ends]
  // Only the dates of the order end the period: today and the first update can start it but never stretch it.
  return {
    from: starts.reduce((a, b) => (compareDates(b, a) < 0 ? b : a)),
    to: ends.reduce((a, b) => (compareDates(b, a) > 0 ? b : a)),
  }
}

/**
 * One order in full: every stage with the dates the template planned beside the dates the
 * current rate projects, the sum behind each colour, and every date change ever made to it.
 * Staff only, for the same reason as the board.
 */
export async function getOrderDetail(tx: Tx, ctx: Ctx, orderId: string, today: string): Promise<OrderDetail> {
  if (!isStaff(ctx)) throw forbidden('Order details are for merchandisers')
  if (!UUID.test(String(orderId))) throw badRequest('Invalid order')

  const { orders, stagesBy, eventsBy, onBehalf, calendars, settings } = await loadEngineData(tx, orderId)
  const o = orders[0]
  if (!o) throw notFound('No such order')
  const stages = (stagesBy.get(o.id) ?? []).sort((a, b) => a.sequence - b.sequence)
  const result = projectOrder({ id: o.id, exFactory: o.exFactory }, stages, eventsBy.get(o.id) ?? [], calendars, today, settings)

  const units = await tx.query<{ id: string; name: string }>('select id::text as id, name from unit')
  const unitName = new Map(units.map((u) => [u.id, u.name]))

  const flagged = lowConfidenceStages(eventsBy.get(o.id) ?? [], onBehalf, today, settings, calendarOfStages(stages, calendars))
  const detail: StageDetail[] = result.stages.map((r) => {
    const st = stages.find((s) => s.stage === r.stage)!
    return {
      stage: r.stage, sequence: st.sequence, unitId: st.unitId, unitName: unitName.get(st.unitId) ?? '', qty: r.qty, produced: r.produced,
      remaining: r.remaining, complete: r.complete, status: r.status, reasons: r.reasons, plannedEnd: st.milestone,
      projectedEnd: r.projectedEnd, maths: formatMaths(r, st.milestone), needed: r.needed, made: r.made,
      madeIsEstimate: r.madeIsEstimate, shortBy: r.shortBy, bufferDays: r.bufferDays, noRecentUpdate: r.noRecentUpdate,
      lowConfidence: flagged.has(r.stage),
    }
  })

  const events = eventsBy.get(o.id) ?? []
  const firstUpdate = events.length ? events.reduce((a, e) => (compareDates(e.date, a) < 0 ? e.date : a), events[0]!.date) : null
  const span = timelineSpan(o.exFactory, today, firstUpdate, stages.flatMap((s) => [s.milestone, detail.find((d) => d.stage === s.stage)?.projectedEnd ?? null]))
  const dayRows = await tx.query<{ unit_id: string; date: string; working: boolean; note: string | null }>(
    `select unit_id::text as unit_id, date::text as date, working, note from calendar_day where date >= $1 and date <= $2`, [span.from, span.to])
  const unitIds = [...new Set(stages.map((s) => s.unitId))]
  const calendar: TimelineCalendar = {
    ...span,
    units: unitIds.map((unitId) => ({
      unitId, unitName: unitName.get(unitId) ?? '',
      closed: closedDaysIn(dayRows.filter((r) => r.unit_id === unitId), span.from, span.to),
    })),
  }

  const rows = await tx.query<{ at: string; by: string | null; entity: string; field: string; old: string | null; new: string | null; reason: string; stage: string | null }>(
    `select to_char(d.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at, a.email as by, d.entity, d.field,
            d.old, d.new, d.reason, m.stage
       from date_change d
       left join account a on a.id = d.user_id
       left join milestone m on d.entity = 'milestone' and m.id = d.entity_id
      where (d.entity = 'orders' and d.entity_id = $1) or (d.entity = 'milestone' and m.order_id = $1)
      order by d.at desc, d.id`, [orderId])

  return {
    today,
    order: {
      id: o.id, po: o.po, buyerId: o.buyerId, buyerName: o.buyerName, style: o.style, colour: o.colour, sizes: o.sizes,
      qty: o.qty, exFactory: o.exFactory, status: stages.length ? result.status : 'grey',
    },
    stages: detail,
    calendar,
    notes: await listOrderNotes(tx, ctx, o.id),
    reasons: await loadReasons(tx),
    history: rows.map((r) => ({
      at: r.at, by: r.by, what: r.entity === 'orders' ? 'Ex-factory date' : `${label(r.stage ?? 'stage')} finish date`,
      from: r.old, to: r.new, reason: r.reason,
    })),
  }
}
