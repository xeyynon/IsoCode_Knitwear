// The run-rate engine. One pure function: no database, no clock, no I/O.
// Spec: md/run_rate_engine.md. The caller passes `today`.
import {
  addDays, compareDates, isWorking, nthWorkingDayAfter, previousWorkingDay, workingDaysBetween,
  type IsoDate, type UnitCalendar,
} from './dates.js'

export type { IsoDate, UnitCalendar } from './dates.js'
export type Status = 'red' | 'amber' | 'green' | 'grey'

export interface Settings {
  windowDays: number      // days with an update averaged into "made"
  minDataDays: number     // fewer than this -> planned rate, labelled estimate
  rampUpDays: number      // first N data days of a stage are flagged ramp-up
  redBelow: number        // made < redBelow * needed -> red
  bufferDays: number      // projected buffer before ex-factory under this -> amber
  warnWithinDays: number  // warning row when amber/red within this many days of a milestone
}
export const DEFAULT_SETTINGS: Settings = {
  windowDays: 5, minDataDays: 3, rampUpDays: 3, redBelow: 0.9, bufferDays: 2, warnWithinDays: 14,
}

export interface Stage {
  stage: string
  unitId: string
  qty: number
  milestone: IsoDate
  sequence: number
  /** Pieces per working day the template planned; used while data is thin. */
  plannedRate?: number
}
export interface UpdateEvent { clientUuid: string; stage: string; date: IsoDate; qty: number }
export interface Order { id: string; exFactory: IsoDate }

export interface StageResult {
  stage: string
  status: Status
  reasons: string[]
  qty: number
  produced: number
  remaining: number
  complete: boolean
  daysLeft: number
  needed: number | null
  made: number | null
  madeIsEstimate: boolean
  dataDays: number
  rampUp: boolean
  projectedEnd: IsoDate | null
  shortBy: number | null
  bufferDays: number | null
  /** The last completed working day has no update for this active stage. */
  noRecentUpdate: boolean
}
export interface Warning { stage: string; status: 'amber' | 'red' }
export interface OrderResult {
  orderId: string
  status: Status
  stages: StageResult[]
  warning: Warning | null
}

const RANK: Record<Status, number> = { green: 0, grey: 1, amber: 2, red: 3 }
const worst = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b)

export function projectOrder(
  order: Order,
  stages: Stage[],
  events: UpdateEvent[],
  calendars: Record<string, UnitCalendar>,
  today: IsoDate,
  settings: Settings = DEFAULT_SETTINGS,
): OrderResult {
  // A retried send must never double-count: first event per client_uuid wins.
  const seen = new Set<string>()
  const clean = events.filter((e) => {
    if (seen.has(e.clientUuid)) return false
    seen.add(e.clientUuid)
    return Number.isFinite(e.qty) && e.qty >= 0 && compareDates(e.date, today) <= 0
  })

  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence)
  const results: StageResult[] = []
  let prevEnd: IsoDate | null = null

  for (const st of ordered) {
    const cal = calendars[st.unitId]
    const mine = clean.filter((e) => e.stage === st.stage)
    const produced = mine.reduce((s, e) => s + e.qty, 0)
    const remaining = Math.max(0, st.qty - produced)
    const complete = remaining === 0

    // Daily totals on working days only, newest first. Closed days are skipped.
    const perDay = new Map<IsoDate, number>()
    for (const e of mine) if (isWorking(cal, e.date)) perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.qty)
    const dataDates = [...perDay.keys()].sort((a, b) => compareDates(b, a))
    const dataDays = dataDates.length

    const windowAvg = dataDays
      ? dataDates.slice(0, settings.windowDays).reduce((s, d) => s + (perDay.get(d) ?? 0), 0) /
        Math.min(dataDays, settings.windowDays)
      : null
    const thin = dataDays < settings.minDataDays
    const made = thin ? (st.plannedRate ?? windowAvg) : windowAvg
    const madeIsEstimate = thin && made !== null

    const daysLeft = compareDates(st.milestone, today) > 0 ? workingDaysBetween(cal, today, st.milestone) : 0
    const needed = remaining === 0 ? 0 : daysLeft > 0 ? remaining / daysLeft : null

    let projectedEnd: IsoDate | null = null
    if (complete) {
      projectedEnd = dataDates[0] ?? today
    } else if (made !== null && made > 0) {
      // Chaining: this stage cannot finish before the previous one projected to end.
      const from = prevEnd !== null && compareDates(prevEnd, today) > 0 ? prevEnd : today
      projectedEnd = nthWorkingDayAfter(cal, from, Math.ceil(remaining / made))
    }
    prevEnd = projectedEnd

    const shortBy = complete ? 0 : made === null ? null : Math.max(0, Math.round(remaining - made * daysLeft))
    const buffer =
      projectedEnd === null ? null
        : compareDates(projectedEnd, order.exFactory) > 0 ? 0
        : workingDaysBetween(cal, projectedEnd, order.exFactory)

    const lastDone = previousWorkingDay(cal, today)
    const hasAnyUpdate = produced > 0
    const noRecentUpdate = !complete && hasAnyUpdate && !perDay.has(lastDone) && !perDay.has(today)

    results.push({
      stage: st.stage, status: 'green', reasons: [], qty: st.qty, produced, remaining, complete,
      daysLeft, needed, made, madeIsEstimate, dataDays,
      rampUp: dataDays > 0 && dataDays <= settings.rampUpDays,
      projectedEnd, shortBy, bufferDays: buffer, noRecentUpdate,
    })
  }

  // "Any later stage pushed past ex-factory" turns this and earlier stages red.
  const pastEx = results.map((r) => !r.complete && r.projectedEnd !== null && compareDates(r.projectedEnd, order.exFactory) > 0)
  const lastPastIdx = pastEx.lastIndexOf(true)

  results.forEach((r, i) => {
    if (r.complete) { r.reasons.push('complete'); return }
    const hasData = r.produced > 0 || r.made !== null
    if (!hasData) { r.status = 'grey'; r.reasons.push('no update yet'); return }

    const red: string[] = []
    if (r.needed === null) red.push('milestone passed with pieces remaining')
    else if (r.made !== null && r.made < settings.redBelow * r.needed) red.push('making less than 90% of needed')
    if (r.made !== null && r.made <= 0) red.push('no output')
    // Deliberate deviation from the written spec (see md/run_rate_engine.md, "Spec conflict"):
    // slipping past the stage milestone is NOT red by itself, or the amber band
    // (making 90-100% of needed) could never be reached. Red is "past ex-factory".
    if (i <= lastPastIdx) red.push('a later stage is pushed past ex-factory')
    if (red.length) { r.status = 'red'; r.reasons.push(...red); return }

    const amber: string[] = []
    if (r.made !== null && r.needed !== null && r.made < r.needed) amber.push('making 90-100% of needed')
    if (r.bufferDays !== null && r.bufferDays < settings.bufferDays) amber.push('buffer before ex-factory under 2 working days')
    if (amber.length) { r.status = 'amber'; r.reasons.push(...amber); return }

    // Green needs fresh data: a good rate that has gone quiet is grey, never green.
    if (r.noRecentUpdate) { r.status = 'grey'; r.reasons.push('no update on the last working day') } else r.status = 'green'
  })

  const status = results.reduce<Status>((acc, r) => worst(acc, r.status), 'green')

  let warning: Warning | null = null
  if (status === 'amber' || status === 'red') {
    const near = results.find(
      (r, i) => !r.complete && (r.status === 'amber' || r.status === 'red') &&
        compareDates(ordered[i]!.milestone, addDays(today, settings.warnWithinDays)) <= 0,
    )
    if (near) warning = { stage: near.stage, status: near.status as 'amber' | 'red' }
  }
  return { orderId: order.id, status, stages: results, warning }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const formatDay = (d: IsoDate): string => {
  const [, m, day] = d.split('-').map(Number) as [number, number, number]
  return `${day} ${MONTHS[m - 1]}`
}

/** The sentence shown under a stage: "Need 467/day · making 350/day · 700 pcs short by 11 Nov." */
export function formatMaths(r: StageResult, milestone: IsoDate): string {
  if (r.complete) return 'Stage complete.'
  const need = r.needed === null ? 'milestone has passed' : `Need ${Math.round(r.needed)}/day`
  if (r.made === null) return `${need} · no output recorded yet.`
  const rate = `making ${Math.round(r.made)}/day${r.madeIsEstimate ? ' (estimate)' : ''}`
  const short = r.shortBy && r.shortBy > 0 ? ` · ${r.shortBy} pcs short by ${formatDay(milestone)}` : ' · on pace'
  return `${need} · ${rate}${short}.`
}
