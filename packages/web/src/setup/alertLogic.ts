// The mocked alerts list in Setup. Nothing here is sent anywhere: it only reads what the server logged.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const IST_OFFSET_MS = 5.5 * 3_600_000

/** "2026-11-04T04:30:00Z" -> "4 Nov, 10:00": Indian time, worked out by hand so the viewer's own zone cannot shift it. */
export function alertTime(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '-'
  const d = new Date(ms + IST_OFFSET_MS)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm}`
}

export const channelLabel = (channel: 'email' | 'whatsapp'): string => (channel === 'whatsapp' ? 'WhatsApp' : 'Email')

/** A buyer's name could be mistaken for a merchandiser's group, so say which it is. */
export const recipientLabel = (kind: 'buyer' | 'merchandiser', recipient: string): string => (kind === 'buyer' ? `${recipient} (buyer)` : recipient)
