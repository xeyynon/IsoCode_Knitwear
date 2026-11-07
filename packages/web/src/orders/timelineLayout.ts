// Where everything goes on the order page's horizontal stage timeline, without React, so it can be tested.
// Dates become percentages of one track; the component only places boxes at those percentages.
import { shortDate, type Status } from '../board/boardLogic'
import { timelineRows, type TimelineStage } from './orderDetailLogic'
import { daysBetween } from './orderForm'

export interface ClosedDay { date: string; reason: string }
/** One unit's closed days (Sundays that were not worked, holidays, a power cut) inside the period the server was asked about. */
export interface CalendarUnit { unitId: string; unitName: string; closed: ClosedDay[] }
export interface LayoutStage extends TimelineStage { unitId: string }
export interface LayoutInput {
  stages: LayoutStage[]
  exFactory: string
  /** The period the server worked out the closed days for. Widened here if a date falls outside it. */
  from: string
  to: string
  units: CalendarUnit[]
}

/** Where a label sits against its mark, so a label near an edge grows inward and is never cut off. */
export type Anchor = 'start' | 'middle' | 'end'
export interface Marker { date: string; pct: number; label: string; anchor: Anchor }
/** `named` is a holiday or a stoppage someone wrote down; an ordinary Sunday is not. The two are hatched differently. */
export interface ClosedRun { reason: string; named: boolean; from: string; to: string; leftPct: number; widthPct: number }
export interface LegendItem { reason: string; label: string; named: boolean }

export interface LayoutRow {
  stage: string
  unitName: string
  status: Status
  done: boolean
  /** The stage's planned working window: the day after the stage before it finishes, to its own planned finish. */
  bar: { leftPct: number; widthPct: number }
  planned: Marker
  /** Below the bar: the projected finish, or the plain words when there is none ("Done", "Not enough data"). */
  lower: Marker & { hasMark: boolean }
  /** The stretch between planned and projected finish, when they differ. */
  slip: { leftPct: number; widthPct: number } | null
  pastExFactory: boolean
  closed: ClosedRun[]
  closedText: string
  /** The whole row in one sentence for a screen reader. */
  spoken: string
}

export interface TimelineLayout {
  from: string
  to: string
  days: number
  ticks: Marker[]
  exFactory: Marker
  rows: LayoutRow[]
  legend: LegendItem[]
  /** Closed days per unit as text, shown on the phone layout and under the chart. */
  closedSummary: { unitName: string; text: string }[]
}

const DAY = 86_400_000
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const addDays = (iso: string, n: number) => new Date(utc(iso) + n * DAY).toISOString().slice(0, 10)
const isMonday = (iso: string) => new Date(utc(iso)).getUTCDay() === 1
const earliest = (ds: string[]) => ds.reduce((a, b) => (utc(b) < utc(a) ? b : a))
const latest = (ds: string[]) => ds.reduce((a, b) => (utc(b) > utc(a) ? b : a))

const EDGE = 22
const anchorFor = (pct: number): Anchor => (pct < EDGE ? 'start' : pct > 100 - EDGE ? 'end' : 'middle')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const SUNDAY = 'Sunday'

/** "Closed: Deepavali". A reason that is only the word "Closed" is not printed twice. */
export const closedLabel = (reason: string): string => (reason === 'Closed' ? 'Closed day' : `Closed: ${reason}`)

/** Reasons in order of first appearance, with the ordinary Sunday last so a named closure is read first. */
function reasonsOf(days: ClosedDay[]): string[] {
  const seen: string[] = []
  for (const d of days) if (!seen.includes(d.reason)) seen.push(d.reason)
  return [...seen.filter((r) => r !== SUNDAY), ...seen.filter((r) => r === SUNDAY)]
}

/** "Deepavali 9 Nov, 10 Nov; Sunday 8 Nov, 15 Nov". */
function closedWords(days: ClosedDay[]): string {
  return reasonsOf(days).map((r) => `${r} ${days.filter((d) => d.reason === r).map((d) => shortDate(d.date)).join(', ')}`).join('; ')
}

export function buildTimeline(input: LayoutInput): TimelineLayout {
  const ordered = [...input.stages].sort((a, b) => a.sequence - b.sequence)
  const rows = timelineRows(ordered)
  const dates = [input.from, input.to, input.exFactory]
  for (const r of rows) { dates.push(r.planned); if (r.projected) dates.push(r.projected) }
  const lo = earliest(dates)
  const hi = latest(dates)
  const days = daysBetween(lo, hi) + 1
  const idx = (d: string) => daysBetween(lo, d)
  /** Middle of a day's cell. */
  const mid = (d: string) => ((idx(d) + 0.5) * 100) / days
  const cells = (a: string, b: string) => ({ leftPct: (idx(a) * 100) / days, widthPct: ((idx(b) - idx(a) + 1) * 100) / days })

  const unitOf = new Map(input.units.map((u) => [u.unitId, u]))
  const inWindow = (d: ClosedDay) => utc(d.date) >= utc(lo) && utc(d.date) <= utc(hi)

  const out: LayoutRow[] = ordered.map((s, i) => {
    const r = rows[i]!
    const unit = unitOf.get(s.unitId)
    const closedDays = (unit?.closed ?? []).filter(inWindow).sort((a, b) => utc(a.date) - utc(b.date))

    // Neighbouring days with the same reason become one stripe.
    const closed: ClosedRun[] = []
    for (const d of closedDays) {
      const last = closed[closed.length - 1]
      if (last && last.reason === d.reason && addDays(last.to, 1) === d.date) {
        last.to = d.date
        Object.assign(last, cells(last.from, last.to))
      } else closed.push({ reason: d.reason, named: d.reason !== SUNDAY, from: d.date, to: d.date, ...cells(d.date, d.date) })
    }

    const start = i === 0 ? lo : addDays(rows[i - 1]!.planned, 1)
    const bar = cells(utc(start) <= utc(r.planned) ? start : r.planned, r.planned)

    const afterEx = (d: string | null) => !!d && utc(d) > utc(input.exFactory)
    const pastExFactory = !r.done && (afterEx(r.planned) || afterEx(r.projected))
    const plannedPct = mid(r.planned)
    const planned: Marker = { date: r.planned, pct: plannedPct, anchor: anchorFor(plannedPct), label: `Plan ${shortDate(r.planned)}${!r.done && afterEx(r.planned) ? ' · after ex-factory' : ''}` }

    let lower: LayoutRow['lower']
    let slip: LayoutRow['slip'] = null
    if (r.done) lower = { date: r.planned, pct: plannedPct, anchor: planned.anchor, label: 'Done', hasMark: false }
    else if (!r.projected) lower = { date: r.planned, pct: plannedPct, anchor: planned.anchor, label: 'Not enough data', hasMark: false }
    else {
      const p = mid(r.projected)
      lower = {
        date: r.projected, pct: p, anchor: anchorFor(p), hasMark: true,
        label: `Projected ${shortDate(r.projected)} · ${r.text}${afterEx(r.projected) ? ' · after ex-factory' : ''}`,
      }
      if (r.projected !== r.planned) slip = { leftPct: Math.min(p, plannedPct), widthPct: Math.abs(p - plannedPct) }
    }

    const closedText = closedWords(closedDays)
    const unitName = unit?.unitName ?? ''
    const spoken = [
      `${cap(s.stage)}.`, `${planned.label}.`, `${lower.label}.`,
      closedDays.length ? `Closed days in ${unitName || 'its unit'}: ${closedText}.` : '',
    ].filter(Boolean).join(' ')
    return { stage: s.stage, unitName, status: s.status, done: r.done, bar, planned, lower, slip, pastExFactory, closed, closedText, spoken }
  })

  // The week along the top: the first day and each Monday, never two labels crowded together.
  const ticks: Marker[] = []
  for (let d = lo, last = ''; utc(d) <= utc(hi); d = addDays(d, 1)) {
    if (d !== lo && !isMonday(d)) continue
    if (last && daysBetween(last, d) < 4) continue
    last = d
    const pct = mid(d)
    ticks.push({ date: d, pct, anchor: anchorFor(pct), label: shortDate(d) })
  }

  const exPct = mid(input.exFactory)
  const unitsUsed = [...new Set(ordered.map((s) => s.unitId))]
  const legendReasons = reasonsOf(out.flatMap((r) => r.closed.map((c) => ({ date: c.from, reason: c.reason }))))

  return {
    from: lo, to: hi, days, ticks,
    exFactory: { date: input.exFactory, pct: exPct, anchor: anchorFor(exPct), label: `Ex-factory ${shortDate(input.exFactory)}` },
    rows: out,
    legend: legendReasons.map((reason) => ({ reason, label: closedLabel(reason), named: reason !== SUNDAY })),
    closedSummary: unitsUsed.map((id) => {
      const u = unitOf.get(id)
      const mine = (u?.closed ?? []).filter(inWindow).sort((a, b) => utc(a.date) - utc(b.date))
      return { unitName: u?.unitName ?? '', text: mine.length ? closedWords(mine) : 'none in this period' }
    }),
  }
}
