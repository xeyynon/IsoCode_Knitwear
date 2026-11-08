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
  // Optional only so a row from a server older than this page still draws: no unit filter match, no bar.
  /** The units that own any stage of the order. */
  units?: { id: string; name: string }[]
  stagesDone?: number
  stagesTotal?: number
  currentStage?: string | null
  /** The current stage's pieces (null when there is no current stage; absent from a server older than slice 3.4): what the bar is made from. */
  currentStageQty?: number | null
  currentStageProduced?: number | null
  /** The rate behind the stage rests on fewer than 3 days of updates. */
  currentStageMadeIsEstimate?: boolean | null
  /** Unfinished stages whose recent updates a merchandiser entered on a visit. */
  lowConfidenceStages?: string[]
}

export const LIST_PREVIEW = 50
export const STATUSES: Status[] = ['red', 'amber', 'grey', 'green']

export interface Filters { status: Status | null; buyer: string | null }

export function parseFilters(params: URLSearchParams): Filters {
  const s = params.get('status')
  return { status: STATUSES.includes(s as Status) ? (s as Status) : null, buyer: params.get('buyer') || null }
}

/** Toggle a value; clearing removes the key so URLs stay short. Choosing the active value clears it. */
export function withFilter(params: URLSearchParams, key: 'status' | 'buyer' | 'unit' | 'week', value: string | null): URLSearchParams {
  const next = new URLSearchParams(params)
  if (value === null || next.get(key) === value) next.delete(key)
  else next.set(key, value)
  return next
}

export const applyFilters = (rows: BoardRow[], f: Filters): BoardRow[] =>
  rows.filter((r) => (!f.status || r.status === f.status) && (!f.buyer || r.buyerId === f.buyer))

// ---- search and sort: also kept in the URL (q and sort), so a reload or a shared link keeps them.
export type Sort = 'status' | 'exfactory' | 'buyer' | 'po'
/** 'status' is the server's order, worst first; the others are the choices beside it. */
export const SORTS: Sort[] = ['status', 'exfactory', 'buyer', 'po']
export interface View { q: string; sort: Sort }

export function parseView(params: URLSearchParams): View {
  const s = params.get('sort')
  return { q: params.get('q') ?? '', sort: SORTS.includes(s as Sort) ? (s as Sort) : 'status' }
}

/** A blank query removes the key, like a cleared filter. */
export function withQuery(params: URLSearchParams, q: string): URLSearchParams {
  const next = new URLSearchParams(params)
  if (q.trim() === '') next.delete('q')
  else next.set('q', q)
  return next
}

export function withSort(params: URLSearchParams, sort: Sort): URLSearchParams {
  const next = new URLSearchParams(params)
  if (sort === 'status') next.delete('sort')
  else next.set('sort', sort)
  return next
}

// Composed and decomposed forms of the same letter must match; toLocaleLowerCase leaves Tamil alone.
const fold = (s: string): string => s.normalize('NFC').toLocaleLowerCase()

/** Every word of the query must appear in the PO, the buyer or the style, in any order. */
export function searchRows(rows: BoardRow[], q: string): BoardRow[] {
  const words = fold(q).split(/\s+/).filter(Boolean)
  if (words.length === 0) return rows
  return rows.filter((r) => {
    const hay = fold(`${r.po} ${r.buyerName} ${r.style}`)
    return words.every((w) => hay.includes(w))
  })
}

const byText = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** A new array; equal rows keep the server's order (Array.sort is stable), so ties stay worst-first. */
export function sortRows(rows: BoardRow[], sort: Sort): BoardRow[] {
  const out = [...rows]
  if (sort === 'exfactory') {
    out.sort((a, b) => (ISO.test(a.exFactory) ? 0 : 1) - (ISO.test(b.exFactory) ? 0 : 1) || (a.exFactory < b.exFactory ? -1 : a.exFactory > b.exFactory ? 1 : 0))
  } else if (sort === 'buyer') out.sort((a, b) => byText(a.buyerName, b.buyerName))
  else if (sort === 'po') out.sort((a, b) => byText(a.po, b.po))
  return out
}

// ---- unit and ship week: also kept in the URL (unit and week). Apart from Filters so the status
// counts can be worked out after these two narrow the list but before status does.
/** Ship week, by the ISO week (Monday to Sunday) the ex-factory date falls in, against today's week. */
export type ShipWeek = 'overdue' | 'this' | 'next' | 'later'
/** 'overdue' is any earlier week: an order that shipped earlier in this very week still counts as this week. */
export const SHIP_WEEKS: ShipWeek[] = ['overdue', 'this', 'next', 'later']
export interface Scope { unit: string | null; week: ShipWeek | null }

export function parseScope(params: URLSearchParams): Scope {
  const w = params.get('week')
  return { unit: params.get('unit') || null, week: SHIP_WEEKS.includes(w as ShipWeek) ? (w as ShipWeek) : null }
}

// Dates here are whole days counted from 1970 (UTC arithmetic on a date-only value), so no time zone
// and no daylight-saving change can move a day. "Today" is the server's India date.
const DAY_MS = 86_400_000
function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const back = new Date(t).toISOString().slice(0, 10)
  return back === iso ? t / DAY_MS : null   // 30 Feb rolls over to March: refuse it
}
const isoOf = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10)
/** The Monday on or before a day number. 1 Jan 1970 was a Thursday. */
const mondayOf = (day: number): number => day - ((day + 3) % 7)

/** Which week an ex-factory date falls in, compared with today's; null if either is not a real date. */
export function shipWeekOf(exFactory: string, today: string): ShipWeek | null {
  const d = dayNumber(exFactory)
  const t = dayNumber(today)
  if (d === null || t === null) return null
  const weeks = (mondayOf(d) - mondayOf(t)) / 7
  return weeks < 0 ? 'overdue' : weeks === 0 ? 'this' : weeks === 1 ? 'next' : 'later'
}

/** The ISO 8601 week number, whose year can differ from the calendar year around 1 January. */
export function isoWeek(iso: string): { year: number; week: number } | null {
  const d = dayNumber(iso)
  if (d === null) return null
  const thursday = mondayOf(d) + 3
  const year = new Date(thursday * DAY_MS).getUTCFullYear()
  const week = Math.floor((thursday - Date.UTC(year, 0, 1) / DAY_MS) / 7) + 1
  return { year, week }
}

/** "2 to 8 Nov" or "28 Dec to 3 Jan": the days of the week `offset` weeks from today's. */
export function weekRange(today: string, offset: number): string {
  const t = dayNumber(today)
  if (t === null) return ''
  const monday = mondayOf(t) + offset * 7
  const a = isoOf(monday)
  const b = isoOf(monday + 6)
  return a.slice(5, 7) === b.slice(5, 7) ? `${Number(a.slice(8))} to ${shortDate(b)}` : `${shortDate(a)} to ${shortDate(b)}`
}

/** Unit and week narrow the list; a row from a server that sends no units matches no unit. */
export function applyScope(rows: BoardRow[], s: Scope, today: string): BoardRow[] {
  return rows.filter((r) =>
    (!s.unit || (r.units ?? []).some((u) => u.id === s.unit)) && (!s.week || shipWeekOf(r.exFactory, today) === s.week))
}

export function unitsOf(rows: BoardRow[]): { id: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const r of rows) for (const u of r.units ?? []) seen.set(u.id, u.name)
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** What is narrowing the list, so an empty result can say what to change. */
export type Constraint = 'q' | 'status' | 'buyer' | 'unit' | 'week'
export function activeConstraints(f: { q: string; status: Status | null; buyer: string | null; unit?: string | null; week?: ShipWeek | null }): Constraint[] {
  const out: Constraint[] = []
  if (f.q.trim()) out.push('q')
  if (f.status) out.push('status')
  if (f.buyer) out.push('buyer')
  if (f.unit) out.push('unit')
  if (f.week) out.push('week')
  return out
}

// ---- the stage progress bar on each row
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
export interface Progress { done: number; total: number; fraction: number; text: string; label: string }

/** Stages finished out of all, and where the order is now. Null when there is nothing honest to draw. */
export function progressOf(r: BoardRow): Progress | null {
  const total = r.stagesTotal ?? 0
  if (!Number.isFinite(total) || total <= 0) return null
  const done = Math.min(Math.max(r.stagesDone ?? 0, 0), total)
  const fraction = done / total
  if (done >= total) return { done, total, fraction, text: 'All stages done', label: `All ${total} stages done` }
  // Counts that say some are left but no name for the next: say what is known, never "all done".
  if (!r.currentStage) return { done, total, fraction, text: `${done} of ${total} done`, label: `${done} of ${total} stages done` }
  const name = cap(r.currentStage)
  return { done, total, fraction, text: name, label: `Stage ${done + 1} of ${total}: ${name}` }
}

/** Counts ignore the status filter (so each count stays a button that can switch) but respect the buyer filter. */
export function counts(rows: BoardRow[], f: Filters): Record<Status, number> & { total: number } {
  const scoped = rows.filter((r) => !f.buyer || r.buyerId === f.buyer)
  const out = { red: 0, amber: 0, grey: 0, green: 0, total: scoped.length }
  for (const r of scoped) out[r.status]++
  return out
}

/**
 * The pieces still short, added up for each status, under the same buyer choice as counts() so a status tile's number and its
 * shortfall describe the same orders. Only real values count: a missing, zero or negative shortfall adds nothing.
 */
export function shortByStatus(rows: BoardRow[], f: Filters): Record<Status, number> & { total: number } {
  const out = { red: 0, amber: 0, grey: 0, green: 0, total: 0 }
  for (const r of rows) {
    if (f.buyer && r.buyerId !== f.buyer) continue
    if (typeof r.shortBy !== 'number' || !(r.shortBy > 0)) continue
    out[r.status] += r.shortBy
    out.total += r.shortBy
  }
  return out
}

/** How far away a ship date is, in words ("in 16 days", "tomorrow", "5 days ago"); empty when either date cannot be read. */
export function shipIn(exFactory: string, today: string): string {
  const at = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN }
  const days = Math.round((at(exFactory) - at(today)) / 86_400_000)
  if (!Number.isFinite(days)) return ''
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days > 1) return `in ${days} days`
  return `${-days} day${days === -1 ? '' : 's'} ago`
}

/** A link can name a buyer who has no orders on the board: the select needs an option for it, or it shows "All buyers" over an empty list. */
export const isUnknownChoice = (options: { id: string }[], id: string | null): boolean => !!id && !options.some((o) => o.id === id)

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
