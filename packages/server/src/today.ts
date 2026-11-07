/** The factory's calendar date (India). Working days are dates in the unit's own calendar, no time zone. */
export function istDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
}

export const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** A stage name as the templates write it: short, no control characters (a zero character cannot be stored). */
export const MAX_STAGE_CHARS = 40
export const isStageName = (s: unknown): s is string =>
  typeof s === 'string' && s.trim().length > 0 && s.length <= MAX_STAGE_CHARS && !/[\u0000-\u001F\u007F]/.test(s)
