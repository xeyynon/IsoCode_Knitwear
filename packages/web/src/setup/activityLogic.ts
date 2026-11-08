// Setup > People "Activity" (UI/UX plan, slice 5.3), without React. The route is GET /api/accounts/audit (md/api.md): the latest 100,
// newest first, each with a plain-English `sentence`. The page shows that sentence as it is: it never writes its own wording about
// who did what, and the server never sends a PIN, password or hash.

export interface AuditEntry {
  id: string
  at: string
  actor: string
  subject: string | null
  subjectId: string | null
  action: 'supervisor_added' | 'merchandiser_added' | 'pin_reset' | 'signed_out_everywhere' | 'account_stopped' | 'account_allowed'
  sentence: string
}

export const FIRST_SHOWN = 10

/** The day, the time and the zone, in India time whatever the computer's: "4 Nov, 10:00 am IST". Empty for a date it cannot read. */
export function activityTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })} IST`
}

/** The first few entries, or all of them once the person asks. */
export function visibleEntries<T>(entries: T[], all: boolean): T[] {
  return all ? entries : entries.slice(0, FIRST_SHOWN)
}
