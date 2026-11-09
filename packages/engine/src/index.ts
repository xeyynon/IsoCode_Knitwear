// The run-rate engine. One pure function: no database, no clock, no I/O.
// The rules are described in README.md ("How the colours are decided"). The caller passes `today`.
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

/** What each setting may be (BE-005). A value outside its range is not a setting, it is a mistake. */
const SETTING_OK: Record<keyof Settings, (v: number) => boolean> = {
  windowDays: (v) => Number.isInteger(v) && v >= 1 && v <= 365,
  minDataDays: (v) => Number.isInteger(v) && v >= 1 && v <= 365,
  rampUpDays: (v) => Number.isInteger(v) && v >= 0 && v <= 365,
  redBelow: (v) => v > 0 && v <= 1,
  bufferDays: (v) => Number.isInteger(v) && v >= 0 && v <= 365,
  warnWithinDays: (v) => Number.isInteger(v) && v >= 0 && v <= 3650,
}
/** True when `value` is a usable value for the setting `key`. */
export const isValidSetting = (key: keyof Settings, value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && SETTING_OK[key](value)

/** Every key checked on its own: a bad or missing one takes its default, the others are kept. */
export function normalizeSettings(raw: Partial<Record<keyof Settings, unknown>> | Settings): Settings {
  const out = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(SETTING_OK) as (keyof Settings)[]) {
    const v = raw[key]
    if (isValidSetting(key, v)) out[key] = v
  }
  return out
}

/** "90", "92.5": a fraction as the percentage a person reads. */
const pct = (x: number): string => String(+(x * 100).toFixed(1))

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

/**
 * Whole days needed to make `remaining` pieces at `rate` a day. A rate that is only a float must not turn
 * an exact answer (15) into 15.000000000000002 and then 16, so the same 1e-9 the shortfall uses below is
 * allowed for noise. Pieces left always take at least one day.
 */
export const daysAtRate = (remaining: number, rate: number): number => Math.max(1, Math.ceil(remaining / rate - 1e-9))

/**
 * The same for a rate that is a total over a number of days (`sum` pieces in `n` days). With whole pieces this is
 * an exact integer ceil(remaining * n / sum): no rounding can move it by a day.
 */
export function daysAtAverage(remaining: number, sum: number, n: number): number {
  const num = remaining * n
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(sum) || sum <= 0) return daysAtRate(remaining, sum / n)
  return (num - (num % sum)) / sum + (num % sum > 0 ? 1 : 0)
}

const RANK: Record<Status, number> = { green: 0, grey: 1, amber: 2, red: 3 }
const worst = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b)

/** A retried send must never double-count: first event per client_uuid wins. Bad quantities and days after `today` are not counted. */
export function cleanEvents(events: readonly UpdateEvent[], today: IsoDate): UpdateEvent[] {
  const seen = new Set<string>()
  return events.filter((e) => {
    if (seen.has(e.clientUuid)) return false
    seen.add(e.clientUuid)
    return Number.isFinite(e.qty) && e.qty >= 0 && compareDates(e.date, today) <= 0
  })
}

/**
 * Which of a stage's days feed its rate: `dataDates` are the working days with an update, newest first.
 * The rate comes from COMPLETED days. Today is still being worked, so a morning's first small update is not
 * a low day and must not drag the rate down (and raise a false warning). Today only counts when there are
 * too few finished days to go on. At most `windowDays` of them are averaged. (DEC-010, DEC-021.)
 */
export function pickRateDates(dataDates: readonly IsoDate[], today: IsoDate, settings: Settings): IsoDate[] {
  const finished = dataDates.filter((d) => compareDates(d, today) < 0)
  return (finished.length >= settings.minDataDays ? finished : [...dataDates]).slice(0, settings.windowDays)
}

/**
 * The dates the rate of ONE stage rests on, newest first, from that stage's events (already cleaned with
 * `cleanEvents`). This is the rule `projectOrder` uses for `made`, so anything that asks "which updates did
 * this rate come from" (the low-confidence flag) asks it here and cannot drift (BE-004).
 */
export function rateDates(
  stageEvents: readonly UpdateEvent[], cal: UnitCalendar | undefined, today: IsoDate, settings: Settings = DEFAULT_SETTINGS,
): IsoDate[] {
  const dates = new Set<IsoDate>()
  for (const e of stageEvents) if (isWorking(cal, e.date)) dates.add(e.date)
  return pickRateDates([...dates].sort((a, b) => compareDates(b, a)), today, normalizeSettings(settings))
}

export function projectOrder(
  order: Order,
  stages: Stage[],
  events: UpdateEvent[],
  calendars: Record<string, UnitCalendar>,
  today: IsoDate,
  rawSettings: Settings = DEFAULT_SETTINGS,
): OrderResult {
  const settings = normalizeSettings(rawSettings)
  const clean = cleanEvents(events, today)

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

    // Which days make the rate is one shared rule (pickRateDates). Today's pieces still count in full
    // toward what has been made.
    const windowDates = pickRateDates(dataDates, today, settings)
    const windowSum = windowDates.reduce((s, d) => s + (perDay.get(d) ?? 0), 0)
    const windowAvg = windowDates.length ? windowSum / windowDates.length : null
    const thin = dataDays < settings.minDataDays
    const made = thin ? (st.plannedRate ?? windowAvg) : windowAvg
    // Whole working days to finish at that rate. When the rate is the average of the window itself the
    // division is done in whole numbers (BE-001); a planned rate is an ordinary number.
    const fromWindow = made !== null && made === windowAvg
    const madeIsEstimate = thin && made !== null

    const daysLeft = compareDates(st.milestone, today) > 0 ? workingDaysBetween(cal, today, st.milestone) : 0
    const needed = remaining === 0 ? 0 : daysLeft > 0 ? remaining / daysLeft : null

    let projectedEnd: IsoDate | null = null
    if (complete) {
      projectedEnd = dataDates[0] ?? today
    } else if (made !== null && made > 0) {
      // Chaining: this stage cannot finish before the previous one projected to end.
      const from = prevEnd !== null && compareDates(prevEnd, today) > 0 ? prevEnd : today
      projectedEnd = nthWorkingDayAfter(cal, from, fromWindow ? daysAtAverage(remaining, windowSum, windowDates.length) : daysAtRate(remaining, made))
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
    if (!hasData && r.needed !== null) {
      r.status = 'grey'
      // A stage that has not started while the stage before it is still running is simply waiting its turn (Stitching while
      // Cutting runs). It is shown as waiting and does not set the order's colour; otherwise every order with stages still
      // ahead would read grey and the board could never show green. Once the previous stage is complete, silence here is
      // "no update yet" again, and a passed milestone is still red (above).
      r.reasons.push(i > 0 && !results[i - 1]!.complete ? WAITING : 'no update yet')
      return
    }

    const red: string[] = []
    // No working days left also covers the milestone day itself, which is still being worked:
    // red either way, but only call it "passed" once the date is behind us.
    if (r.needed === null) {
      red.push(compareDates(ordered[i]!.milestone, today) === 0
        ? MILESTONE_TODAY : 'milestone passed with pieces remaining')
    }
    else if (r.made !== null && r.made < settings.redBelow * r.needed) red.push(`making less than ${pct(settings.redBelow)}% of needed`)
    if (r.made !== null && r.made <= 0) red.push('no output')
    // Deliberate deviation from the written spec (README.md, "How the colours are decided"):
    // slipping past the stage milestone is NOT red by itself, or the amber band
    // (making between the red line and 100% of needed) could never be reached. Red is "past ex-factory".
    // Name the right cause (BUG-057): this stage's own projection, or only a later stage's.
    if (pastEx[i]) red.push(PAST_EX_SELF)
    else if (i < lastPastIdx) red.push(PAST_EX_LATER)
    if (red.length) { r.status = 'red'; r.reasons.push(...red); return }

    const amber: string[] = []
    if (r.made !== null && r.needed !== null && r.made < r.needed) amber.push(`making ${pct(settings.redBelow)}-100% of needed`)
    if (r.bufferDays !== null && r.bufferDays < settings.bufferDays) amber.push(`buffer before ex-factory under ${settings.bufferDays} working ${settings.bufferDays === 1 ? 'day' : 'days'}`)
    if (amber.length) { r.status = 'amber'; r.reasons.push(...amber); return }

    // Green needs real, fresh data. A planned rate is a plan, not a reading, so a stage with no update
    // at all is grey however good the plan looks (BUG-055); a good rate that has gone quiet is grey too.
    // Red and amber from a plan are kept (DEC-010): they are warnings, and a warning is safe to show.
    if (r.produced === 0) { r.status = 'grey'; r.reasons.push('no update yet') }
    else if (r.noRecentUpdate) { r.status = 'grey'; r.reasons.push('no update on the last working day') }
    else r.status = 'green'
  })

  // Waiting stages do not count, unless nothing else is left to judge (never true in practice: the first unfinished stage is never waiting).
  const counted = results.filter((r) => !isWaiting(r))
  const status = (counted.length ? counted : results).reduce<Status>((acc, r) => worst(acc, r.status), 'green')

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
/** The reason on a stage that has not started because the stage before it is still running. */
export const WAITING = 'waiting for the previous stage'
/** A stage that is waiting its turn: shown, but it never sets the order's colour. */
export const isWaiting = (r: Pick<StageResult, 'reasons'>): boolean => r.reasons.includes(WAITING)
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

export { addDays, compareDates, isWorking, isSunday, isDateInWindow, MIN_DATE, MAX_DATE, workingDaysBetween, nthWorkingDayAfter } from './dates.js'

export { composeReasonNote, cleanReasonIds, REASON_IDS, MAX_REASONS, type NoteLang, type ReasonId } from './reasonNote.js'
