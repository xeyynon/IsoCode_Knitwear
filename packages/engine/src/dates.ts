// Date-only helpers. Dates are "YYYY-MM-DD" strings, always interpreted in the
// unit's local calendar. All arithmetic is done in UTC so the machine's time
// zone can never shift a day.
export type IsoDate = string

const toUtc = (d: IsoDate): number => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, day)
}

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

/** Working days in (from, to]: after `from`, up to and including `to`. */
export function workingDaysBetween(cal: UnitCalendar | undefined, from: IsoDate, to: IsoDate): number {
  let n = 0
  for (let d = addDays(from, 1); compareDates(d, to) <= 0; d = addDays(d, 1)) if (isWorking(cal, d)) n++
  return n
}

/** The date of the nth working day after `from` (n >= 1). */
export function nthWorkingDayAfter(cal: UnitCalendar | undefined, from: IsoDate, n: number): IsoDate {
  let d = from
  let seen = 0
  // A calendar with no working days would loop forever; cap at ~10 years.
  for (let i = 0; i < 3650 && seen < n; i++) {
    d = addDays(d, 1)
    if (isWorking(cal, d)) seen++
  }
  return d
}

/** The most recent working day strictly before `d`. */
export function previousWorkingDay(cal: UnitCalendar | undefined, d: IsoDate): IsoDate {
  let p = addDays(d, -1)
  for (let i = 0; i < 3650 && !isWorking(cal, p); i++) p = addDays(p, -1)
  return p
}
