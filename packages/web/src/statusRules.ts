/**
 * When the status page last checked, as a sentence with the day and the time zone (UI/UX plan, slice 3.8). The page used to show a
 * bare clock time ("Checked 10:00:00 AM"), which says nothing about which day or whose clock. Empty for a date it cannot read.
 */
export function checkedText(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const when = d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(timeZone ? { timeZone } : {}) })
  return `Checked ${when}`
}
