import { describe, expect, it } from 'vitest'
import { buildTimeline, closedLabel, type LayoutInput, type LayoutStage } from '../src/orders/timelineLayout'

const stage = (over: Partial<LayoutStage>): LayoutStage => ({
  stage: 'cutting', sequence: 1, status: 'green', complete: false, plannedEnd: '2026-11-06', projectedEnd: '2026-11-06', unitId: 'u1', ...over,
})
const input = (over: Partial<LayoutInput> = {}): LayoutInput => ({
  stages: [stage({}), stage({ stage: 'sewing', sequence: 2, plannedEnd: '2026-11-13', projectedEnd: '2026-11-13' })],
  exFactory: '2026-11-20', from: '2026-11-04', to: '2026-11-20',
  units: [{ unitId: 'u1', unitName: 'Unit 1', closed: [] }],
  ...over,
})

describe('date to position', () => {
  it('puts a day in the middle of its own cell, so the first and last day both fit', () => {
    const t = buildTimeline(input({ from: '2026-11-01', to: '2026-11-10', exFactory: '2026-11-10', stages: [stage({ plannedEnd: '2026-11-05', projectedEnd: null })] }))
    expect(t.days).toBe(10)
    expect(t.exFactory.pct).toBeCloseTo(95, 5)          // day 10 of 10
    expect(t.rows[0]!.planned.pct).toBeCloseTo(45, 5)   // day 5 of 10
  })
  it('a bar covers whole days: the first stage from the start of the window to its planned finish day', () => {
    const t = buildTimeline(input({ from: '2026-11-01', to: '2026-11-10', exFactory: '2026-11-10', stages: [stage({ plannedEnd: '2026-11-05', projectedEnd: null })] }))
    expect(t.rows[0]!.bar).toEqual({ leftPct: 0, widthPct: 50 })
  })
  it('a later stage starts the day after the stage before it finishes', () => {
    const t = buildTimeline(input({ from: '2026-11-01', to: '2026-11-10', exFactory: '2026-11-10', stages: [
      stage({ plannedEnd: '2026-11-04', projectedEnd: null }), stage({ stage: 'sewing', sequence: 2, plannedEnd: '2026-11-08', projectedEnd: null })] }))
    expect(t.rows[1]!.bar).toEqual({ leftPct: 40, widthPct: 40 })
  })
  it('a stage held to the same date as the one before still gets a one-day bar, never a negative one', () => {
    const t = buildTimeline(input({ from: '2026-11-01', to: '2026-11-10', exFactory: '2026-11-10', stages: [
      stage({ plannedEnd: '2026-11-06', projectedEnd: null }), stage({ stage: 'sewing', sequence: 2, plannedEnd: '2026-11-06', projectedEnd: null })] }))
    expect(t.rows[1]!.bar).toEqual({ leftPct: 50, widthPct: 10 })
  })
  it('stages arrive in any order and are laid out in sequence', () => {
    const t = buildTimeline(input({ stages: [stage({ stage: 'sewing', sequence: 2, plannedEnd: '2026-11-13' }), stage({})] }))
    expect(t.rows.map((r) => r.stage)).toEqual(['cutting', 'sewing'])
  })
  it('keeps every date on the track: a window that is too small is widened, never clipped', () => {
    const t = buildTimeline(input({ from: '2026-11-08', to: '2026-11-09', exFactory: '2026-11-20', stages: [stage({ plannedEnd: '2026-11-12', projectedEnd: '2026-11-25' })] }))
    expect(t.from).toBe('2026-11-08')
    expect(t.to).toBe('2026-11-25')
    for (const r of t.rows) for (const p of [r.planned.pct, r.lower.pct]) { expect(p).toBeGreaterThan(0); expect(p).toBeLessThan(100) }
  })
  it('marks that sit near an edge grow inward so their label is not cut off', () => {
    const t = buildTimeline(input({ from: '2026-11-01', to: '2026-11-30', exFactory: '2026-11-30', stages: [stage({ plannedEnd: '2026-11-02', projectedEnd: '2026-11-30' })] }))
    expect(t.rows[0]!.planned.anchor).toBe('start')
    expect(t.rows[0]!.lower.anchor).toBe('end')
    expect(t.exFactory.anchor).toBe('end')
  })
})

describe('planned above, projected below', () => {
  it('shows both dates and says how far apart they are, in words', () => {
    const t = buildTimeline(input({ stages: [stage({ plannedEnd: '2026-11-11', projectedEnd: '2026-11-13', status: 'red' })] }))
    const r = t.rows[0]!
    expect(r.planned.label).toBe('Plan 11 Nov')
    expect(r.lower.label).toBe('Projected 13 Nov · 2 days late')
    expect(r.lower.hasMark).toBe(true)
    expect(r.slip).not.toBeNull()
  })
  it('on plan has no slip stretch', () => {
    const r = buildTimeline(input({ stages: [stage({ plannedEnd: '2026-11-11', projectedEnd: '2026-11-11' })] })).rows[0]!
    expect(r.lower.label).toBe('Projected 11 Nov · on plan')
    expect(r.slip).toBeNull()
  })
  it('a stage with no projection says so and draws no projected mark (a dash is not a date)', () => {
    const r = buildTimeline(input({ stages: [stage({ status: 'grey', projectedEnd: null })] })).rows[0]!
    expect(r.lower.label).toBe('Not enough data')
    expect(r.lower.hasMark).toBe(false)
    expect(r.slip).toBeNull()
  })
  it('a finished stage says Done and draws no projected mark', () => {
    const r = buildTimeline(input({ stages: [stage({ complete: true, projectedEnd: '2026-11-05' })] })).rows[0]!
    expect(r.lower.label).toBe('Done')
    expect(r.lower.hasMark).toBe(false)
    expect(r.done).toBe(true)
  })
  it('the status is carried on the row for the badge, never decided here', () => {
    const t = buildTimeline(input({ stages: [stage({ status: 'amber' }), stage({ stage: 'sewing', sequence: 2, status: 'grey', projectedEnd: null })] }))
    expect(t.rows.map((r) => r.status)).toEqual(['amber', 'grey'])
  })
})

describe('a stage that runs past ex-factory', () => {
  const t = buildTimeline(input({ exFactory: '2026-11-12', from: '2026-11-04', to: '2026-11-12', stages: [
    stage({ plannedEnd: '2026-11-10', projectedEnd: '2026-11-10' }),
    stage({ stage: 'sewing', sequence: 2, status: 'red', plannedEnd: '2026-11-12', projectedEnd: '2026-11-16' })] }))
  it('widens the window past ex-factory so the projected date is still on the page', () => {
    expect(t.to).toBe('2026-11-16')
    expect(t.exFactory.pct).toBeLessThan(t.rows[1]!.lower.pct)
  })
  it('says so in words, on that stage only', () => {
    expect(t.rows[0]!.pastExFactory).toBe(false)
    expect(t.rows[1]!.pastExFactory).toBe(true)
    expect(t.rows[1]!.lower.label).toBe('Projected 16 Nov · 4 days late · after ex-factory')
    expect(t.rows[1]!.spoken).toMatch(/after ex-factory/)
  })
  it('a planned date after ex-factory counts too', () => {
    const late = buildTimeline(input({ exFactory: '2026-11-12', stages: [stage({ plannedEnd: '2026-11-14', projectedEnd: null })] }))
    expect(late.rows[0]!.pastExFactory).toBe(true)
  })
})

describe('closed days', () => {
  const closed = [
    { date: '2026-11-08', reason: 'Sunday' }, { date: '2026-11-09', reason: 'Deepavali' }, { date: '2026-11-10', reason: 'Deepavali' },
    { date: '2026-11-15', reason: 'Sunday' },
  ]
  const t = buildTimeline(input({ from: '2026-11-01', to: '2026-11-20', exFactory: '2026-11-20', units: [{ unitId: 'u1', unitName: 'Unit 1', closed }] }))
  const runs = t.rows[0]!.closed
  it('joins neighbouring days with the same reason into one stripe, and keeps different reasons apart', () => {
    expect(runs.map((r) => [r.reason, r.from, r.to])).toEqual([
      ['Sunday', '2026-11-08', '2026-11-08'], ['Deepavali', '2026-11-09', '2026-11-10'], ['Sunday', '2026-11-15', '2026-11-15']])
  })
  it('puts each stripe over exactly its days', () => {
    expect(runs[1]).toMatchObject({ leftPct: 40, widthPct: 10 })    // days 9 and 10 of a 20-day window
  })
  it('shows a unit only its own closed days', () => {
    const two = buildTimeline(input({
      from: '2026-11-01', to: '2026-11-20', exFactory: '2026-11-20',
      stages: [stage({ unitId: 'u1' }), stage({ stage: 'sewing', sequence: 2, unitId: 'u2', plannedEnd: '2026-11-13' })],
      units: [{ unitId: 'u1', unitName: 'Unit 1', closed: [{ date: '2026-11-09', reason: 'Deepavali' }] }, { unitId: 'u2', unitName: 'Unit 2', closed: [{ date: '2026-11-11', reason: 'Power shutdown' }] }],
    }))
    expect(two.rows[0]!.closed.map((r) => r.reason)).toEqual(['Deepavali'])
    expect(two.rows[1]!.closed.map((r) => r.reason)).toEqual(['Power shutdown'])
  })
  it('ignores a closed day outside the window and one for a unit with no stage here', () => {
    const o = buildTimeline(input({ from: '2026-11-01', to: '2026-11-20', exFactory: '2026-11-20', units: [
      { unitId: 'u1', unitName: 'Unit 1', closed: [{ date: '2026-12-25', reason: 'Christmas' }] }, { unitId: 'u9', unitName: 'Other', closed: [{ date: '2026-11-09', reason: 'x' }] }] }))
    expect(o.rows[0]!.closed).toEqual([])
    expect(o.legend).toEqual([])
  })
  it('a legend lists each reason once, named closures before Sundays', () => {
    expect(t.legend.map((l) => l.label)).toEqual(['Closed: Deepavali', 'Closed: Sunday'])
  })
  it('a named closure is told apart from an ordinary Sunday, in the stripes and in the legend, so two hatches never mean two things', () => {
    expect(runs.map((r) => r.named)).toEqual([false, true, false])
    expect(t.legend.map((l) => l.named)).toEqual([true, false])
  })
  it('the same facts in plain words for a screen reader and for the phone layout', () => {
    expect(t.rows[0]!.closedText).toBe('Deepavali 9 Nov, 10 Nov; Sunday 8 Nov, 15 Nov')
    expect(t.closedSummary).toEqual([{ unitName: 'Unit 1', text: 'Deepavali 9 Nov, 10 Nov; Sunday 8 Nov, 15 Nov' }])
    expect(t.rows[0]!.spoken).toMatch(/Closed days in Unit 1: Deepavali 9 Nov, 10 Nov; Sunday 8 Nov, 15 Nov/)
  })
  it('a unit with no closed days says so rather than saying nothing', () => {
    const none = buildTimeline(input())
    expect(none.closedSummary).toEqual([{ unitName: 'Unit 1', text: 'none in this period' }])
  })
  it('a plain "Closed" reason is not printed twice', () => {
    expect(closedLabel('Closed')).toBe('Closed day')
    expect(closedLabel('Deepavali')).toBe('Closed: Deepavali')
  })
})

describe('the week ticks along the top', () => {
  it('marks the first day and each Monday, and never crowds two labels together', () => {
    const t = buildTimeline(input({ from: '2026-11-04', to: '2026-11-24', exFactory: '2026-11-24' }))
    expect(t.ticks.map((k) => k.label)).toEqual(['4 Nov', '9 Nov', '16 Nov', '23 Nov'])
  })
  it('drops a Monday that is right beside the first day', () => {
    const t = buildTimeline(input({ from: '2026-11-08', to: '2026-11-20', exFactory: '2026-11-20', stages: [stage({ plannedEnd: '2026-11-13', projectedEnd: '2026-11-13' })] }))
    expect(t.ticks.map((k) => k.label)).toEqual(['8 Nov', '16 Nov'])
  })
})

describe('nothing to draw', () => {
  it('no stages gives no rows and no crash', () => {
    const t = buildTimeline(input({ stages: [] }))
    expect(t.rows).toEqual([])
    expect(t.days).toBeGreaterThan(0)
  })
})
