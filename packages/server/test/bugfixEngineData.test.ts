// Regression tests for the backend bug log (bug.md): BE-002/003 (date window), BE-004 (low-confidence
// window), BE-005 (settings), BE-006 (closed days), BE-030 (stage names). Names start with the bug id.
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, projectOrder, type Settings, type UnitCalendar, type UpdateEvent } from '@isocode/engine'
import { isIsoDate, isStageName, type Tx } from '../src/index.js'
import { lowConfidenceStages } from '../src/confidence.js'
import { loadSettings } from '../src/engineData.js'
import { closedDaysIn, timelineSpan } from '../src/orderDetailService.js'

/** The fastest of a few runs: other work on a busy machine slows a run down, it never speeds one up. */
const fastestMs = (fn: () => void, runs = 7): number => {
  let best = Infinity
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); best = Math.min(best, performance.now() - t0) }
  return best
}
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

describe('BE-002 / BE-003: only plausible dates are real dates', () => {
  it('BE-003: year 0026 is refused, as is the whole of 0000-0099', () => {
    expect(isIsoDate('0026-11-20')).toBe(false)
    expect(isIsoDate('0000-01-01')).toBe(false)
    expect(isIsoDate('0099-12-31')).toBe(false)
    expect(isIsoDate('1999-12-31')).toBe(false)
  })
  it('BE-002: 9999-12-31 is refused, and so is 2101-01-01', () => {
    expect(isIsoDate('9999-12-31')).toBe(false)
    expect(isIsoDate('2101-01-01')).toBe(false)
  })
  it('BE-002: the window is 2000-01-01 to 2100-12-31 inclusive, and ordinary dates still pass', () => {
    expect(isIsoDate('2000-01-01')).toBe(true)
    expect(isIsoDate('2100-12-31')).toBe(true)
    expect(isIsoDate('2026-11-08')).toBe(true)
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)     // still not a real date
    expect(isIsoDate('2026-2-3')).toBe(false)       // still the plain YYYY-MM-DD shape only
    expect(isIsoDate(20261108)).toBe(false)
  })
})

describe('BE-030: a stage name that nobody can type again is refused', () => {
  it('BE-030: zero-width characters are refused', () => {
    expect(isStageName('​')).toBe(false)
    expect(isStageName('sewing​')).toBe(false)
    expect(isStageName('sew‌ing')).toBe(false)
    expect(isStageName('sew‍ing')).toBe(false)
    expect(isStageName('﻿sewing')).toBe(false)
    expect(isStageName('sew⁠ing')).toBe(false)
  })
  it('BE-030: leading and trailing spaces (also no-break spaces) are refused', () => {
    expect(isStageName(' sewing')).toBe(false)
    expect(isStageName('sewing ')).toBe(false)
    expect(isStageName('sewing ')).toBe(false)
    expect(isStageName(' x')).toBe(false)
  })
  it('BE-030: an ordinary name, a name with an inner space and a Tamil name are still accepted', () => {
    expect(isStageName('sewing')).toBe(true)
    expect(isStageName('final check')).toBe(true)
    expect(isStageName('தையல்')).toBe(true)
    expect(isStageName('a'.repeat(40))).toBe(true)
    expect(isStageName('a'.repeat(41))).toBe(false)
    expect(isStageName('')).toBe(false)
    expect(isStageName('   ')).toBe(false)
    expect(isStageName('sew\u0000ing')).toBe(false)
    expect(isStageName(5)).toBe(false)
  })
})

describe('BE-005: settings are checked per key, with the default for anything unusable', () => {
  const tx = (rows: { key: string; value: unknown }[]): Tx => ({ query: async () => rows as never })
  const load = (rows: { key: string; value: unknown }[]) => loadSettings(tx(rows))

  it('BE-005: window_days = 0 keeps the default of 5', async () => {
    expect((await load([{ key: 'window_days', value: 0 }])).windowDays).toBe(DEFAULT_SETTINGS.windowDays)
  })
  it('BE-005: a JSON null is ignored, not read as 0', async () => {
    const s = await load([
      { key: 'window_days', value: null }, { key: 'min_data_days', value: null }, { key: 'ramp_up_days', value: null },
      { key: 'red_below', value: null }, { key: 'buffer_days', value: null }, { key: 'warn_within_days', value: null },
    ])
    expect(s).toEqual(DEFAULT_SETTINGS)
  })
  it('BE-005: values out of range, not whole, not numbers, are ignored one by one', async () => {
    const s = await load([
      { key: 'window_days', value: -1 }, { key: 'min_data_days', value: 0 }, { key: 'ramp_up_days', value: 2.5 },
      { key: 'red_below', value: 1.5 }, { key: 'buffer_days', value: 'soon' }, { key: 'warn_within_days', value: true },
    ])
    expect(s).toEqual(DEFAULT_SETTINGS)
    expect((await load([{ key: 'red_below', value: 0 }])).redBelow).toBe(DEFAULT_SETTINGS.redBelow)
    expect((await load([{ key: 'window_days', value: [] }])).windowDays).toBe(DEFAULT_SETTINGS.windowDays)
    expect((await load([{ key: 'window_days', value: '' }])).windowDays).toBe(DEFAULT_SETTINGS.windowDays)
    expect((await load([{ key: 'window_days', value: Infinity }])).windowDays).toBe(DEFAULT_SETTINGS.windowDays)
  })
  it('BE-005: good values are used (a number, or a number written as text), and one bad key does not spoil the others', async () => {
    const s = await load([
      { key: 'window_days', value: 7 }, { key: 'min_data_days', value: '4' }, { key: 'ramp_up_days', value: 0 },
      { key: 'red_below', value: 0.75 }, { key: 'buffer_days', value: 0 }, { key: 'warn_within_days', value: -3 },
      { key: 'something_else', value: 12 },
    ])
    expect(s).toEqual({ windowDays: 7, minDataDays: 4, rampUpDays: 0, redBelow: 0.75, bufferDays: 0, warnWithinDays: DEFAULT_SETTINGS.warnWithinDays })
    expect((await load([{ key: 'red_below', value: 1 }])).redBelow).toBe(1)
  })
  it('BE-005: the engine itself never computes a NaN rate from a bad settings object', () => {
    const bad: Settings = { ...DEFAULT_SETTINGS, windowDays: 0, minDataDays: 0, redBelow: 0 }
    const events: UpdateEvent[] = ['2026-10-29', '2026-10-30', '2026-10-31'].map((date, i) => ({ clientUuid: `b${i}`, stage: 's', date, qty: 100 }))
    const r = projectOrder({ id: 'o', exFactory: '2026-11-20' }, [{ stage: 's', unitId: 'u', qty: 2000, milestone: '2026-11-11', sequence: 1 }], events, {}, '2026-11-04', bad)
    expect(r.stages[0]!.made).toBe(100)
    expect(r.stages[0]!.status).toBe('red')           // 1700 short at 100 a day; with windowDays 0 this read green
  })
})

describe('BE-006: the order page lists every closed day, not only the first 400 days', () => {
  const sundaysBetween = (from: string, to: string) => {
    const out: string[] = []
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
      const d = new Date(t)
      if (d.getUTCDay() === 0) out.push(d.toISOString().slice(0, 10))
    }
    return out
  }
  it('BE-006: three years with no entries return every Sunday, to the last one', () => {
    const want = sundaysBetween('2026-01-01', '2028-12-31')
    const got = closedDaysIn([], '2026-01-01', '2028-12-31')
    expect(want.length).toBe(157)
    expect(got.map((d) => d.date)).toEqual(want)
    expect(got.every((d) => d.reason === 'Sunday')).toBe(true)
  })
  it('BE-006: entries late in a long span count: a worked Sunday drops out, a weekday closure is added with its note, in date order', () => {
    const entries = [
      { date: '2028-12-31', working: true, note: null },            // a worked Sunday, 3 years on
      { date: '2028-11-08', working: false, note: ' Deepavali ' },
      { date: '2026-11-09', working: false, note: null },
    ]
    const got = closedDaysIn(entries, '2026-01-01', '2028-12-31')
    const dates = got.map((d) => d.date)
    expect(dates).not.toContain('2028-12-31')
    expect(dates).toContain('2028-11-08')
    expect(got.find((d) => d.date === '2028-11-08')!.reason).toBe('Deepavali')
    expect(got.find((d) => d.date === '2026-11-09')!.reason).toBe('Closed')
    expect(dates).toEqual([...dates].sort())
    expect(dates.length).toBe(157 - 1 + 2)
  })
  it('BE-006: a closed Sunday takes its note as the reason, a worked weekday is not closed', () => {
    const got = closedDaysIn([{ date: '2026-11-08', working: false, note: 'Open day' }, { date: '2026-11-10', working: true, note: 'Extra shift' }], '2026-11-01', '2026-11-14')
    expect(got).toEqual([{ date: '2026-11-01', reason: 'Sunday' }, { date: '2026-11-08', reason: 'Open day' }])
  })
  it('BE-006: the span is bounded by the date window, so a year-9999 date cannot stall it', () => {
    const got = closedDaysIn([], '2026-01-01', '9999-12-31')
    expect(fastestMs(() => closedDaysIn([], '2026-01-01', '9999-12-31'))).toBeLessThan(100)
    expect(got[got.length - 1]!.date).toBe('2100-12-26')    // the last Sunday inside the window
    expect(closedDaysIn([], '0026-01-01', '2000-01-09').map((d) => d.date)).toEqual(['2000-01-02', '2000-01-09'])
  })
  it('BE-006: a hundred years are listed in well under 50 ms', () => {
    const got = closedDaysIn([], '2000-01-01', '2100-12-31')
    expect(fastestMs(() => closedDaysIn([], '2000-01-01', '2100-12-31'))).toBeLessThan(50)
    expect(got.length).toBe(sundaysBetween('2000-01-01', '2100-12-31').length)
  })
  it('timelineSpan still reaches from the earliest to the latest date of the order', () => {
    expect(timelineSpan('2026-12-01', '2026-11-04', '2026-10-01', ['2026-11-20', null])).toEqual({ from: '2026-10-01', to: '2026-12-01' })
  })
})

describe('BE-004: the low-confidence flag looks at the days the rate is made from', () => {
  const TODAY = '2026-11-02'           // a Monday; Sunday 1 Nov is closed
  const ev = (id: string, date: string, qty = 100, stage = 's'): UpdateEvent => ({ clientUuid: id, stage, date, qty })
  const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', TODAY]
  const events = days.map((d, i) => ev(`u${i}`, d, d === '2026-10-27' ? 900 : 100))
  const settings = { ...DEFAULT_SETTINGS, windowDays: 5 }
  const flag = (onBehalf: string[], evs = events, cal: (stage: string) => UnitCalendar | undefined = () => undefined) =>
    [...lowConfidenceStages(evs, new Set(onBehalf), TODAY, settings, cal)]

  it('BE-004: the oldest day of the rate window entered on behalf is flagged even though today has an update too', () => {
    const r = projectOrder({ id: 'o', exFactory: '2027-01-01' }, [{ stage: 's', unitId: 'u', qty: 99999, milestone: '2026-12-01', sequence: 1 }], events, {}, TODAY, settings)
    expect(r.stages[0]!.made).toBe(260)             // (900 + 100 * 4) / 5: the typed 900 is in the rate
    expect(flag(['u1'])).toEqual(['s'])
  })
  it('BE-004: an on-behalf entry only for today is not flagged while three finished days carry the rate', () => {
    expect(flag(['u6'])).toEqual([])
  })
  it('BE-004: an on-behalf entry on a closed Sunday is not flagged: the rate drops closed days', () => {
    const withSunday = [...events, ev('sun', '2026-11-01', 50)]
    expect(flag(['sun'], withSunday)).toEqual([])
  })
  it('BE-004: nor on a weekday the unit has closed in its calendar', () => {
    const cal = (): UnitCalendar => ({ days: { '2026-10-28': false } })
    expect(flag(['u2'], events, cal)).toEqual([])            // 28 Oct closed: its update does not feed the rate
    expect(flag(['u2'], events)).toEqual(['s'])              // open: it does
  })
  it('BE-004: with fewer finished days than minDataDays, today does feed the rate and is flagged', () => {
    const few = [ev('a', '2026-10-30'), ev('b', '2026-10-31'), ev('c', TODAY)]
    expect(flag(['c'], few)).toEqual(['s'])
    expect(flag(['b'], few)).toEqual(['s'])
  })
  it('BE-004: a plain number is still accepted as the window length', () => {
    expect([...lowConfidenceStages(events, new Set(['u1']), TODAY, 5)]).toEqual(['s'])
  })

  it('BE-004: an entry is flagged exactly when changing its quantity would change the stage rate (random schedules)', () => {
    const next = rng(4)
    let flaggedCases = 0, unflaggedCases = 0
    for (let i = 0; i < 300; i++) {
      const startDay = Date.parse('2026-10-05T00:00:00Z') / 86_400_000
      const count = 1 + Math.floor(next() * 12)
      const dates: string[] = []
      for (let k = 0; k < count; k++) dates.push(new Date((startDay + Math.floor(next() * 29)) * 86_400_000).toISOString().slice(0, 10))   // 5 Oct .. 2 Nov
      const evs = [...new Set(dates)].map((d, k) => ev(`r${k}`, d, 50 + Math.floor(next() * 100)))
      const cal: UnitCalendar = { days: { '2026-10-14': false, '2026-10-25': true } }
      const s: Settings = { ...DEFAULT_SETTINGS, windowDays: 2 + Math.floor(next() * 5), minDataDays: 1 + Math.floor(next() * 4) }
      const stage = { stage: 's', unitId: 'u', qty: 1e7, milestone: '2027-03-01', sequence: 1 }
      const made = (list: UpdateEvent[]) => projectOrder({ id: 'o', exFactory: '2027-03-01' }, [stage], list, { u: cal }, TODAY, s).stages[0]!.made
      const base = made(evs)
      for (const e of evs) {
        const changed = made(evs.map((x) => (x === e ? { ...x, qty: x.qty + 1000 } : x))) !== base
        const flagged = lowConfidenceStages(evs, new Set([e.clientUuid]), TODAY, s, () => cal).has('s')
        if (changed !== flagged) throw new Error(`case ${i}: ${e.date} changes the rate=${changed} but flagged=${flagged}; settings ${JSON.stringify(s)}; dates ${evs.map((x) => x.date).join(',')}`)
        if (flagged) flaggedCases++; else unflaggedCases++
      }
    }
    expect(flaggedCases).toBeGreaterThan(100)
    expect(unflaggedCases).toBeGreaterThan(100)
  })
})
