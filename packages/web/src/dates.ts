/** The factory's calendar date (India), YYYY-MM-DD. A phone set to another time zone must not shift the supervisor's day. */
export function istDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
}

/** Digits only, as a whole number, or null if there is nothing usable. Strips spaces, commas and anything a keyboard might add. */
export function parsePieces(raw: string): number | null {
  // Anything but digits, spaces and thousands commas is refused outright. Stripping it instead
  // would turn "-5" into 5 pieces.
  if (!/^[\d\s,]+$/.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  if (!digits || digits.length > 7) return null
  const n = Number(digits)
  return n >= 1 && n <= 1_000_000 ? n : null
}

/** Something was typed but it is not a whole number: the field keeps the text and says so. */
export const notWholeNumber = (raw: string): boolean => raw.trim() !== '' && parsePieces(raw) === null

/** Pieces still to make after what is already recorded, never negative. */
export const remainingPieces = (qty: number, produced: number): number => Math.max(0, qty - produced)
