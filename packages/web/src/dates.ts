/** The factory's calendar date (India), YYYY-MM-DD. A phone set to another time zone must not shift the supervisor's day. */
export function istDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
}

/** "14:05": the factory's clock (India), hours and minutes on a 24-hour clock, for the language on screen. Not the phone's own locale string, with its seconds and AM or PM. */
export function clockTime(lang: 'en' | 'ta', at: Date): string {
  return new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
}

// A comma is a thousands separator only in a valid grouping: 1,250 and 12,500 (Western) or 1,25,000 (Indian). Anything else, such as
// "12,5" typed by someone who meant a decimal point, is refused: reading it as 125 would multiply the count by ten (FE-S-10).
const WESTERN_GROUPS = /^\d{1,3}(,\d{3})+$/
const INDIAN_GROUPS = /^\d{1,2}(,\d{2})*,\d{3}$/

/**
 * A whole number of pieces, or null when what was typed is not one. Spaces between groups count like commas ("1 200" is 1,200).
 * `min` is 1 by default (the merchandiser's visit entry: a visit with nothing to add is not an entry) and 0 on the supervisor's
 * Update screen, where a day with no output is real and the "why is it slow" reasons are exactly for it (FE-S-02).
 * Anything that is not digits and valid grouping is refused outright: stripping it would turn "-5" into 5 pieces.
 */
export function parsePieces(raw: string, min = 1): number | null {
  const t = raw.trim().replace(/\s+/g, ',')
  let digits: string
  if (/^\d+$/.test(t)) digits = t
  else if (WESTERN_GROUPS.test(t) || INDIAN_GROUPS.test(t)) digits = t.replace(/,/g, '')
  else return null
  if (digits.length > 7) return null
  const n = Number(digits)
  return n >= min && n <= 1_000_000 ? n : null
}

/** Something was typed but it is not a whole number: the field keeps the text and says so. */
export const notWholeNumber = (raw: string, min = 1): boolean => raw.trim() !== '' && parsePieces(raw, min) === null

/** Pieces still to make after what is already recorded, never negative. */
export const remainingPieces = (qty: number, produced: number): number => Math.max(0, qty - produced)
