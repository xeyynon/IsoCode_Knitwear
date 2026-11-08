// What the order page decides, without React, so it can be tested.
import type { Status } from '../board/boardLogic'
import { daysBetween } from './orderForm'

/** The address parameter that carries the board's own query string (filters, search, sort). */
export const BACK_PARAM = 'from'
const MAX_CARRIED = 500

/** Re-serialise so whatever was carried is only ever plain parameters, and never long. */
function cleanQuery(raw: string | null | undefined): string {
  const q = (raw ?? '').replace(/^\?/, '')
  if (!q || q.length > MAX_CARRIED) return ''
  return new URLSearchParams(q).toString()
}

/** The link from a board row to its order. It carries the board's query so "Back" returns to the same view. */
export function orderLink(orderId: string, boardQuery: string): string {
  const q = cleanQuery(boardQuery)
  return q ? `/orders/${orderId}?${BACK_PARAM}=${encodeURIComponent(q)}` : `/orders/${orderId}`
}

/** Where "Back to board" goes. Read from the address alone, so a reload or a shared link keeps it. */
export function backToBoard(carried: string | null): string {
  const q = cleanQuery(carried)
  return q ? `/board?${q}` : '/board'
}

/**
 * The date-change history as a reader expects it (FE-M-13): changes that were saved in the same second belong to one change, and in it the
 * ex-factory row comes first, then the stages in the order the server sent them. The order between changes is left as it came.
 */
export function historyOrder<T extends { at: string; what: string }>(rows: T[]): T[] {
  const out: T[] = []
  for (let i = 0; i < rows.length; ) {
    const key = rows[i]!.at.slice(0, 19)
    let j = i
    while (j < rows.length && rows[j]!.at.slice(0, 19) === key) j++
    const run = rows.slice(i, j)
    out.push(...run.filter((r) => r.what.startsWith('Ex-factory')), ...run.filter((r) => !r.what.startsWith('Ex-factory')))
    i = j
  }
  return out
}

export interface TimelineStage {
  stage: string; sequence: number; status: Status; complete: boolean; plannedEnd: string; projectedEnd: string | null
}

export interface TimelineRow {
  stage: string
  status: Status
  planned: string
  projected: string | null
  done: boolean
  /** Whole days the projection is after (+) or before (-) the plan; null when finished or not worked out. */
  days: number | null
  /** "3 days late", "1 day early", "on plan", "Done", "Not enough data". */
  text: string
}

export function timelineRows(stages: TimelineStage[]): TimelineRow[] {
  return [...stages].sort((a, b) => a.sequence - b.sequence).map((s) => {
    const base = { stage: s.stage, status: s.status, planned: s.plannedEnd }
    if (s.complete) return { ...base, projected: s.projectedEnd, done: true, days: null, text: 'Done' }
    if (!s.projectedEnd) return { ...base, projected: null, done: false, days: null, text: 'Not enough data' }
    const days = daysBetween(s.plannedEnd, s.projectedEnd)
    const n = Math.abs(days)
    const text = days === 0 ? 'on plan' : `${n} day${n === 1 ? '' : 's'} ${days > 0 ? 'late' : 'early'}`
    return { ...base, projected: s.projectedEnd, done: false, days, text }
  })
}
