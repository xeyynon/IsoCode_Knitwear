/**
 * The one way a piece count is written on any screen (UI/UX plan, slice 3.5): Indian grouping from four digits on, "4,550" and
 * "1,25,000", as the board already did, so the supervisor's phone and the merchandiser's desktop read the same number the same way.
 * A value that is not a number is a dash, never "NaN".
 */
export function pieces(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '–'
  return n.toLocaleString('en-IN')
}
