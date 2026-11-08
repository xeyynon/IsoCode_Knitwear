import { isDateInWindow } from '@isocode/engine'

// One formatter for the life of the process: building an Intl.DateTimeFormat costs about 70 times what using one does (O-17).
const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })

/** The factory's calendar date (India). Working days are dates in the unit's own calendar, no time zone. */
export function istDate(now: Date = new Date()): string {
  return IST_DAY.format(now)
}

/**
 * A real calendar date in YYYY-MM-DD form that this system could mean: 2000-01-01 to 2100-12-31.
 * Outside that it is a typo (0026 for 2026, 9999 for "no date"), and a date years away makes every
 * count of working days long, so it is refused where it comes in (BE-002, BE-003).
 */
export const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && isDateInWindow(s)
}

/**
 * A stage name as the templates write it: short, and something a person can type again. No control
 * characters (a zero character cannot be stored), no invisible format characters (zero-width space and
 * joiners, byte-order mark, bidi marks) and no space at either end (BE-030): such a name looks like
 * another one on screen and could never be sent back by a phone.
 */
export const MAX_STAGE_CHARS = 40
export const isStageName = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.length <= MAX_STAGE_CHARS && s === s.trim() &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(s)
