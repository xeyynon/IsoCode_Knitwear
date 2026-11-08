// Regression tests for the backend bug log (bug.md): BE-001 .. BE-007 and the stage-name rule of BE-030.
// Each test name starts with its bug id.
import { describe, expect, it } from 'vitest'
import { formatMaths, projectOrder, type Stage, type UpdateEvent } from '../src/index.js'
import { workingDayOnOrBefore, workingDaysBack, workingDaysBetween } from '../src/dates.js'

let uid = 0
const ev = (stage: string, date: string, qty: number): UpdateEvent => ({ clientUuid: `be${uid++}`, stage, date, qty })

/** The fastest of a few runs: other work on a busy machine slows a run down, it never speeds one up. */
const fastestMs = (fn: () => void, runs = 7): number => {
  let best = Infinity
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); best = Math.min(best, performance.now() - t0) }
  return best
}

/** A tiny deterministic random source so a failure can be replayed. */
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

describe('BE-001: a stage exactly on pace is not projected a day late', () => {
  const TODAY = '2026-11-02'
  const stageOf = (qty: number, milestone: string): Stage => ({ stage: 's', unitId: 'u', qty, milestone, sequence: 1 })

  it('BE-001: 301/301/302 finished days with 4520 left finishes on the milestone, not the day after', () => {
    const events = [ev('s', '2026-10-28', 301), ev('s', '2026-10-29', 301), ev('s', '2026-10-30', 302)]
    const r = projectOrder({ id: 'o', exFactory: '2026-11-19' }, [stageOf(904 + 4520, '2026-11-19')], events, {}, TODAY)
    const s = r.stages[0]!
    expect(s.remaining).toBe(4520)
    expect(s.daysLeft).toBe(15)
    expect(s.projectedEnd).toBe('2026-11-19')
    expect(s.status).not.toBe('red')
    expect(s.reasons).not.toContain('this stage is projected past ex-factory')
    expect(formatMaths(s, '2026-11-19')).toContain('on pace')
  })

  it('BE-001: the day count equals the exact integer ceil(R*n/S) for many (n, S, R), exact multiples included', () => {
    const next = rng(20261108)
    let checked = 0
    let exactMultiples = 0
    for (let i = 0; i < 3000; i++) {
      const n = 3 + Math.floor(next() * 3)                   // 3..5 finished days: all inside the 5-day window
      const qtys = Array.from({ length: n }, () => 1 + Math.floor(next() * 1000))
      const S = qtys.reduce((a, b) => a + b, 0)
      // Half the cases sit exactly on pace (R = D*S/n for a whole number of days D), the rest are arbitrary.
      const D = 1 + Math.floor(next() * 60)
      const onPace = i % 2 === 0 && (D * S) % n === 0
      const R = onPace ? (D * S) / n : 1 + Math.floor((next() * 60 * S) / n)
      if (onPace) exactMultiples++
      const dates: string[] = []
      let d = workingDayOnOrBefore({}, '2026-10-31')
      for (let k = 0; k < n; k++) { dates.push(d); d = workingDaysBack({}, d, 1) }
      const events = dates.map((dt, k) => ev('s', dt, qtys[k]!))
      const exact = Number((BigInt(R) * BigInt(n) + BigInt(S) - 1n) / BigInt(S))
      const r = projectOrder({ id: 'o', exFactory: '2027-12-31' }, [stageOf(S + R, '2027-12-31')], events, {}, TODAY)
      const s = r.stages[0]!
      expect(s.remaining).toBe(R)
      const got = workingDaysBetween({}, TODAY, s.projectedEnd!)
      if (got !== exact) throw new Error(`n=${n} S=${S} R=${R}: engine says ${got} working days, exact ceil is ${exact}`)
      checked++
    }
    expect(checked).toBe(3000)
    expect(exactMultiples).toBeGreaterThan(300)
  })
})

// ---------------------------------------------------------------------------------------------
// BE-002 / BE-003: dates are bounded, years 0000-0099 are not read as 19xx, and counting working
// days costs weeks, not days.
// ---------------------------------------------------------------------------------------------
import {
  addDays, compareDates, isSunday, isWorking, nthWorkingDayAfter, MAX_DATE, MIN_DATE, isDateInWindow,
  type UnitCalendar,
} from '../src/dates.js'

/** The day-by-day versions the engine used before BE-002; the new ones must agree with these for every date in the window. */
const oldWorkingDaysBetween = (cal: UnitCalendar | undefined, from: string, to: string): number => {
  let n = 0
  for (let d = addDays(from, 1); compareDates(d, to) <= 0; d = addDays(d, 1)) if (isWorking(cal, d)) n++
  return n
}
const oldNthWorkingDayAfter = (cal: UnitCalendar | undefined, from: string, n: number): string => {
  let d = from
  let seen = 0
  for (let i = 0; i < 3650 && seen < n; i++) { d = addDays(d, 1); if (isWorking(cal, d)) seen++ }
  return d
}
const isoOf = (dayNumber: number) => new Date(dayNumber * 86_400_000).toISOString().slice(0, 10)
const dayNumberOf = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000)
const randomCalendar = (next: () => number, from: number, span: number): UnitCalendar => {
  const days: Record<string, boolean> = {}
  const entries = Math.floor(next() * 40)
  for (let i = 0; i < entries; i++) {
    const d = isoOf(from + Math.floor(next() * span))
    days[d] = next() < 0.5                     // a closure on a weekday, a worked Sunday, or a redundant entry
  }
  return { days }
}

describe('BE-003: years 0000-0099 are not read as 19xx', () => {
  it('BE-003: addDays works in year 0050 and 0099 like any other year', () => {
    expect(addDays('0050-01-01', 1)).toBe('0050-01-02')
    expect(addDays('0099-12-31', 1)).toBe('0100-01-01')
    expect(addDays('0026-11-20', -1)).toBe('0026-11-19')
  })
  it('BE-003: a date in year 0026 sorts before 2026, not after 1926', () => {
    expect(compareDates('0026-11-20', '1926-11-20')).toBeLessThan(0)
    expect(compareDates('0026-11-20', '2026-11-20')).toBeLessThan(0)
  })
  it('BE-003: the weekday of a year-0050 date is the real one (proleptic Gregorian)', () => {
    // 1 Jan 0050 is a Saturday (the Gregorian calendar repeats every 400 years: same as 1 Jan 0450)
    expect(isSunday('0050-01-02')).toBe(true)
    expect(isSunday('0050-01-09')).toBe(true)
    expect(isSunday('0050-01-04')).toBe(false)
  })
  it('BE-003: the window of plausible dates is 2000-01-01 to 2100-12-31', () => {
    expect(MIN_DATE).toBe('2000-01-01')
    expect(MAX_DATE).toBe('2100-12-31')
    expect(isDateInWindow('2000-01-01')).toBe(true)
    expect(isDateInWindow('2100-12-31')).toBe(true)
    expect(isDateInWindow('1999-12-31')).toBe(false)
    expect(isDateInWindow('2101-01-01')).toBe(false)
    expect(isDateInWindow('0026-11-20')).toBe(false)
    expect(isDateInWindow('9999-12-31')).toBe(false)
  })
})

describe('BE-002: working days are counted in time proportional to weeks', () => {
  it('BE-002: 100 years are counted in well under 50 ms', () => {
    const n = workingDaysBetween({}, MIN_DATE, MAX_DATE)
    expect(n).toBeGreaterThan(31_000)
    expect(fastestMs(() => workingDaysBetween({}, MIN_DATE, MAX_DATE))).toBeLessThan(50)
  })

  it('BE-002: a far-future milestone (9999-12-31) projects in under 50 ms and does not hang the engine', () => {
    const far = () => projectOrder(
      { id: 'o', exFactory: '9999-12-31' },
      [{ stage: 's', unitId: 'u', qty: 1000, milestone: '9999-12-31', sequence: 1 }],
      [ev('s', '2026-11-02', 10), ev('s', '2026-11-03', 10), ev('s', '2026-11-04', 10)], {}, '2026-11-05')
    const t0 = performance.now()
    const r = far()
    expect(performance.now() - t0).toBeLessThan(500)           // it took 12 to 22 seconds
    expect(fastestMs(far)).toBeLessThan(50)
    expect(r.stages[0]!.daysLeft).toBeGreaterThan(1_000_000)
  })

  it('BE-002: equals the day-by-day loop for every (from, to) pair over 130 days, with and without closures', () => {
    const next = rng(7)
    const start = dayNumberOf('2026-11-01')
    for (const cal of [undefined, {}, randomCalendar(next, start, 130), randomCalendar(next, start, 130), randomCalendar(next, start, 130)]) {
      for (let a = 0; a < 130; a += 1) {
        for (let b = a - 3; b < 130; b += 3) {
          const from = isoOf(start + a), to = isoOf(start + b)
          const want = oldWorkingDaysBetween(cal, from, to)
          const got = workingDaysBetween(cal, from, to)
          if (got !== want) throw new Error(`${from} -> ${to}: got ${got}, the loop says ${want}`)
        }
      }
    }
  })

  it('BE-002: equals the loop for random long ranges and calendars anywhere in the window (also around leap days)', () => {
    const next = rng(99)
    const lo = dayNumberOf(MIN_DATE), hi = dayNumberOf(MAX_DATE)
    for (let i = 0; i < 400; i++) {
      const a = lo + Math.floor(next() * (hi - lo)), len = Math.floor(next() * 3000) - 20
      const b = Math.min(hi, a + len)
      const cal = randomCalendar(next, a - 30, Math.max(1, len + 60))
      const from = isoOf(a), to = isoOf(b)
      expect(workingDaysBetween(cal, from, to)).toBe(oldWorkingDaysBetween(cal, from, to))
    }
    // The ends of the window and a Sunday-to-Sunday span
    expect(workingDaysBetween({}, '2026-11-01', '2026-11-08')).toBe(oldWorkingDaysBetween({}, '2026-11-01', '2026-11-08'))
    expect(workingDaysBetween({}, '2100-12-30', '2100-12-31')).toBe(oldWorkingDaysBetween({}, '2100-12-30', '2100-12-31'))
  })

  it('BE-002: nthWorkingDayAfter gives the same date as the loop, including the ten-year cap and an all-closed calendar', () => {
    const next = rng(5)
    const start = dayNumberOf('2026-01-01')
    for (let i = 0; i < 600; i++) {
      const from = isoOf(start + Math.floor(next() * 4000))
      const n = i % 3 === 0 ? Math.floor(next() * 6000) : Math.floor(next() * 80)
      const cal = i % 5 === 0 ? { days: Object.fromEntries(Array.from({ length: 3700 }, (_, k) => [addDays(from, k + 1), false])) }
        : randomCalendar(next, start, 4500)
      expect(nthWorkingDayAfter(cal, from, n)).toBe(oldNthWorkingDayAfter(cal, from, n))
    }
  })

  it('BE-002: a rate of one piece a day over 20000 pieces projects at the ten-year cap quickly', () => {
    const slow = () => projectOrder(
      { id: 'o', exFactory: '2027-01-01' },
      [{ stage: 's', unitId: 'u', qty: 20003, milestone: '2027-01-01', sequence: 1 }],
      [ev('s', '2026-11-02', 1), ev('s', '2026-11-03', 1), ev('s', '2026-11-04', 1)], {}, '2026-11-05')
    expect(slow().stages[0]!.projectedEnd).toBe(oldNthWorkingDayAfter({}, '2026-11-05', 20000))
    expect(fastestMs(slow)).toBeLessThan(50)
  })
})

// ---------------------------------------------------------------------------------------------
// BE-007: the words in a reason quote the configured thresholds.
// ---------------------------------------------------------------------------------------------
import { DEFAULT_SETTINGS, normalizeSettings, rateDates, cleanEvents } from '../src/index.js'

describe('BE-007: reason text is built from the settings', () => {
  const FIVE = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03']
  const run = (qty: number, perDay: number, settings = DEFAULT_SETTINGS, milestone = '2026-11-11') =>
    projectOrder({ id: 'o', exFactory: '2026-11-20' }, [{ stage: 's', unitId: 'u', qty, milestone, sequence: 1 }],
      FIVE.map((d) => ev('s', d, perDay)), {}, '2026-11-04', settings).stages[0]!

  it('BE-007: with the stock settings the words are the ones the screens and the README already show', () => {
    expect(run(4950, 430).reasons).toEqual(['making 90-100% of needed'])                      // 2800 left over 6 days: needs 467
    expect(run(4550, 350).reasons).toEqual(['making less than 90% of needed'])
    expect(run(4550, 350, DEFAULT_SETTINGS, '2026-11-11').status).toBe('red')
  })
  it('BE-007: a different redBelow is quoted in both the red and the amber reason', () => {
    const s = { ...DEFAULT_SETTINGS, redBelow: 0.5 }
    expect(run(4550, 100, s).reasons).toContain('making less than 50% of needed')            // 100 of 467 needed: 21%
    expect(run(4550, 300, s).reasons[0]).toBe('making 50-100% of needed')                    // 300 of 467: 64%, between 50% and 100%
    expect(run(4550, 300, { ...DEFAULT_SETTINGS, redBelow: 0.925 }).reasons).toContain('making less than 92.5% of needed')
  })
  it('BE-007: the buffer days are quoted, with "day" in the singular for one', () => {
    // Finishes on 5 Nov at 1000 a day; ex-factory 9 Nov leaves 3 working days (6, 7, 9), ex-factory 5 Nov leaves none.
    const onPace = (settings: typeof DEFAULT_SETTINGS, exFactory = '2026-11-09') => projectOrder(
      { id: 'o', exFactory }, [{ stage: 's', unitId: 'u', qty: 5000 + 550, milestone: '2026-11-11', sequence: 1 }],
      FIVE.map((d) => ev('s', d, 1000)), {}, '2026-11-04', settings).stages[0]!
    expect(onPace(DEFAULT_SETTINGS).bufferDays).toBe(3)
    expect(onPace(DEFAULT_SETTINGS).status).toBe('green')
    expect(onPace({ ...DEFAULT_SETTINGS, bufferDays: 5 }).reasons).toEqual(['buffer before ex-factory under 5 working days'])
    expect(onPace({ ...DEFAULT_SETTINGS, bufferDays: 4 }).reasons).toEqual(['buffer before ex-factory under 4 working days'])
    expect(onPace(DEFAULT_SETTINGS, '2026-11-06').reasons).toEqual(['buffer before ex-factory under 2 working days'])
    expect(onPace({ ...DEFAULT_SETTINGS, bufferDays: 1 }, '2026-11-05').reasons).toEqual(['buffer before ex-factory under 1 working day'])
  })
})

// ---------------------------------------------------------------------------------------------
// BE-005 / BE-004 in the engine: the settings are normalised, and one rule says which days feed the rate.
// ---------------------------------------------------------------------------------------------
describe('BE-005: normalizeSettings', () => {
  it('BE-005: keeps good values and replaces every unusable key by its default', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ windowDays: 0, minDataDays: 0, rampUpDays: -1, redBelow: 0, bufferDays: 1.5, warnWithinDays: Number.NaN })).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ windowDays: 7, minDataDays: 2, rampUpDays: 0, redBelow: 1, bufferDays: 0, warnWithinDays: 30 }))
      .toEqual({ windowDays: 7, minDataDays: 2, rampUpDays: 0, redBelow: 1, bufferDays: 0, warnWithinDays: 30 })
    expect(normalizeSettings({ redBelow: 1.01 }).redBelow).toBe(DEFAULT_SETTINGS.redBelow)
    expect(normalizeSettings({ windowDays: 100000 }).windowDays).toBe(DEFAULT_SETTINGS.windowDays)
  })
})

describe('BE-004: one rule for the days that feed the rate', () => {
  const T = '2026-11-02'   // Monday
  const e = (id: string, date: string, qty = 10): UpdateEvent => ({ clientUuid: id, stage: 's', date, qty })
  const run = (events: UpdateEvent[], settings = { ...DEFAULT_SETTINGS, windowDays: 5 }, cal: { days: Record<string, boolean> } | undefined = undefined) =>
    rateDates(cleanEvents(events, T), cal, T, settings)

  it('BE-004: with enough finished days, today is left out; the window is the newest windowDays of them', () => {
    const evs = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', T].map((d, i) => e(`a${i}`, d))
    expect(run(evs)).toEqual(['2026-10-31', '2026-10-30', '2026-10-29', '2026-10-28', '2026-10-27'])
  })
  it('BE-004: with too few finished days, today is included', () => {
    expect(run([e('a', '2026-10-30'), e('b', '2026-10-31'), e('c', T)])).toEqual([T, '2026-10-31', '2026-10-30'])
  })
  it('BE-004: closed days (Sundays, or a day the calendar closes) and future days never feed the rate', () => {
    const evs = [e('a', '2026-10-28'), e('b', '2026-10-29'), e('c', '2026-10-30'), e('d', '2026-11-01'), e('f', '2026-11-05')]
    expect(run(evs, undefined, { days: { '2026-10-29': false } })).toEqual(['2026-10-30', '2026-10-28'])
  })
  it('BE-004: it agrees with the engine on what was made: the average over exactly these days', () => {
    const evs = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', T].map((d, i) => e(`a${i}`, d, 100 + i * 7))
    const dates = run(evs)
    const r = projectOrder({ id: 'o', exFactory: '2027-01-01' }, [{ stage: 's', unitId: 'u', qty: 99999, milestone: '2026-12-01', sequence: 1 }], evs, {}, T, { ...DEFAULT_SETTINGS, windowDays: 5 })
    const byDate = new Map(evs.map((x) => [x.date, x.qty]))
    expect(r.stages[0]!.made).toBe(dates.reduce((s, d) => s + byDate.get(d)!, 0) / dates.length)
  })
})
