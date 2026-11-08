// Date-only helpers. Dates are "YYYY-MM-DD" strings, always interpreted in the
// unit's local calendar. All arithmetic is done in UTC so the machine's time
// zone can never shift a day.
//
// Speed (O-1): inside, a date is a whole day number (days since 1970-01-01). A "YYYY-MM-DD" string is read with charCodeAt
// and the calendar formulas, not split and Date.UTC; a date is written back with the same formulas, not toISOString. A
// calendar's exceptions are read once into a sorted list with running totals, so counting the working days between two
// dates is two binary searches. Every function returns exactly what the Date-based code it replaced returned, including for
// text that is not a plain date (that falls back to the old reading); packages/engine/test/optDates.test.ts compares them
// with a copy of the old code over a large random set.
export type IsoDate = string

const DAY_MS = 86_400_000
// The Gregorian calendar repeats every 400 years (146097 days), which lets years 0000-0099 be computed
// exactly: Date.UTC reads a year 0-99 as 1900-1999 (BE-003).
const CYCLE_MS = 146_097 * DAY_MS

/** The general reader: any text split on '-'. Used when the fast reader below does not recognise the text. */
const toUtcSlow = (d: IsoDate): number => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  return y >= 0 && y < 100 ? Date.UTC(y + 400, m - 1, day) - CYCLE_MS : Date.UTC(y, m - 1, day)
}

/** Day number of 0000-01-01 and of 9999-12-31: between them a day number is written as plain YYYY-MM-DD. */
const MIN_PLAIN = -719_528
const MAX_PLAIN = 2_932_896

/** Days since 1970-01-01 of a proleptic Gregorian date (month 1 to 12; a day past the end of the month rolls on, as Date.UTC does). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1
  return era * 146_097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719_468
}

/**
 * The day number of a date text: the same value as Math.floor(Date-based milliseconds / DAY_MS) for every text (NaN when it is no date).
 * With `plain`, NaN also for any text that is not exactly the spelling of a real date (month 13, 30 February, "2026-1-5", ...): the
 * day walks below return the text they were given when it is already a working day, so they only take the fast road for plain dates.
 */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
function readDay(d: IsoDate, plain: boolean): number {
  if (typeof d === 'string' && d.length === 10 && d.charCodeAt(4) === 45 && d.charCodeAt(7) === 45) {
    const y0 = d.charCodeAt(0) - 48, y1 = d.charCodeAt(1) - 48, y2 = d.charCodeAt(2) - 48, y3 = d.charCodeAt(3) - 48
    const m0 = d.charCodeAt(5) - 48, m1 = d.charCodeAt(6) - 48, d0 = d.charCodeAt(8) - 48, d1 = d.charCodeAt(9) - 48
    if (y0 >= 0 && y0 <= 9 && y1 >= 0 && y1 <= 9 && y2 >= 0 && y2 <= 9 && y3 >= 0 && y3 <= 9 &&
        m0 >= 0 && m0 <= 9 && m1 >= 0 && m1 <= 9 && d0 >= 0 && d0 <= 9 && d1 >= 0 && d1 <= 9) {
      const m = m0 * 10 + m1, day = d0 * 10 + d1, y = ((y0 * 10 + y1) * 10 + y2) * 10 + y3
      if (m >= 1 && m <= 12) {
        if (!plain) return daysFromCivil(y, m, day)
        const leap = m === 2 && y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
        if (day >= 1 && day <= DAYS_IN_MONTH[m - 1]! + (leap ? 1 : 0)) return daysFromCivil(y, m, day)
      }
    }
  }
  return plain ? Number.NaN : Math.floor(toUtcSlow(d) / DAY_MS)
}
const dayNumber = (d: IsoDate): number => readDay(d, false)

const p2 = (x: number): string => (x < 10 ? '0' + x : '' + x)

/** The text of a day number, "YYYY-MM-DD" (what toISOString().slice(0, 10) gave; outside years 0000-9999 it still asks Date, which throws on NaN). */
function isoOfDayNumber(n: number): IsoDate {
  if (!(n >= MIN_PLAIN && n <= MAX_PLAIN)) return new Date(n * DAY_MS).toISOString().slice(0, 10)
  const z = n + 719_468
  const era = Math.floor(z / 146_097)
  const doe = z - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return (y < 10 ? '000' + y : y < 100 ? '00' + y : y < 1000 ? '0' + y : '' + y) + '-' + p2(m) + '-' + p2(day)
}

/**
 * The span of dates this system treats as real: an order, an update or a closed day outside it is a
 * typo (BE-002, BE-003). The server refuses such dates where they come in. The engine itself still
 * computes for any date, in time proportional to weeks, so a stray old row cannot stall the board.
 */
export const MIN_DATE: IsoDate = '2000-01-01'
export const MAX_DATE: IsoDate = '2100-12-31'
/** True for a canonical "YYYY-MM-DD" inside [MIN_DATE, MAX_DATE]. */
export const isDateInWindow = (d: IsoDate): boolean => d >= MIN_DATE && d <= MAX_DATE

export const addDays = (d: IsoDate, n: number): IsoDate => {
  if (Number.isInteger(n)) {
    const x = dayNumber(d) + n
    if (x >= MIN_PLAIN && x <= MAX_PLAIN) return isoOfDayNumber(x)
  }
  return new Date(toUtcSlow(d) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Sundays have day numbers 3, 10, 17, ... (1970-01-04 was one). */
const sundayNumber = (n: number): boolean => (((n - 3) % 7) + 7) % 7 === 0

export const isSunday = (d: IsoDate): boolean => sundayNumber(dayNumber(d))

export const compareDates = (a: IsoDate, b: IsoDate): number => (dayNumber(a) - dayNumber(b)) * DAY_MS

/** One unit's calendar: explicit entries win; otherwise Sundays are closed. */
export interface UnitCalendar {
  /** date -> working? (Deepavali closure, a worked Sunday, short-staffed day) */
  days?: Record<IsoDate, boolean>
}

export const isWorking = (cal: UnitCalendar | undefined, d: IsoDate): boolean => {
  const explicit = cal?.days?.[d]
  return explicit ?? !isSunday(d)
}

/** Sundays among the days in (a, b]. */
const sundaysIn = (a: number, b: number): number => Math.floor((b - 3) / 7) - Math.floor((a - 3) / 7)
const CANONICAL = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/**
 * A calendar read once. `at` are the days where the calendar differs from the plain "Sundays closed" week, in order, as day
 * numbers (+1 for a Sunday marked as worked, -1 for a weekday marked closed) and `sum[i]` is the total of the first i of them,
 * so the net effect on any range is two binary searches. `explicit` is each listed day's answer, for the day-by-day walks.
 * Keys that are not a plain date can never be looked up by a date string, so they are ignored.
 *
 * The index is kept against the `days` object itself (a WeakMap, so it goes when the calendar does). It is built the first time
 * a calendar is used: a calendar must not be changed after that. The server builds a fresh one for each request.
 */
interface CalendarIndex { at: number[]; sum: number[]; explicit: Map<number, boolean> }
const NO_DEVIATIONS: CalendarIndex = { at: [], sum: [0], explicit: new Map() }
const indexes = new WeakMap<object, CalendarIndex>()

function buildIndex(days: Record<IsoDate, boolean>): CalendarIndex {
  const found: { at: number; delta: number }[] = []
  const explicit = new Map<number, boolean>()
  for (const key in days) {
    const w = days[key]
    if (w === undefined || w === null || key.length !== 10 || !CANONICAL.test(key)) continue
    const at = dayNumber(key)
    if (at !== at) continue                                 // not a date
    if (Boolean(w) !== !sundayNumber(at)) found.push({ at, delta: w ? 1 : -1 })
    if (isoOfDayNumber(at) === key) explicit.set(at, Boolean(w))   // the day walks look a day up by its own spelling
  }
  found.sort((p, q) => p.at - q.at)
  const at = found.map((f) => f.at)
  const sum = [0]
  for (const f of found) sum.push(sum[sum.length - 1]! + f.delta)
  return { at, sum, explicit }
}

function indexOf(cal: UnitCalendar | undefined): CalendarIndex {
  const days = cal?.days
  if (!days || typeof days !== 'object') return NO_DEVIATIONS
  let ix = indexes.get(days)
  if (!ix) { ix = buildIndex(days); indexes.set(days, ix) }
  return ix
}

/** How many of the sorted days are <= x. */
function upTo(at: readonly number[], x: number): number {
  let lo = 0, hi = at.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (at[mid]! <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Working days in (from, to]: after `from`, up to and including `to`. Whole weeks are counted, not walked day by day. */
export function workingDaysBetween(cal: UnitCalendar | undefined, from: IsoDate, to: IsoDate): number {
  const a = dayNumber(from), b = dayNumber(to)
  if (!(b > a)) return 0
  let n = b - a - sundaysIn(a, b)
  const ix = indexOf(cal)
  if (ix.at.length) n += ix.sum[upTo(ix.at, b)]! - ix.sum[upTo(ix.at, a)]!
  return n
}

const NTH_CAP_DAYS = 3650

/** The date of the nth working day after `from` (n >= 1). */
export function nthWorkingDayAfter(cal: UnitCalendar | undefined, from: IsoDate, n: number): IsoDate {
  if (!(n >= 1)) return from
  const a = dayNumber(from)
  const ix = indexOf(cal)
  const base = ix.at.length ? ix.sum[upTo(ix.at, a)]! : 0
  const count = (k: number): number => k - sundaysIn(a, a + k) + (ix.at.length ? ix.sum[upTo(ix.at, a + k)]! - base : 0)
  // A calendar with no working days would never reach n; cap at ~10 years, as the walk always did.
  if (count(NTH_CAP_DAYS) < n) return isoOfDayNumber(a + NTH_CAP_DAYS)
  let lo = Math.max(1, Math.ceil(n)), hi = NTH_CAP_DAYS   // count(k) <= k, so the answer is at least n; the first offset whose count reaches n is a working day
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (count(mid) >= n) hi = mid
    else lo = mid + 1
  }
  return isoOfDayNumber(a + lo)
}

// ---- the walks back from a date: at most 3650 + 3650 days, on day numbers -----------------------------------------------
const WALK = 7_400   // the longest walk of the three functions below, plus a margin
const plainRange = (x: number): boolean => x >= MIN_PLAIN + WALK && x <= MAX_PLAIN - WALK

const workingOn = (ix: CalendarIndex, x: number): boolean => {
  const e = ix.explicit.get(x)
  return e !== undefined ? e : !sundayNumber(x)
}

/** The old text-based walks, kept for dates at the very ends of the calendar (years 0000 and 9999) and for text that is no date. */
const slowPreviousWorkingDay = (cal: UnitCalendar | undefined, d: IsoDate): IsoDate => {
  let p = addDays(d, -1)
  for (let i = 0; i < 3650 && !isWorking(cal, p); i++) p = addDays(p, -1)
  return p
}
const slowWorkingDayOnOrBefore = (cal: UnitCalendar | undefined, d: IsoDate): IsoDate => {
  let p = d
  for (let i = 0; i < 3650 && !isWorking(cal, p); i++) p = addDays(p, -1)
  return p
}

/** The most recent working day strictly before `d`. */
export function previousWorkingDay(cal: UnitCalendar | undefined, d: IsoDate): IsoDate {
  const x = readDay(d, true)
  if (!plainRange(x)) return slowPreviousWorkingDay(cal, d)
  const ix = indexOf(cal)
  let p = x - 1
  for (let i = 0; i < 3650 && !workingOn(ix, p); i++) p--
  return isoOfDayNumber(p)
}

/** The latest working day on or before `d`. */
export function workingDayOnOrBefore(cal: UnitCalendar | undefined, d: IsoDate): IsoDate {
  const x = readDay(d, true)
  if (!plainRange(x)) return slowWorkingDayOnOrBefore(cal, d)
  const ix = indexOf(cal)
  let p = x
  for (let i = 0; i < 3650 && !workingOn(ix, p); i++) p--
  return isoOfDayNumber(p)
}

/** `n` working days before `from` (n >= 0), counting back from the latest working day on or before it. */
export function workingDaysBack(cal: UnitCalendar | undefined, from: IsoDate, n: number): IsoDate {
  const x = readDay(from, true)
  if (!plainRange(x)) {
    let d = slowWorkingDayOnOrBefore(cal, from)
    let left = n
    for (let i = 0; i < 3650 && left > 0; i++) {
      d = addDays(d, -1)
      if (isWorking(cal, d)) left--
    }
    return d
  }
  const ix = indexOf(cal)
  let p = x
  for (let i = 0; i < 3650 && !workingOn(ix, p); i++) p--
  let left = n
  for (let i = 0; i < 3650 && left > 0; i++) {
    p--
    if (workingOn(ix, p)) left--
  }
  return isoOfDayNumber(p)
}
