// O-1 (OPT-A): the faster date maths must give exactly the answers of the code it replaced.
//  1. Every exported date function is compared with datesOracle.ts (a copy of the code before the speed-up) over a large random set.
//  2. A golden fixture, written from the code BEFORE the change, pins the engine's output for 300 generated orders.
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as fast from '../src/dates.js'
import * as oracle from './datesOracle.js'
import { formatMaths, projectOrder, rateDates } from '../src/index.js'
import { dayOfIso, engineCases, isoOfDay, rng } from './optData.js'

const GOLDEN = new URL('./fixtures/optEngineGolden.json', import.meta.url)

// ---------------------------------------------------------------- 2. golden
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')

function engineSnapshot() {
  const cases = engineCases(300, 7)
  const results = cases.map((c) => projectOrder(c.order, c.stages, c.events, c.calendars, c.today, c.settings))
  const maths = results.flatMap((r, i) => r.stages.map((s) => formatMaths(s, cases[i]!.stages.find((x) => x.stage === s.stage)!.milestone)))
  const dates = cases.map((c) => c.stages.map((s) => rateDates(c.events.filter((e) => e.stage === s.stage), c.calendars[s.unitId], c.today, c.settings)))
  const colours = results.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {})
  return {
    orders: cases.length, stages: results.reduce((n, r) => n + r.stages.length, 0), colours,
    sha256: { results: digest(results), maths: digest(maths), rateDates: digest(dates) },
    // A few complete results are kept in the clear so a failure can be read, not only compared by hash.
    sample: results.slice(0, 4),
  }
}

describe('O-1 golden: the engine output for 300 generated orders did not change', () => {
  it('equals the fixture written from the code before the speed-up', () => {
    const now = engineSnapshot()
    if (process.env.OPT_WRITE_GOLDEN === '1') fs.writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n')
    const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))
    expect(JSON.parse(JSON.stringify(now.sample))).toEqual(want.sample)   // readable diff first
    expect(JSON.parse(JSON.stringify(now))).toEqual(want)
  })
})

// ---------------------------------------------------------------- 1. oracle fuzz
/** What a call gives: the value, or the kind of error it threw (a bad date makes both versions throw RangeError). */
const outcome = (f: () => unknown): string => {
  try { const v = f(); return Object.is(v, -0) ? 'v:-0' : `v:${typeof v}:${String(v)}` } catch (e) { return `throw:${(e as Error).name}:${(e as Error).message}` }
}
const same = (what: string, a: () => unknown, b: () => unknown) => {
  const x = outcome(a), y = outcome(b)
  if (x !== y) throw new Error(`${what}: oracle ${x} vs fast ${y}`)
}

type Cal = { days?: Record<string, boolean> } | undefined

function calendars(next: () => number): Cal[] {
  const pick = (n: number) => Math.floor(next() * n)
  const out: Cal[] = [undefined, {}, { days: {} }]
  for (let c = 0; c < 200; c++) {
    const days: Record<string, boolean> = {}
    const k = c % 5 === 0 ? 0 : pick(c % 7 === 0 ? 400 : 120)           // none, a few, or very dense
    const centre = c % 3 === 0 ? '2000-01-20' : c % 3 === 1 ? '2100-12-10' : '2026-06-01'   // both ends of the window, and the middle
    for (let i = 0; i < k; i++) days[isoOfDay(dayOfIso(centre) + pick(600) - 300)] = next() < 0.5   // worked Sundays, closed weekdays, redundant entries
    out.push({ days })
  }
  // keys and values a database would never give, but a caller could
  out.push({ days: { '2026-13-45': false, '2026-02-30': false, '2026-03-02': true, x: false, '2026-1-5': false, '': true, '2026-11-08': undefined as never, '2026-11-09': null as never } })
  out.push({ days: { '0050-01-02': false, '0099-12-31': true, '9999-12-30': false, '2026-11-04': 1 as never, '2026-11-05': 0 as never, '2026-11-06': '' as never } })
  // a unit closed for longer than the 3650-day cap: the cap is part of the behaviour
  const closed: Record<string, boolean> = {}
  for (let i = 0; i < 4000; i++) closed[isoOfDay(dayOfIso('2026-01-01') + i)] = false
  out.push({ days: closed })
  return out
}

const EDGE_DATES = ['2000-01-01', '2000-01-02', '2000-02-29', '2000-12-31', '2024-02-29', '2024-03-01', '2026-11-04', '2100-02-28', '2100-03-01', '2100-12-30', '2100-12-31',
  '0000-01-01', '0026-11-20', '0050-01-02', '0099-12-31', '0100-01-01', '1969-12-31', '1970-01-01', '1970-01-04', '9999-12-30', '9999-12-31']
const ODD_DATES = ['', 'abc', '2026-13-45', '2026-02-30', '2026-1-5', '2026-11-4', '2026-11-04T00:00', '+010000-01-01', '2026-00-10', '2026-11-00', '20261104', '2026/11/04', ' 2026-11-04']

describe('O-1 oracle: every exported date function equals the code it replaced', () => {
  it('addDays, isSunday, compareDates and isWorking over random and edge dates', () => {
    const next = rng(101)
    const pick = (n: number) => Math.floor(next() * n)
    const cals = calendars(next)
    let checks = 0
    const dates = [...EDGE_DATES, ...ODD_DATES]
    for (let i = 0; i < 3000; i++) dates.push(isoOfDay(dayOfIso('1999-12-01') + pick(37000)))   // 1999 to 2101
    for (const d of dates) {
      for (const n of [0, 1, -1, 7, -30, 400, 3650, -3650, 0.5, -0.5, 1.7, Number.NaN]) { same(`addDays(${d},${n})`, () => oracle.addDays(d, n), () => fast.addDays(d, n)); checks++ }
      same(`isSunday(${d})`, () => oracle.isSunday(d), () => fast.isSunday(d)); checks++
      for (const e of ['2026-11-04', d, '2100-12-31', '2000-01-01', 'abc']) { same(`compareDates(${d},${e})`, () => oracle.compareDates(d, e), () => fast.compareDates(d, e)); checks++ }
      for (let k = 0; k < 6; k++) { const cal = cals[pick(cals.length)]; same(`isWorking(${d})`, () => oracle.isWorking(cal, d), () => fast.isWorking(cal, d)); checks++ }
    }
    expect(checks).toBeGreaterThan(50_000)
  })

  it('workingDaysBetween, nthWorkingDayAfter, previousWorkingDay, workingDayOnOrBefore, workingDaysBack over random calendars', () => {
    const next = rng(202)
    const pick = (n: number) => Math.floor(next() * n)
    const cals = calendars(next)
    let checks = 0
    for (const cal of cals) {
      const heavy = Object.keys(cal?.days ?? {}).length > 150     // the old code is slow on a dense calendar: fewer cases there
      for (let i = 0; i < (heavy ? 6 : 30); i++) {
        const base = i % 6 === 0 ? EDGE_DATES[pick(EDGE_DATES.length)]! : i % 6 === 1 ? ODD_DATES[pick(ODD_DATES.length)]! : isoOfDay(dayOfIso('1999-12-01') + pick(37000))
        const b = i % 5 === 0 ? isoOfDay(dayOfIso('2000-01-01') + pick(37000)) : isoOfDay((Number.isFinite(dayOfIso(base)) ? dayOfIso(base) : 0) + (next() < 0.25 ? -pick(40) : pick(450)))   // reversed ranges too
        const n = i % 9 === 0 ? 4000 : i % 9 === 1 ? 0 : pick(90)
        same(`workingDaysBetween(${base},${b})`, () => oracle.workingDaysBetween(cal, base, b), () => fast.workingDaysBetween(cal, base, b))
        same(`nthWorkingDayAfter(${base},${n})`, () => oracle.nthWorkingDayAfter(cal, base, n), () => fast.nthWorkingDayAfter(cal, base, n))
        same(`previousWorkingDay(${base})`, () => oracle.previousWorkingDay(cal, base), () => fast.previousWorkingDay(cal, base))
        same(`workingDayOnOrBefore(${base})`, () => oracle.workingDayOnOrBefore(cal, base), () => fast.workingDayOnOrBefore(cal, base))
        same(`workingDaysBack(${base},${n})`, () => oracle.workingDaysBack(cal, base, n), () => fast.workingDaysBack(cal, base, n))
        checks += 5
      }
    }
    // the odd sizes of n that callers could pass
    for (const cal of cals.slice(0, 40)) for (const n of [-1, 0.5, 1.5, 2.9999, Number.NaN, Infinity]) {
      same(`nth(${n})`, () => oracle.nthWorkingDayAfter(cal, '2026-11-04', n), () => fast.nthWorkingDayAfter(cal, '2026-11-04', n))
      same(`back(${n})`, () => oracle.workingDaysBack(cal, '2026-11-04', n), () => fast.workingDaysBack(cal, '2026-11-04', n))
      checks += 2
    }
    expect(checks).toBeGreaterThan(10_000)
  })

  it('every day of the window: addDays, isSunday and the day-by-day lookups agree (2000-01-01 to 2100-12-31)', () => {
    const cal = { days: { '2000-01-01': true, '2000-01-02': true, '2024-02-29': false, '2100-12-31': false, '2100-12-26': true } }
    let d = '2000-01-01'
    for (let i = 0; i < 36_890; i++) {                   // 101 years of days
      const nx = oracle.addDays(d, 1)
      if (fast.addDays(d, 1) !== nx || fast.addDays(nx, -1) !== d) throw new Error(`addDays at ${d}`)
      if (fast.isSunday(d) !== oracle.isSunday(d)) throw new Error(`isSunday at ${d}`)
      if (fast.isWorking(cal, d) !== oracle.isWorking(cal, d)) throw new Error(`isWorking at ${d}`)
      if (fast.previousWorkingDay(cal, d) !== oracle.previousWorkingDay(cal, d)) throw new Error(`previousWorkingDay at ${d}`)
      if (fast.workingDaysBetween(cal, '2000-01-01', d) !== oracle.workingDaysBetween(cal, '2000-01-01', d)) throw new Error(`workingDaysBetween at ${d}`)
      d = nx
    }
    expect(d).toBe('2101-01-01')
  })

  it('a calendar is read once and then reused: the same calendar object gives the same answers on every call', () => {
    const cal = { days: { '2026-11-08': true, '2026-11-09': false } }
    const first = [fast.workingDaysBetween(cal, '2026-11-01', '2026-11-30'), fast.nthWorkingDayAfter(cal, '2026-11-01', 10), fast.previousWorkingDay(cal, '2026-11-10')]
    for (let i = 0; i < 3; i++) expect([fast.workingDaysBetween(cal, '2026-11-01', '2026-11-30'), fast.nthWorkingDayAfter(cal, '2026-11-01', 10), fast.previousWorkingDay(cal, '2026-11-10')]).toEqual(first)
    expect(first).toEqual([oracle.workingDaysBetween(cal, '2026-11-01', '2026-11-30'), oracle.nthWorkingDayAfter(cal, '2026-11-01', 10), oracle.previousWorkingDay(cal, '2026-11-10')])
  })
})
