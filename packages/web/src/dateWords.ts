const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A calendar date written out beside a date field (UI/UX plan, slice 3.5, audit 02 finding 6): "Thursday, 12 Nov 2026". A date input
 * shows 12-11-2026 or 11/12/2026 depending on the phone, and day-first against month-first is a mistake waiting to happen on an
 * ex-factory date. Empty for anything that is not a real calendar day (a half-typed date, 31 Feb), so nothing wrong is ever read back.
 */
export function dateInWords(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return ''
  return `${DAYS[t.getUTCDay()]}, ${d} ${MONTHS[mo - 1]} ${y}`
}
