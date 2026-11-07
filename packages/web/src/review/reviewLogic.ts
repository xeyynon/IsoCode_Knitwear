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

/** How many links a buyer could open right now. */
export const activeLinkCount = (links: LinkInfo[]): number => links.filter((l) => linkStatus(l).active).length

/** The sections of the review page, in page order. */
export type ReviewSectionId = 'warnings' | 'notes' | 'photos' | 'approved' | 'confirmed' | 'links'
export interface ReviewCounts { warnings: number; notes: number; photos: number; approved: number; confirmed: number; activeLinks: number }
export interface SummaryItem { key: 'warnings' | 'notes' | 'photos' | 'visible' | 'links'; label: string; fullLabel: string; count: number; target: ReviewSectionId }

/** The id of a section heading: what a jump link points at and what a section is labelled by. */
export const sectionAnchor = (id: ReviewSectionId): string => `review-${id}`

/**
 * The five entries of the summary bar. "Visible" adds approved photos to confirmed warnings and
 * jumps to the first of the two that has something in it, so a jump never lands on an empty line
 * when the other half has items.
 */
export function reviewSummary(c: ReviewCounts): SummaryItem[] {
  const visibleTarget: ReviewSectionId = c.approved === 0 && c.confirmed > 0 ? 'confirmed' : 'approved'
  return [
    { key: 'warnings', label: 'Warnings', fullLabel: 'Warnings waiting for review', count: c.warnings, target: 'warnings' },
    { key: 'notes', label: 'Notes', fullLabel: 'Notes from the floor', count: c.notes, target: 'notes' },
    { key: 'photos', label: 'Photos', fullLabel: 'Photos waiting for approval', count: c.photos, target: 'photos' },
    { key: 'visible', label: 'Visible', fullLabel: 'Photos and warnings visible to buyers now', count: c.approved + c.confirmed, target: visibleTarget },
    { key: 'links', label: 'Links', fullLabel: 'Buyer links that work', count: c.activeLinks, target: 'links' },
  ]
}

/** A section heading with its count, and a word after it where the count is only part of what is listed ("2 working"). */
export const sectionTitle = (label: string, count: number, unit = ''): string => `${label} (${count}${unit ? ` ${unit}` : ''})`

/** One calm line for a section with nothing in it, saying when something will appear there. */
export function emptyLine(id: ReviewSectionId): string {
  switch (id) {
    case 'warnings': return 'Nothing is waiting. A warning appears here when a stage is at risk, and no buyer sees it until you confirm it.'
    case 'notes': return 'No notes are waiting. A note appears here when a supervisor writes why a stage is slow.'
    case 'photos': return 'No photos are waiting. A photo a supervisor sends with an update appears here first; a buyer cannot see it until you approve it.'
    case 'approved': return 'No photo is visible to any buyer. A photo appears here once you approve it.'
    case 'confirmed': return 'No warning is visible to any buyer. A warning appears here once you confirm it.'
    case 'links': return 'No links yet. A link you make appears here.'
  }
}

/** After a link is cancelled: stop offering it for copying if it is the one just made, and say what happened. */
export function afterRevoke<M extends { id: string }>(made: M | null, revokedId: string): { made: M | null; announce: string } {
  return { made: made?.id === revokedId ? null : made, announce: 'Link cancelled. It no longer works.' }
}

export type Severity = 'attention' | 'late_risk'
/** Buyer-facing words. A mark and a word, never colour alone. */
export const severityStatus = (s: Severity): 'amber' | 'red' => (s === 'late_risk' ? 'red' : 'amber')
export const severityWord = (s: Severity): string => (s === 'late_risk' ? 'Late risk' : 'Needs attention')

/**
 * "No reason chosen" is offered only on a note that has no reason yet. A reviewer can change a
 * supervisor's reason but not remove it (the server keeps the old one), so offering it would lose the choice.
 */
export const offersNoReason = (category: string | null): boolean => !category

/** Clamp what a merchandiser types into the link form to what the server accepts. */
export function parseDays(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw.trim())) return null
  const n = Number(raw)
  return n >= 1 && n <= 180 ? n : null
}
