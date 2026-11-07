// The merchandiser's navigation: three places, shown as tabs in the app bar on every merchandiser screen (UI/UX plan, slice 3.3,
// decision D5; the ORCA top bar pattern, adapted). Pure, so the rules are tested without a browser.
//
// Before this, Review and Setup were small buttons in the board's toolbar, so the only way between them was back to the board
// first, there were three different "back" wordings, and how many items waited for review was visible only on the board.
export type NavKey = 'board' | 'review' | 'setup'

export const NAV: readonly { key: NavKey; to: string; label: string; keys: string }[] = [
  { key: 'board', to: '/board', label: 'Board', keys: 'G then B' },
  { key: 'review', to: '/review', label: 'Review', keys: 'G then R' },   // the same sequences shortcutKeys.ts already goes by
  { key: 'setup', to: '/setup', label: 'Setup', keys: 'G then S' },
]

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`)

/** Which tab is the current place. Orders (a new one, or one opened from the board) belong to the board. */
export function activeNav(pathname: string): NavKey | null {
  if (under(pathname, '/board') || under(pathname, '/orders')) return 'board'
  if (under(pathname, '/review')) return 'review'
  if (under(pathname, '/setup')) return 'setup'
  return null
}

/** A supervisor has one flow and a buyer has no navigation: the tabs are for merchandisers. */
export const showNav = (role: string | undefined): boolean => role === 'merchandiser'

/** The number on the Review tab: nothing when nothing waits or it is not known yet (never a placeholder zero), capped at 99+. */
export function badgeText(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null
  return count > 99 ? '99+' : String(Math.floor(count))
}

/** How many warnings wait, from the review answer; unknown (null) if the answer is not the shape we expect. */
export function reviewCountFrom(payload: unknown): number | null {
  const list = (payload as { needsReview?: unknown } | null | undefined)?.needsReview
  return Array.isArray(list) ? list.length : null
}
