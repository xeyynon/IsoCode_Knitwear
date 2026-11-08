// ORACLE: a verbatim copy of packages/engine/src/dates.ts as it was BEFORE the OPT-A speed-up (O-1). It is the reference the fast
// implementation must equal for every input. Do not edit it, and do not import it from src: it exists only for tests.
// Date-only helpers. Dates are "YYYY-MM-DD" strings, always interpreted in the
// unit's local calendar. All arithmetic is done in UTC so the machine's time
// zone can never shift a day.
export type IsoDate = string

const DAY_MS = 86_400_000
// The Gregorian calendar repeats every 400 years (146097 days), which lets years 0000-0099 be computed
// exactly: Date.UTC reads a year 0-99 as 1900-1999 (BE-003).
const CYCLE_MS = 146_097 * DAY_MS

const toUtc = (d: IsoDate): number => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  return y >= 0 && y < 100 ? Date.UTC(y + 400, m - 1, day) - CYCLE_MS : Date.UTC(y, m - 1, day)
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

export const addDays = (d: IsoDate, n: number): IsoDate =>
  new Date(toUtc(d) + n * 86_400_000).toISOString().slice(0, 10)

export const isSunday = (d: IsoDate): boolean => new Date(toUtc(d)).getUTCDay() === 0

export const compareDates = (a: IsoDate, b: IsoDate): number => toUtc(a) - toUtc(b)

/** One unit's calendar: explicit entries win; otherwise Sundays are closed. */
export interface UnitCalendar {
  /** date -> working? (Deepavali closure, a worked Sunday, short-staffed day) */
  days?: Record<IsoDate, boolean>
}

export const isWorking = (cal: UnitCalendar | undefined, d: IsoDate): boolean => {
  const explicit = cal?.days?.[d]
  return explicit ?? !isSunday(d)
}

const dayNumber = (d: IsoDate): number => Math.floor(toUtc(d) / DAY_MS)
const isoOfDayNumber = (n: number): IsoDate => new Date(n * DAY_MS).toISOString().slice(0, 10)
/** Sundays have day numbers 3, 10, 17, ... (1970-01-04 was one). Sundays among the days in (a, b]. */
const sundaysIn = (a: number, b: number): number => Math.floor((b - 3) / 7) - Math.floor((a - 3) / 7)
const CANONICAL = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/**
 * The days in (a, b] where the calendar differs from the plain "Sundays closed" week, as day numbers:
 * +1 for a Sunday marked as worked, -1 for a weekday marked closed. Only these need looking at; every
 * other day is counted by arithmetic. Keys that are not a plain date can never be looked up by a date
 * string, so they are ignored, as the day-by-day loop ignored them.
 */
function deviations(cal: UnitCalendar | undefined, a: number, b: number): { at: number; delta: 1 | -1 }[] {
  const out: { at: number; delta: 1 | -1 }[] = []
  const days = cal?.days
  if (!days) return out
  for (const key in days) {
    const w = days[key]
    if (w === undefined || w === null || key.length !== 10 || !CANONICAL.test(key)) continue
    const at = dayNumber(key)
    if (!(at > a && at <= b)) continue
    const sunday = (((at - 3) % 7) + 7) % 7 === 0
    if (Boolean(w) !== !sunday) out.push({ at, delta: w ? 1 : -1 })
  }
  return out
}

/** Working days in (from, to]: after `from`, up to and including `to`. Whole weeks are counted, not walked day by day. */
export function workingDaysBetween(cal: UnitCalendar | undefined, from: IsoDate, to: IsoDate): number {
  const a = dayNumber(from), b = dayNumber(to)
  if (!(b > a)) return 0
  let n = b - a - sundaysIn(a, b)
  for (const d of deviations(cal, a, b)) n += d.delta
  return n
}

const NTH_CAP_DAYS = 3650

/** The date of the nth working day after `from` (n >= 1). */
export function nthWorkingDayAfter(cal: UnitCalendar | undefined, from: IsoDate, n: number): IsoDate {
  if (!(n >= 1)) return from
  const a = dayNumber(from)
  // A calendar with no working days would never reach n; cap at ~10 years, as the walk always did.
  const dev = deviations(cal, a, a + NTH_CAP_DAYS)
  const count = (k: number): number => k - sundaysIn(a, a + k) + dev.reduce((s, d) => (d.at <= a + k ? s + d.delta : s), 0)
  if (count(NTH_CAP_DAYS) < n) return isoOfDayNumber(a + NTH_CAP_DAYS)
  let lo = 1, hi = NTH_CAP_DAYS                    // the first offset whose count reaches n is a working day
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (count(mid) >= n) hi = mid
    else lo = mid + 1
  }
  return isoOfDayNumber(a + lo)
}

/** The most recent working day strictly before `d`. */
export function previousWorkingDay(cal: UnitCalendar | undefined, d: IsoDate): IsoDate {
  let p = addDays(d, -1)
  for (let i = 0; i < 3650 && !isWorking(cal, p); i++) p = addDays(p, -1)
  return p
}

/** The latest working day on or before `d`. */
export function workingDayOnOrBefore(cal: UnitCalendar | undefined, d: IsoDate): IsoDate {
  let p = d
  for (let i = 0; i < 3650 && !isWorking(cal, p); i++) p = addDays(p, -1)
  return p
}

/** `n` working days before `from` (n >= 0), counting back from the latest working day on or before it. */
export function workingDaysBack(cal: UnitCalendar | undefined, from: IsoDate, n: number): IsoDate {
  let d = workingDayOnOrBefore(cal, from)
  let left = n
  for (let i = 0; i < 3650 && left > 0; i++) {
    d = addDays(d, -1)
    if (isWorking(cal, d)) left--
  }
  return d
}
