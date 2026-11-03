// The small decisions behind the review queue and the buyer page, without React so they can be tested.

/**
 * The link a merchandiser sends. The token goes after a "#", which a browser never sends to a
 * server and never puts in a Referer header, so it stays out of logs and analytics.
 */
export const buyerLinkUrl = (origin: string, token: string): string => `${origin.replace(/\/+$/, '')}/buyer#${token}`

/** Pull the token out of "#bl_..." (or "bl_..."); anything that does not look like one is ignored. */
export function readBuyerToken(hash: string): string | null {
  const t = hash.replace(/^#/, '').trim()
  return /^bl_[A-Za-z0-9_-]{20,100}$/.test(t) ? t : null
}

export interface LinkInfo { revoked: boolean; expired: boolean; expiresAt: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''}`

/** One plain phrase for a link's state. Revoked wins over expired: it is the one a person did on purpose. */
export function linkStatus(l: LinkInfo): { text: string; active: boolean } {
  if (l.revoked) return { text: 'Cancelled', active: false }
  if (l.expired) return { text: 'Expired', active: false }
  return { text: `Works until ${day(l.expiresAt)}`, active: true }
}

export type Severity = 'attention' | 'late_risk'
/** Buyer-facing words. A mark and a word, never colour alone. */
export const severityStatus = (s: Severity): 'amber' | 'red' => (s === 'late_risk' ? 'red' : 'amber')
export const severityWord = (s: Severity): string => (s === 'late_risk' ? 'Late risk' : 'Needs attention')

/** Clamp what a merchandiser types into the link form to what the server accepts. */
export function parseDays(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw.trim())) return null
  const n = Number(raw)
  return n >= 1 && n <= 180 ? n : null
}
