import {
  DEFAULT_SETTINGS, formatMaths, projectOrder,
  type Settings, type Stage, type Status, type StageResult, type UnitCalendar, type UpdateEvent,
} from '@isocode/engine'
import { compareDates } from '@isocode/engine/dates'
import { forbidden } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'

export interface BoardRow {
  orderId: string
  po: string
  buyerId: string
  buyerName: string
  style: string
  colour: string
  exFactory: string
  status: Status
  /** The stage that sets the colour, with the maths behind it. */
  worstStage: string | null
  maths: string | null
  shortBy: number | null
  reasons: string[]
  /** The last working day has no update on an active stage (colour may still be red/amber). */
  noRecentUpdate: boolean
  hasWarning: boolean
}

const SORT: Record<Status, number> = { red: 0, amber: 1, grey: 2, green: 3 }

const SETTING_KEYS: Record<string, keyof Settings> = {
  window_days: 'windowDays', min_data_days: 'minDataDays', ramp_up_days: 'rampUpDays',
  red_below: 'redBelow', buffer_days: 'bufferDays', warn_within_days: 'warnWithinDays',
}

async function loadSettings(tx: Tx): Promise<Settings> {
  const rows = await tx.query<{ key: string; value: unknown }>('select key, value from settings')
  const s: Settings = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    const k = SETTING_KEYS[r.key]
    const v = Number(r.value)
    if (k && Number.isFinite(v)) s[k] = v
  }
  return s
}

/**
 * Every order as one row, colour computed by the engine, worst first. Staff only:
 * buyers and supervisors cannot see the events the colour is computed from, so they
 * must never be handed a colour computed here (buyers get confirmed warnings instead).
 */
export async function getBoard(tx: Tx, ctx: Ctx, today: string): Promise<BoardRow[]> {
  if (!isStaff(ctx)) throw forbidden('The board is for merchandisers')

  const [orders, milestones, events, days, settings] = await Promise.all([
    tx.query<{ id: string; po: string; buyer_id: string; buyer_name: string; style: string; colour: string; ex_factory: string }>(
      `select o.id::text as id, o.po, o.buyer_id::text as buyer_id, b.name as buyer_name, o.style, o.colour,
              o.ex_factory::text as ex_factory
         from orders o join buyer b on b.id = o.buyer_id`),
    tx.query<{ order_id: string; stage: string; unit_id: string; planned_end: string; sequence: number; qty: number; planned_rate: number | null }>(
      `select order_id::text as order_id, stage, unit_id::text as unit_id, planned_end::text as planned_end,
              sequence, qty, planned_rate::float8 as planned_rate
         from milestone`),
    tx.query<{ client_uuid: string; order_id: string; stage: string; date: string; qty: number }>(
      `select client_uuid::text as client_uuid, order_id::text as order_id, stage, date::text as date, qty from update_event`),
    tx.query<{ unit_id: string; date: string; working: boolean }>(
      `select unit_id::text as unit_id, date::text as date, working from calendar_day`),
    loadSettings(tx),
  ])

  const calendars: Record<string, UnitCalendar> = {}
  for (const d of days) (calendars[d.unit_id] ??= { days: {} }).days![d.date] = d.working

  const stagesBy = new Map<string, Stage[]>()
  for (const m of milestones) {
    const list = stagesBy.get(m.order_id) ?? []
    list.push({
      stage: m.stage, unitId: m.unit_id, qty: m.qty, milestone: m.planned_end, sequence: m.sequence,
      ...(m.planned_rate !== null ? { plannedRate: m.planned_rate } : {}),
    })
    stagesBy.set(m.order_id, list)
  }
  const eventsBy = new Map<string, UpdateEvent[]>()
  for (const e of events) {
    const list = eventsBy.get(e.order_id) ?? []
    list.push({ clientUuid: e.client_uuid, stage: e.stage, date: e.date, qty: e.qty })
    eventsBy.set(e.order_id, list)
  }

  const rows: BoardRow[] = orders.map((o) => {
    const stages = stagesBy.get(o.id) ?? []
    const result = projectOrder({ id: o.id, exFactory: o.ex_factory }, stages, eventsBy.get(o.id) ?? [], calendars, today, settings)
    // The stage that sets the colour; among equals the one furthest behind.
    const setting = result.stages
      .filter((s) => s.status === result.status && !s.complete)
      .sort((a, b) => (b.shortBy ?? 0) - (a.shortBy ?? 0))[0] as StageResult | undefined
    const milestone = stages.find((s) => s.stage === setting?.stage)?.milestone
    return {
      orderId: o.id, po: o.po, buyerId: o.buyer_id, buyerName: o.buyer_name, style: o.style, colour: o.colour,
      exFactory: o.ex_factory,
      // An order with no stages cannot be judged: grey, never green.
      status: stages.length ? result.status : 'grey',
      worstStage: setting?.stage ?? null,
      maths: setting && milestone ? formatMaths(setting, milestone) : null,
      shortBy: setting?.shortBy ?? null,
      reasons: setting?.reasons ?? (stages.length ? [] : ['no stages set up']),
      noRecentUpdate: result.stages.some((s) => s.noRecentUpdate),
      hasWarning: result.warning !== null,
    }
  })

  return rows.sort((a, b) =>
    SORT[a.status] - SORT[b.status] || compareDates(a.exFactory, b.exFactory) || a.po.localeCompare(b.po))
}
