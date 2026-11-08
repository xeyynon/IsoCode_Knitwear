// The words and the bar on each board row, made from the pieces of the order's current stage (UI/UX plan slice 3.4, audit 02 finding 4).
// The server sends currentStageQty / currentStageProduced / currentStageMadeIsEstimate on each row, from the same result as the order page's
// stage detail, so a row and its page cannot disagree. Pure, so the rules are tested without a browser. Nothing here estimates a number
// that was not reported: no quantity, no stage, or a number that is not one means no bar.
import { pieces } from '../numberFormat'
import { barFraction, percentText } from '../stages/pieceProgress'
import type { BoardRow } from './boardLogic'

export interface PiecesProgress {
  /** "Sewing · 1,750 of 4,550 pieces", or words when nothing is reported yet. */
  text: string
  /** The same for a screen reader and the tooltip, with the share and the estimate caveat. */
  label: string
  /** 0 to 1, stopped at full: the numbers keep the real count. */
  fraction: number
  /** The rate behind this stage rests on fewer than 3 days of updates, and there is something reported to estimate from. */
  estimate: boolean
  /** "1 of 4 stages done", only when the order has more than one stage. */
  stagesNote: string | null
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export function piecesProgress(r: BoardRow): PiecesProgress | null {
  const { currentStage, currentStageQty: qty, currentStageProduced: produced } = r
  if (!currentStage) return null
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) return null
  if (typeof produced !== 'number' || !Number.isFinite(produced) || produced < 0) return null

  const name = cap(currentStage)
  const reported = produced > 0
  const estimate = reported && r.currentStageMadeIsEstimate === true

  const text = reported
    ? `${name} · ${pieces(produced)} of ${pieces(qty)} pieces`
    : `${name} · no pieces reported yet (${pieces(qty)} planned)`
  let label = reported
    ? `${name}: ${pieces(produced)} of ${pieces(qty)} pieces made, ${produced > qty ? 'more than planned' : percentText(produced, qty)}`
    : `${name}: no pieces reported yet, ${pieces(qty)} planned`
  if (estimate) label += '. The rate is an estimate: fewer than 3 days of updates so far'

  const total = r.stagesTotal ?? 0
  const done = Math.min(Math.max(r.stagesDone ?? 0, 0), total)
  const stagesNote = total > 1 ? `${done} of ${total} stages done` : null

  return { text, label, fraction: barFraction(produced, qty), estimate, stagesNote }
}
