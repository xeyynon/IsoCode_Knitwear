// A merchandiser enters a stage on a visit (a subcontractor has no one to send a daily count).
// What the form checks and the words around it, without React, so it can be tested.
import { shortDate } from '../board/boardLogic'
import { pieces } from '../numberFormat'
import { notWholeNumber, parsePieces } from '../dates'
import { noteToSend } from '../notes/reasons'
import { isRealDate } from './orderForm'

/** The words that travel with the warning icon: the flag is never carried by colour alone. */
export const LOW_CONFIDENCE = 'Entered by a merchandiser, low confidence'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "Sewing: entered by a merchandiser, low confidence" for the board; null when no stage is flagged (or an older server sent no list). */
export function lowConfidenceText(stages: string[] | undefined): string | null {
  if (!stages || stages.length === 0) return null
  const names = stages.length === 1 ? stages[0]! : `${stages.slice(0, -1).join(', ')} and ${stages[stages.length - 1]}`
  return `${cap(names)}: ${LOW_CONFIDENCE.charAt(0).toLowerCase()}${LOW_CONFIDENCE.slice(1)}`
}

export interface VisitEntryForm { stage: string; date: string; pieces: string; note: string }
export interface VisitEntryBody {
  clientUuid: string; orderId: string; stage: string; date: string; qty: number
  note?: { text?: string; category?: string }
}
export type VisitEntryCheck =
  | { ok: true; body: VisitEntryBody }
  | { ok: false; field: 'stage' | 'date' | 'pieces'; error: string; /** True when the entry is allowed if the person confirms it (more than is left, but not more than the whole stage). */ confirm?: boolean }

/**
 * The same rules the supervisor's field uses (a whole number; "-5" is refused, never read as 5),
 * plus a stage of this order and a real date that has already come. The server checks all of it again.
 * `clientUuid` is made once per entry and kept until it is accepted, so a retry is never counted twice.
 */
export function checkVisitEntry(
  f: VisitEntryForm,
  ctx: {
    today: string; stages: string[]; orderId: string; clientUuid: string
    /** Pieces still to make in the chosen stage and the stage's whole quantity: when given, a count above what is left asks first (FE-M-02). */
    left?: number; stageQty?: number
    /** The person has already answered "add it anyway". */
    confirmed?: boolean
  },
): VisitEntryCheck {
  if (!ctx.stages.includes(f.stage)) return { ok: false, field: 'stage', error: 'Choose the stage.' }
  if (!isRealDate(f.date)) return { ok: false, field: 'date', error: 'Choose the date of the count.' }
  if (f.date > ctx.today) return { ok: false, field: 'date', error: 'That date has not come yet.' }
  if (f.pieces.trim() === '') return { ok: false, field: 'pieces', error: 'Enter how many pieces were made.' }
  if (/^[\s,]*0[\s0,]*$/.test(f.pieces)) return { ok: false, field: 'pieces', error: 'Enter at least 1 piece. A day with no output is not an update.' }
  const qty = parsePieces(f.pieces)
  if (qty === null) {
    return { ok: false, field: 'pieces', error: notWholeNumber(f.pieces) ? 'Enter a whole number of pieces, such as 300. Minus signs, letters and decimals are not accepted.' : 'Enter how many pieces were made.' }
  }
  const stage = cap(f.stage)
  if (ctx.stageQty !== undefined && qty > ctx.stageQty) {
    return { ok: false, field: 'pieces', error: `That is more than the whole ${stage} quantity (${pieces(ctx.stageQty)} pieces). Check the number.` }
  }
  if (ctx.left !== undefined && qty > ctx.left && !ctx.confirmed) {
    return { ok: false, field: 'pieces', confirm: true, error: `That is more than the ${pieces(ctx.left)} pieces left on ${stage}. Press Add anyway if the number is right.` }
  }
  const note = noteToSend(f.note, null)
  return { ok: true, body: { clientUuid: ctx.clientUuid, orderId: ctx.orderId, stage: f.stage, date: f.date, qty, ...(note ? { note } : {}) } }
}

/** What to say once the server has the entry. */
export const visitEntryDone = (stage: string, qty: number, date: string): string =>
  `Added ${pieces(qty)} piece${qty === 1 ? '' : 's'} to ${cap(stage)} for ${shortDate(date)}. It is marked as entered by a merchandiser.`
