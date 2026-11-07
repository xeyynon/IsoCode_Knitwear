// Loads what the run-rate engine needs, shared by the board (all orders) and the order detail
// (one order), so the two can never disagree about the data behind a colour.
import { DEFAULT_SETTINGS, type Settings, type Stage, type UnitCalendar, type UpdateEvent } from '@isocode/engine'
import type { Tx } from './db.js'

export interface OrderRow {
  id: string
  po: string
  buyerId: string
  buyerName: string
  style: string
  colour: string
  sizes: Record<string, number>
  qty: number
  exFactory: string
}

export interface EngineData {
  orders: OrderRow[]
  stagesBy: Map<string, Stage[]>
  eventsBy: Map<string, UpdateEvent[]>
  /** The clientUuids of the updates a merchandiser entered on a visit. The engine is not told; see confidence.ts. */
  onBehalf: Set<string>
  calendars: Record<string, UnitCalendar>
  settings: Settings
}

const SETTING_KEYS: Record<string, keyof Settings> = {
  window_days: 'windowDays', min_data_days: 'minDataDays', ramp_up_days: 'rampUpDays',
  red_below: 'redBelow', buffer_days: 'bufferDays', warn_within_days: 'warnWithinDays',
}

export async function loadSettings(tx: Tx): Promise<Settings> {
  const rows = await tx.query<{ key: string; value: unknown }>('select key, value from settings')
  const s: Settings = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    const k = SETTING_KEYS[r.key]
    const v = Number(r.value)
    if (k && Number.isFinite(v)) s[k] = v
  }
  return s
}

/** Every order, or just `orderId`. Row-level security still decides which rows the caller may see. */
export async function loadEngineData(tx: Tx, orderId?: string): Promise<EngineData> {
  const one = orderId !== undefined
  const arg = one ? [orderId] : []
  const [orders, milestones, events, days, settings] = await Promise.all([
    tx.query<{ id: string; po: string; buyer_id: string; buyer_name: string; style: string; colour: string; sizes: Record<string, number>; qty: number; ex_factory: string }>(
      `select o.id::text as id, o.po, o.buyer_id::text as buyer_id, b.name as buyer_name, o.style, o.colour, o.sizes, o.qty,
              o.ex_factory::text as ex_factory
         from orders o join buyer b on b.id = o.buyer_id ${one ? 'where o.id = $1' : ''}
        order by o.ex_factory, o.po, o.style, o.colour, o.id`, arg),
    tx.query<{ order_id: string; stage: string; unit_id: string; planned_end: string; sequence: number; qty: number; planned_rate: number | null }>(
      `select order_id::text as order_id, stage, unit_id::text as unit_id, planned_end::text as planned_end,
              sequence, qty, planned_rate::float8 as planned_rate
         from milestone ${one ? 'where order_id = $1' : ''}
        order by order_id, sequence, stage, id`, arg),
    tx.query<{ client_uuid: string; order_id: string; stage: string; date: string; qty: number; on_behalf: boolean }>(
      `select client_uuid::text as client_uuid, order_id::text as order_id, stage, date::text as date, qty, on_behalf
         from update_event ${one ? 'where order_id = $1' : ''}
        order by order_id, date, client_uuid`, arg),
    tx.query<{ unit_id: string; date: string; working: boolean }>(
      `select unit_id::text as unit_id, date::text as date, working from calendar_day order by unit_id, date`),
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
  const onBehalf = new Set<string>()
  for (const e of events) {
    if (e.on_behalf) onBehalf.add(e.client_uuid)
    const list = eventsBy.get(e.order_id) ?? []
    list.push({ clientUuid: e.client_uuid, stage: e.stage, date: e.date, qty: e.qty })
    eventsBy.set(e.order_id, list)
  }

  return {
    orders: orders.map((o) => ({ id: o.id, po: o.po, buyerId: o.buyer_id, buyerName: o.buyer_name, style: o.style, colour: o.colour, sizes: o.sizes ?? {}, qty: o.qty, exFactory: o.ex_factory })),
    stagesBy, eventsBy, onBehalf, calendars, settings,
  }
}
