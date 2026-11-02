// Everything the board decides, without React, so it can be tested. Filters live in the
// URL, so a reload or a shared link keeps them.
export type Status = 'red' | 'amber' | 'green' | 'grey'

export interface BoardRow {
  orderId: string
  po: string
  buyerId: string
  buyerName: string
  style: string
  colour: string
  exFactory: string
  status: Status
  worstStage: string | null
  maths: string | null
  shortBy: number | null
  reasons: string[]
  noRecentUpdate: boolean
  hasWarning: boolean
}

export const LIST_PREVIEW = 50
export const STATUSES: Status[] = ['red', 'amber', 'grey', 'green']

export interface Filters { status: Status | null; buyer: string | null }

export function parseFilters(params: URLSearchParams): Filters {
  const s = params.get('status')
  return { status: STATUSES.includes(s as Status) ? (s as Status) : null, buyer: params.get('buyer') || null }
}

/** Toggle a value; clearing removes the key so URLs stay short. Choosing the active value clears it. */
export function withFilter(params: URLSearchParams, key: 'status' | 'buyer', value: string | null): URLSearchParams {
  const next = new URLSearchParams(params)
  if (value === null || next.get(key) === value) next.delete(key)
  else next.set(key, value)
  return next
}

export const applyFilters = (rows: BoardRow[], f: Filters): BoardRow[] =>
  rows.filter((r) => (!f.status || r.status === f.status) && (!f.buyer || r.buyerId === f.buyer))

/** Counts ignore the status filter (so each count stays a button that can switch) but respect the buyer filter. */
export function counts(rows: BoardRow[], f: Filters): Record<Status, number> & { total: number } {
  const scoped = rows.filter((r) => !f.buyer || r.buyerId === f.buyer)
  const out = { red: 0, amber: 0, grey: 0, green: 0, total: scoped.length }
  for (const r of scoped) out[r.status]++
  return out
}

export function buyersOf(rows: BoardRow[]): { id: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const r of rows) seen.set(r.buyerId, r.buyerName)
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** The preview is stated on screen ("50 of 312"), never a silent cut. */
export function preview(rows: BoardRow[], showAll: boolean): { shown: BoardRow[]; capped: boolean } {
  if (showAll || rows.length <= LIST_PREVIEW) return { shown: rows, capped: false }
  return { shown: rows.slice(0, LIST_PREVIEW), capped: true }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-11-20" -> "20 Nov". Date-only: no Date object, so no time zone can shift the day. */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return '-'
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? '-'}`
}
