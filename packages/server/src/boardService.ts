import {
  formatMaths, isWaiting, projectOrder,
  type Status, type StageResult,
} from '@isocode/engine'
import { compareDates } from '@isocode/engine/dates'
import { forbidden } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'
import { calendarOfStages, lowConfidenceStages } from './confidence.js'
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
  /** The units that own any stage of the order, by name: what the board's unit filter matches. */
  units: { id: string; name: string }[]
  /** Stages finished out of all stages, and the first one not finished (null when all are done or none are set up). */
  stagesDone: number
  stagesTotal: number
  currentStage: string | null
  /**
   * The pieces of the current stage, read from the same engine result the order page's stage detail shows, so a board row and
   * its order page cannot disagree. All null when there is no current stage. Merchandiser board only: a buyer never gets these.
   */
  currentStageQty: number | null
  currentStageProduced: number | null
  /** The rate behind the stage rests on fewer than 3 days of updates (the order page's `madeIsEstimate`). */
  currentStageMadeIsEstimate: boolean | null
  /** Unfinished stages whose recent updates a merchandiser entered on a visit: low confidence. Internal: never sent to a buyer. */
  lowConfidenceStages: string[]
}

const SORT: Record<Status, number> = { red: 0, amber: 1, grey: 2, green: 3 }

/**
 * Every order as one row, colour computed by the engine, worst first. Staff only:
 * buyers and supervisors cannot see the events the colour is computed from, so they
 * must never be handed a colour computed here (buyers get confirmed warnings instead).
 */
export async function getBoard(tx: Tx, ctx: Ctx, today: string): Promise<BoardRow[]> {
  if (!isStaff(ctx)) throw forbidden('The board is for merchandisers')

  const { orders, stagesBy, eventsBy, onBehalf, calendars, settings } = await loadEngineData(tx)

  const unitNames = new Map((await tx.query<{ id: string; name: string }>('select id::text as id, name from unit')).map((u) => [u.id, u.name]))

  const rows: BoardRow[] = orders.map((o) => {
    const stages = stagesBy.get(o.id) ?? []
    const events = eventsBy.get(o.id) ?? []
    const result = projectOrder({ id: o.id, exFactory: o.exFactory }, stages, events, calendars, today, settings)
    const flagged = lowConfidenceStages(events, onBehalf, today, settings, calendarOfStages(stages, calendars))
    // The stage that sets the colour; among equals the one furthest behind.
    const setting = result.stages
      .filter((s) => s.status === result.status && !s.complete && !isWaiting(s))
      .sort((a, b) => (b.shortBy ?? 0) - (a.shortBy ?? 0))[0] as StageResult | undefined
    const milestone = stages.find((s) => s.stage === setting?.stage)?.milestone
    // The engine returns stages in sequence order, so the first one not complete is where the order is now.
    const unitIds = [...new Set(stages.map((s) => s.unitId))]
    const current = result.stages.find((s) => !s.complete)
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
      units: unitIds.map((id) => ({ id, name: unitNames.get(id) ?? '' })).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      stagesDone: result.stages.filter((s) => s.complete).length,
      stagesTotal: result.stages.length,
      currentStage: current?.stage ?? null,
      currentStageQty: current?.qty ?? null,
      currentStageProduced: current?.produced ?? null,
      currentStageMadeIsEstimate: current?.madeIsEstimate ?? null,
      lowConfidenceStages: result.stages.filter((s) => !s.complete && flagged.has(s.stage)).map((s) => s.stage),
    }
  })

  return rows.sort((a, b) =>
    SORT[a.status] - SORT[b.status] || compareDates(a.exFactory, b.exFactory) || a.po.localeCompare(b.po) ||
    a.style.localeCompare(b.style) || a.colour.localeCompare(b.colour) || (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0))
}
