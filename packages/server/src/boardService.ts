import {
  formatMaths, projectOrder,
  type Status, type StageResult,
} from '@isocode/engine'
import { compareDates } from '@isocode/engine/dates'
import { forbidden } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'
import { loadEngineData } from './engineData.js'

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

/**
 * Every order as one row, colour computed by the engine, worst first. Staff only:
 * buyers and supervisors cannot see the events the colour is computed from, so they
 * must never be handed a colour computed here (buyers get confirmed warnings instead).
 */
export async function getBoard(tx: Tx, ctx: Ctx, today: string): Promise<BoardRow[]> {
  if (!isStaff(ctx)) throw forbidden('The board is for merchandisers')

  const { orders, stagesBy, eventsBy, calendars, settings } = await loadEngineData(tx)

  const rows: BoardRow[] = orders.map((o) => {
    const stages = stagesBy.get(o.id) ?? []
    const result = projectOrder({ id: o.id, exFactory: o.exFactory }, stages, eventsBy.get(o.id) ?? [], calendars, today, settings)
    // The stage that sets the colour; among equals the one furthest behind.
    const setting = result.stages
      .filter((s) => s.status === result.status && !s.complete)
      .sort((a, b) => (b.shortBy ?? 0) - (a.shortBy ?? 0))[0] as StageResult | undefined
    const milestone = stages.find((s) => s.stage === setting?.stage)?.milestone
    return {
      orderId: o.id, po: o.po, buyerId: o.buyerId, buyerName: o.buyerName, style: o.style, colour: o.colour,
      exFactory: o.exFactory,
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
