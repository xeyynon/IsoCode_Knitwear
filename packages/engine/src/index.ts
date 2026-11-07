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

    // The rate comes from COMPLETED days. Today is still being worked, so a morning's first small
    // update is not a low day and must not drag the rate down (and raise a false warning). Today only
    // counts toward the rate when there are too few finished days to go on. Today's pieces still count
    // in full toward what has been made.
    const finished = dataDates.filter((d) => compareDates(d, today) < 0)
    const rateDates = finished.length >= settings.minDataDays ? finished : dataDates
    const windowAvg = rateDates.length
      ? rateDates.slice(0, settings.windowDays).reduce((s, d) => s + (perDay.get(d) ?? 0), 0) /
        Math.min(rateDates.length, settings.windowDays)
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
    // A stage with no projection must not reset the chain: carry the latest known end past it.
    if (projectedEnd !== null && (prevEnd === null || compareDates(projectedEnd, prevEnd) > 0)) prevEnd = projectedEnd

    // Compare exactly, round only to display: a shortfall under half a piece must not round to 0 and
    // read as "on pace" (BUG-056). Anything genuinely short shows as at least 1. The epsilon only
    // absorbs floating-point noise in an average, it is not a tolerance.
    const exactShort = complete ? 0 : made === null ? null : remaining - made * daysLeft
    const shortBy = exactShort === null ? null : exactShort > 1e-9 ? Math.max(1, Math.round(exactShort)) : 0
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
    // A passed milestone with pieces left is late with or without data (DEC-018: a new order set
    // up with stages already due shows late), so only a stage still in time can be "no update yet".
    if (!hasData && r.needed !== null) { r.status = 'grey'; r.reasons.push('no update yet'); return }

    const red: string[] = []
    // No working days left also covers the milestone day itself, which is still being worked:
    // red either way, but only call it "passed" once the date is behind us.
    if (r.needed === null) {
      red.push(compareDates(ordered[i]!.milestone, today) === 0
        ? MILESTONE_TODAY : 'milestone passed with pieces remaining')
    }
    else if (r.made !== null && r.made < settings.redBelow * r.needed) red.push('making less than 90% of needed')
    if (r.made !== null && r.made <= 0) red.push('no output')
    // Deliberate deviation from the written spec (see md/run_rate_engine.md, "Spec conflict"):
    // slipping past the stage milestone is NOT red by itself, or the amber band
    // (making 90-100% of needed) could never be reached. Red is "past ex-factory".
    // Name the right cause (BUG-057): this stage's own projection, or only a later stage's.
    if (pastEx[i]) red.push(PAST_EX_SELF)
    else if (i < lastPastIdx) red.push(PAST_EX_LATER)
    if (red.length) { r.status = 'red'; r.reasons.push(...red); return }

    const amber: string[] = []
    if (r.made !== null && r.needed !== null && r.made < r.needed) amber.push('making 90-100% of needed')
    if (r.bufferDays !== null && r.bufferDays < settings.bufferDays) amber.push('buffer before ex-factory under 2 working days')
    if (amber.length) { r.status = 'amber'; r.reasons.push(...amber); return }

    // Green needs real, fresh data. A planned rate is a plan, not a reading, so a stage with no update
    // at all is grey however good the plan looks (BUG-055); a good rate that has gone quiet is grey too.
    // Red and amber from a plan are kept (DEC-010): they are warnings, and a warning is safe to show.
    if (r.produced === 0) { r.status = 'grey'; r.reasons.push('no update yet') }
    else if (r.noRecentUpdate) { r.status = 'grey'; r.reasons.push('no update on the last working day') }
    else r.status = 'green'
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

const MILESTONE_TODAY = 'milestone is today with pieces remaining'
const PAST_EX_SELF = 'this stage is projected past ex-factory'
const PAST_EX_LATER = 'a later stage is pushed past ex-factory'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const formatDay = (d: IsoDate): string => {
  const [, m, day] = d.split('-').map(Number) as [number, number, number]
  return `${day} ${MONTHS[m - 1]}`
}

/** The sentence shown under a stage: "Need 467/day · making 350/day · 700 pcs short by 11 Nov." */
export function formatMaths(r: StageResult, milestone: IsoDate): string {
  if (r.complete) return 'Stage complete.'
  // A rate above zero never prints as 0: "Need 0/day" with pieces left reads as a placeholder.
  const perDay = (x: number) => (x > 0 ? Math.max(1, Math.round(x)) : 0)
  const need = r.needed !== null ? `Need ${perDay(r.needed)}/day`
    : r.reasons.includes(MILESTONE_TODAY) ? 'milestone is due today' : 'milestone has passed'
  if (r.made === null) return `${need} · no output recorded yet.`
  const rate = `making ${perDay(r.made)}/day${r.madeIsEstimate ? ' (estimate)' : ''}`
  // "On pace" is a claim: it needs no shortfall AND a projected finish on or before the milestone
  // (the stage may have enough pieces a day yet be held up by the stage before it).
  const late = r.projectedEnd !== null && compareDates(r.projectedEnd, milestone) > 0
  const short = r.shortBy && r.shortBy > 0
    ? ` · ${r.shortBy} ${r.shortBy === 1 ? 'pc' : 'pcs'} short by ${formatDay(milestone)}`
    : late ? ` · held up, projected to finish ${formatDay(r.projectedEnd!)}, after ${formatDay(milestone)}`
    : ' · on pace'
  return `${need} · ${rate}${short}.`
}

export { backSchedule, type Schedule, type ScheduledMilestone, type TemplateStep } from './tna.js'

export { addDays, compareDates, isWorking } from './dates.js'
