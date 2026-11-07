import { describe, expect, it } from 'vitest'
import { backSchedule, type TemplateStep } from '../src/index.js'
import { workingDayOnOrBefore, workingDaysBack } from '../src/dates.js'

// Ex-factory Friday 20 Nov 2026. Sundays (15, 8, 1 Nov) are closed.
const EX = '2026-11-20'
const TODAY = '2026-11-04'
const step = (stage: string, sequence: number, workingDaysBefore: number, unitId = 'u1'): TemplateStep => ({ stage, sequence, workingDaysBefore, unitId })

describe('working-day helpers', () => {
  it('counts back over a Sunday', () => {
    expect(workingDaysBack({}, EX, 0)).toBe('2026-11-20')
    expect(workingDaysBack({}, EX, 4)).toBe('2026-11-16') // 19, 18, 17, 16
    expect(workingDaysBack({}, EX, 5)).toBe('2026-11-14') // skips Sunday 15
  })
  it('a closed ex-factory day falls back to the last working day', () => {
    expect(workingDayOnOrBefore({}, '2026-11-15')).toBe('2026-11-14') // Sunday
  })
  it('skips a Deepavali closure', () => {
    const cal = { days: { '2026-11-19': false } }
    expect(workingDaysBack(cal, EX, 2)).toBe('2026-11-17') // 19 is closed: 18, 17
  })
  it('a worked Sunday counts', () => {
    const cal = { days: { '2026-11-15': true } }
    expect(workingDaysBack(cal, EX, 5)).toBe('2026-11-15')
  })
})

describe('backSchedule', () => {
  const steps = [step('cutting', 1, 12), step('sewing', 2, 6), step('finishing', 3, 2), step('packing', 4, 0)]

  it('works backwards from ex-factory, in stage order', () => {
    const s = backSchedule(EX, steps, {}, TODAY)
    expect(s.problems).toEqual([])
    expect(s.milestones.map((m) => [m.stage, m.plannedEnd])).toEqual([
      ['cutting', '2026-11-06'],   // 12 working days back (Sundays 15 and 8 skipped)
      ['sewing', '2026-11-13'],
      ['finishing', '2026-11-18'],
      ['packing', '2026-11-20'],
    ])
    expect(s.alreadyDue).toEqual([])
  })
  it('uses each stage’s own unit calendar (a subcontractor closed on Saturdays)', () => {
    const cals = { sub: { days: { '2026-11-14': false, '2026-11-07': false } } }
    const s = backSchedule(EX, [step('washing', 1, 6, 'sub'), step('packing', 2, 0)], cals, TODAY)
    expect(s.milestones[0]!.plannedEnd).toBe('2026-11-12')
  })
  it('orders by sequence, not by the order given', () => {
    const s = backSchedule(EX, [...steps].reverse(), {}, TODAY)
    expect(s.milestones.map((m) => m.stage)).toEqual(['cutting', 'sewing', 'finishing', 'packing'])
  })
  it('an order that is already late is scheduled and flagged, not refused', () => {
    const s = backSchedule(EX, steps, {}, '2026-11-12')
    expect(s.problems).toEqual([])
    expect(s.alreadyDue).toEqual(['cutting'])
  })
  it('refuses a template whose offsets put a later stage before an earlier one', () => {
    const s = backSchedule(EX, [step('cutting', 1, 2), step('sewing', 2, 6)], {}, TODAY)
    expect(s.problems.join(' ')).toMatch(/"sewing" would finish .* before "cutting"/)
  })
  it('a closure in one unit does not make good offsets a template fault: the later stage is held to the earlier one', () => {
    // Knitting 6 days back in u1 lands on 13 Nov; linking 5 days back in u2 (closed 13-14 Nov) would land on 12 Nov.
    const cals = { u2: { days: { '2026-11-13': false, '2026-11-14': false } } }
    const s = backSchedule(EX, [step('knitting', 1, 6), step('linking', 2, 5, 'u2')], cals, TODAY)
    expect(s.problems).toEqual([])
    expect(s.milestones.map((m) => [m.stage, m.plannedEnd])).toEqual([['knitting', '2026-11-13'], ['linking', '2026-11-13']])
  })
  it.each([
    ['no stages', [] as TemplateStep[], /no stages/],
    ['a duplicate stage', [step('a', 1, 3), step('a', 2, 2)], /appears twice/],
    ['a negative offset', [step('a', 1, -1)], /whole number/],
    ['a fractional offset', [step('a', 1, 1.5)], /whole number/],
    ['a blank stage name', [step(' ', 1, 1)], /no name/],
  ])('refuses %s', (_label, bad, msg) => {
    expect(backSchedule(EX, bad, {}, TODAY).problems.join(' ')).toMatch(msg)
  })
})
