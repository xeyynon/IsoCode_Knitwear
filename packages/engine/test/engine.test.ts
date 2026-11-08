import { describe, expect, it } from 'vitest'
import {
  formatMaths, projectOrder, type Order, type Stage, type UpdateEvent, type UnitCalendar,
} from '../src/index.js'
import { nthWorkingDayAfter, workingDaysBetween } from '../src/dates.js'

// Fixtures are constructed to match the figures quoted in the build plan
// ("Need 467/day · making 350/day · 700 pcs short by 11 Nov"). They are NOT the
// companion brief's sample POs, which are not in the repo yet.
const TODAY = '2026-11-04' // Wednesday. Sundays: 1 Nov, 8 Nov, 15 Nov.
const order: Order = { id: 'B-PO-88240', exFactory: '2026-11-20' }
const cals: Record<string, UnitCalendar> = { u1: {} }

let n = 0
const ev = (stage: string, date: string, qty: number, clientUuid = `e${n++}`): UpdateEvent => ({ clientUuid, stage, date, qty })
const days = (stage: string, dates: string[], qty: number) => dates.map((d) => ev(stage, d, qty))
const FIVE = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03']

const stitching = (over: Partial<Stage> = {}): Stage => ({
  stage: 'stitching', unitId: 'u1', qty: 4550, milestone: '2026-11-11', sequence: 1, ...over,
})
const run = (stages: Stage[], events: UpdateEvent[], c = cals, today = TODAY) =>
  projectOrder(order, stages, events, c, today)

describe('worked example from the plan', () => {
  const r = run([stitching()], days('stitching', FIVE, 350))
  const s = r.stages[0]!

  it('is red: making 350/day against 467 needed', () => {
    expect(r.status).toBe('red')
    expect(s.remaining).toBe(2800)
    expect(s.daysLeft).toBe(6) // 5,6,7,9,10,11 Nov; Sunday 8 Nov closed
    expect(Math.round(s.needed!)).toBe(467)
    expect(s.made).toBe(350)
    expect(s.madeIsEstimate).toBe(false)
    expect(s.shortBy).toBe(700)
  })
  it('prints the sentence the screen shows', () => {
    expect(formatMaths(s, '2026-11-11')).toBe('Need 467/day · making 350/day · 700 pcs short by 11 Nov.')
  })
  it('raises a warning because the milestone is within 14 days', () => {
    expect(r.warning).toEqual({ stage: 'stitching', status: 'red' })
  })
})

describe('status rules', () => {
  it('green: making more than needed with a healthy buffer', () => {
    const r = run([stitching({ qty: 5300 })], days('stitching', FIVE, 500)) // 2500 made, 2800 left
    expect(r.stages[0]!.status).toBe('green')
    expect(r.stages[0]!.projectedEnd).toBe('2026-11-11')
    expect(r.stages[0]!.bufferDays).toBe(8)
    expect(r.warning).toBeNull()
  })
  it('amber: making 90-100% of needed, slip stays inside the ex-factory buffer', () => {
    const r = run([stitching({ qty: 4950 })], days('stitching', FIVE, 430)) // 2800 left: needed 466.7, 90% = 420
    const s = r.stages[0]!
    expect(s.status).toBe('amber')
    expect(s.projectedEnd).toBe('2026-11-12')
  })
  it('amber: on pace but buffer before ex-factory under 2 working days', () => {
    const tight: Order = { id: 'x', exFactory: '2026-11-12' }
    const r = projectOrder(tight, [stitching({ qty: 5300 })], days('stitching', FIVE, 500), cals, TODAY)
    expect(r.stages[0]!.bufferDays).toBe(1)
    expect(r.status).toBe('amber')
  })
  it('grey: no update at all, and never green', () => {
    const r = run([stitching()], [])
    expect(r.stages[0]!.status).toBe('grey')
    expect(r.status).toBe('grey')
    expect(r.stages[0]!.made).toBeNull()
    expect(formatMaths(r.stages[0]!, '2026-11-11')).toBe('Need 758/day · no output recorded yet.') // 4550 left over 6 working days
  })
  it('red, not grey: milestone already passed with nothing recorded (a new order set up late)', () => {
    const r = run([stitching({ milestone: '2026-10-20' })], [])
    expect(r.stages[0]!.status).toBe('red')
    expect(r.stages[0]!.reasons).toEqual(['milestone passed with pieces remaining'])
    expect(r.status).toBe('red')
    expect(formatMaths(r.stages[0]!, '2026-10-20')).toBe('milestone has passed · no output recorded yet.')
  })
  it('never prints "Need 0/day" while pieces remain (a small order weeks out)', () => {
    const r = run([stitching({ qty: 5, milestone: '2026-12-10' })], []) // needed 0.16/day
    expect(formatMaths(r.stages[0]!, '2026-12-10')).toBe('Need 1/day · no output recorded yet.')
    const near = run([stitching({ qty: 1752 })], days('stitching', FIVE, 350)) // 2 left over 6 days
    expect(formatMaths(near.stages[0]!, '2026-11-11')).toBe('Need 1/day · making 350/day · on pace.')
  })
  it('grey: a good rate that has gone quiet is not green', () => {
    const r = run([stitching({ qty: 4300 })], days('stitching', ['2026-10-27', '2026-10-28', '2026-10-29'], 500))
    expect(r.stages[0]!.noRecentUpdate).toBe(true)
    expect(r.stages[0]!.status).toBe('grey')
  })
  it('a red stage that has gone quiet stays red and is flagged', () => {
    const r = run([stitching()], days('stitching', ['2026-10-27', '2026-10-28', '2026-10-29'], 100))
    expect(r.stages[0]!.status).toBe('red')
    expect(r.stages[0]!.noRecentUpdate).toBe(true)
  })
  it('the order colour is its worst stage', () => {
    const a = stitching({ stage: 'cutting', sequence: 0, qty: 500 })
    const done = days('cutting', FIVE, 100) // cutting complete
    const r = run([a, stitching({ sequence: 1 })], [...done, ...days('stitching', FIVE, 350)])
    expect(r.stages[0]!.status).toBe('green')
    expect(r.status).toBe('red')
  })
})

describe('estimates, ramp-up and edge cases', () => {
  it('fewer than 3 data days uses the planned rate and says estimate', () => {
    const r = run([stitching({ plannedRate: 480 })], days('stitching', ['2026-11-03'], 100))
    const s = r.stages[0]!
    expect(s.made).toBe(480)
    expect(s.madeIsEstimate).toBe(true)
    expect(s.rampUp).toBe(true)
    expect(formatMaths(s, '2026-11-11')).toContain('(estimate)')
  })
  it('zero history with a planned rate is an estimate, not a reading of zero', () => {
    const s = run([stitching({ plannedRate: 480 })], []).stages[0]!
    expect(s.made).toBe(480)
    expect(s.madeIsEstimate).toBe(true)
  })
  it('stage already complete is green with nothing remaining', () => {
    const s = run([stitching({ qty: 1000 })], days('stitching', FIVE, 200)).stages[0]!
    expect(s.complete).toBe(true)
    expect(s.status).toBe('green')
    expect(s.shortBy).toBe(0)
  })
  it('over-production never gives a negative remaining', () => {
    const s = run([stitching({ qty: 1000 })], days('stitching', FIVE, 300)).stages[0]!
    expect(s.produced).toBe(1500)
    expect(s.remaining).toBe(0)
    expect(s.complete).toBe(true)
  })
  it('milestone in the past with pieces remaining is red and needs no division', () => {
    const s = run([stitching({ milestone: '2026-11-01' })], days('stitching', FIVE, 350)).stages[0]!
    expect(s.daysLeft).toBe(0)
    expect(s.needed).toBeNull()
    expect(s.status).toBe('red')
    expect(formatMaths(s, '2026-11-01')).toContain('milestone has passed')
  })
  it('milestone today with pieces remaining is red but says "due today", not "passed"', () => {
    const s = run([stitching({ milestone: TODAY })], days('stitching', FIVE, 350)).stages[0]!
    expect(s.daysLeft).toBe(0)
    expect(s.needed).toBeNull()
    expect(s.status).toBe('red')
    expect(s.reasons).toEqual(['milestone is today with pieces remaining'])
    expect(formatMaths(s, TODAY)).toBe('milestone is due today · making 350/day · 2800 pcs short by 4 Nov.')
  })
  it('a duplicate client_uuid is counted once', () => {
    const e = ev('stitching', '2026-11-03', 350, 'same')
    const s = run([stitching()], [e, { ...e }]).stages[0]!
    expect(s.produced).toBe(350)
  })
  it('events dated after today are ignored', () => {
    const s = run([stitching()], [ev('stitching', '2026-11-09', 999)]).stages[0]!
    expect(s.produced).toBe(0)
  })
  it('output on a closed Sunday counts as produced but not toward the daily rate', () => {
    const s = run([stitching()], [...days('stitching', FIVE, 350), ev('stitching', '2026-11-01', 5000)]).stages[0]!
    expect(s.produced).toBe(1750 + 5000)
    expect(s.made).toBe(350)
  })
  it('only the last 5 days with an update set the rate', () => {
    const six = ['2026-10-28', ...FIVE]
    const events = [ev('stitching', '2026-10-28', 10), ...days('stitching', FIVE, 350)]
    expect(six).toHaveLength(6)
    expect(run([stitching()], events).stages[0]!.made).toBe(350)
  })
  it('a Deepavali closure removes a working day', () => {
    const c = { u1: { days: { '2026-11-09': false } } }
    const s = run([stitching()], days('stitching', FIVE, 350), c).stages[0]!
    expect(s.daysLeft).toBe(5)
    expect(Math.round(s.needed!)).toBe(560)
  })
  it('a worked Sunday adds a working day', () => {
    const c = { u1: { days: { '2026-11-08': true } } }
    expect(run([stitching()], days('stitching', FIVE, 350), c).stages[0]!.daysLeft).toBe(7)
  })
})

describe('chaining', () => {
  it('a later stage pushed past ex-factory turns the earlier stage red too', () => {
    const cutting = stitching({ stage: 'cutting', sequence: 0, qty: 1000 })
    const sewing = stitching({ stage: 'sewing', sequence: 1, qty: 4000, milestone: '2026-11-20', plannedRate: 400 })
    const r = run([cutting, sewing], days('cutting', FIVE, 100))
    expect(r.stages[0]!.projectedEnd).toBe('2026-11-10')
    expect(r.stages[1]!.projectedEnd).toBe('2026-11-21') // starts after cutting ends
    expect(r.stages[1]!.status).toBe('red')
    expect(r.stages[0]!.status).toBe('red')
    expect(r.stages[0]!.reasons).toContain('a later stage is pushed past ex-factory')
  })
  it('a middle stage with no projection does not reset the chain to today', () => {
    const cutting = stitching({ stage: 'cutting', sequence: 0, qty: 2000, milestone: '2026-11-20' })
    const sewing = stitching({ stage: 'sewing', sequence: 1, qty: 1000, milestone: '2026-11-20' }) // no data, no planned rate
    const packing = stitching({ stage: 'packing', sequence: 2, qty: 500, milestone: '2026-11-20', plannedRate: 100 })
    const r = run([cutting, sewing, packing], days('cutting', ['2026-10-31', '2026-11-02', '2026-11-03'], 100))
    expect(r.stages[0]!.projectedEnd).toBe('2026-11-24')
    expect(r.stages[1]!.projectedEnd).toBeNull()
    expect(r.stages[2]!.projectedEnd).toBe('2026-11-30') // after cutting ends, not 5 days from today
    expect(r.stages[2]!.status).toBe('red')
  })
})

describe('warning rows', () => {
  it('no warning when the milestone is more than 14 days away', () => {
    const r = run([stitching({ milestone: '2026-11-30' })], days('stitching', FIVE, 100))
    expect(r.status).not.toBe('green')
    expect(r.warning).toBeNull()
  })
})

describe('calendar helpers', () => {
  it('counts working days after the start, up to and including the end', () => {
    expect(workingDaysBetween({}, '2026-11-04', '2026-11-11')).toBe(6)
  })
  it('finds the nth working day, skipping Sundays', () => {
    expect(nthWorkingDayAfter({}, '2026-11-04', 6)).toBe('2026-11-11')
  })
  it('is not affected by the machine time zone', () => {
    expect(workingDaysBetween({}, '2026-03-27', '2026-03-31')).toBe(3) // Sat, Mon, Tue; Sunday 29 Mar closed
  })
})

describe('a day that is not over yet', () => {
  it("a morning's first small update does not drag the rate down", () => {
    const events = [...days('stitching', FIVE, 350), ev('stitching', TODAY, 100)]   // five full days of 350, then 100 so far today
    const s = run([stitching()], events).stages[0]!
    expect(s.made).toBe(350)                          // not (350*4 + 100) / 5 = 300
    expect(s.produced).toBe(1750 + 100)               // but today's pieces still count as made
    expect(s.remaining).toBe(4550 - 1850)
  })
  it('even a large update today leaves the rate alone: it shows up as fewer pieces remaining', () => {
    const s = run([stitching()], [...days('stitching', FIVE, 350), ev('stitching', TODAY, 2000)]).stages[0]!
    expect(s.made).toBe(350)
    expect(s.remaining).toBe(800)
    expect(s.status).toBe('green')                    // 800 left over 6 working days needs only 133 a day
  })
  it('with fewer than 3 finished days, today is all there is to go on, so it counts', () => {
    const s = run([stitching()], [...days('stitching', ['2026-11-02', '2026-11-03'], 300), ev('stitching', TODAY, 600)]).stages[0]!
    expect(s.madeIsEstimate).toBe(false)              // three days of data
    expect(s.made).toBe(400)                          // (300 + 300 + 600) / 3
  })
  it('with exactly 3 finished days, the rate is those 3 and ignores today', () => {
    const s = run([stitching()], [...days('stitching', ['2026-10-31', '2026-11-02', '2026-11-03'], 300), ev('stitching', TODAY, 50)]).stages[0]!
    expect(s.made).toBe(300)
  })
  it('the quoted example is unchanged when nothing has been sent today', () => {
    expect(run([stitching()], days('stitching', FIVE, 350)).stages[0]!.made).toBe(350)
  })
})

// BUG-055: no data means grey. A planned rate is a plan, not a reading, so it must never make a stage green.
describe('BUG-055: a planned rate with no updates is never green', () => {
  // [label, qty, plannedRate, expected status]. Needed is qty / 6 working days (5,6,7,9,10,11 Nov).
  const cases: Array<[string, number, number, string]> = [
    ['an easy plan (needed 167, planned 480)', 1000, 480, 'grey'],
    ['a plan exactly at the need', 1200, 200, 'grey'],
    ['a plan well under the need stays red (DEC-010: the estimate can still raise a warning)', 1000, 100, 'red'],
    ['a plan just under the need stays amber', 1000, 160, 'amber'],
  ]
  it.each(cases)('%s', (_label, qty, plannedRate, status) => {
    const r = run([stitching({ qty, plannedRate })], [])
    expect(r.stages[0]!.status).toBe(status)
    expect(r.status).toBe(status)
    expect(r.stages[0]!.madeIsEstimate).toBe(true)
  })
  it('says why it is grey', () => {
    const s = run([stitching({ qty: 1000, plannedRate: 480 })], []).stages[0]!
    expect(s.reasons).toEqual(['no update yet'])
    expect(s.produced).toBe(0)
  })
  it('an order whose only stage has a good plan and no updates is grey, so the board cannot show it green', () => {
    expect(run([stitching({ qty: 1000, plannedRate: 480 })], []).warning).toBeNull()
  })
  it('one real update moves it on: a good rate with fresh data is green again', () => {
    const s = run([stitching({ qty: 1000, plannedRate: 480 })], [ev('stitching', TODAY, 100)]).stages[0]!
    expect(s.madeIsEstimate).toBe(true)
    expect(s.status).toBe('green')
  })
})

// BUG-056: the words must agree with the maths. Compare exactly; round only to display.
describe('BUG-056: "on pace" is only said when it is true', () => {
  const sixDays = (qty: number, perDay: number[]) =>
    run([stitching({ qty })], FIVE.map((d, i) => ev('stitching', d, perDay[i]!)))

  it('a shortfall that rounds to zero is not "on pace" and never prints "0 pcs short"', () => {
    // made 350.6/day over 6 days = 2103.6 against 2104 left: 0.4 of a piece short, amber.
    const s = sixDays(1753 + 2104, [350, 350, 351, 351, 351]).stages[0]!
    expect(s.status).toBe('amber')
    expect(s.made).toBeCloseTo(350.6)
    expect(s.shortBy).toBe(1)
    const text = formatMaths(s, '2026-11-11')
    expect(text).not.toContain('on pace')
    expect(text).not.toContain('0 pcs')
    expect(text).toBe('Need 351/day · making 351/day · 1 pc short by 11 Nov.')
  })
  it('a shortfall of a few pieces keeps its rounded figure', () => {
    const s = sixDays(1753 + 2110, [350, 350, 351, 351, 351]).stages[0]!   // 6.4 short
    expect(s.shortBy).toBe(6)
    expect(formatMaths(s, '2026-11-11')).toContain('6 pcs short by 11 Nov')
  })
  it('exactly enough is on pace', () => {
    const s = sixDays(1750 + 2100, [350, 350, 350, 350, 350]).stages[0]!
    expect(s.shortBy).toBe(0)
    expect(formatMaths(s, '2026-11-11')).toBe('Need 350/day · making 350/day · on pace.')
  })
  it('enough pieces per day but a projected finish after the milestone is not "on pace" either', () => {
    // Sewing could cover its own pieces in time, but cutting ends after sewing is due, and sewing cannot start before.
    const cutting = stitching({ stage: 'cutting', sequence: 0, qty: 4000, milestone: '2026-11-20' })
    const sewing = stitching({ stage: 'sewing', sequence: 1, qty: 5300, milestone: '2026-11-11' })
    const r = run([cutting, sewing], [...days('cutting', FIVE, 100), ...days('sewing', FIVE, 500)])
    const s = r.stages[1]!
    expect(s.shortBy).toBe(0)
    expect(compareIso(s.projectedEnd!, '2026-11-11')).toBeGreaterThan(0)
    const text = formatMaths(s, '2026-11-11')
    expect(text).not.toContain('on pace')
    expect(text).toContain('finish')
  })
})

const compareIso = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// BUG-057: the red reason must name the stage that is actually late.
describe('BUG-057: the red reason names this stage or a later one correctly', () => {
  const LATER = 'a later stage is pushed past ex-factory'
  const SELF = 'this stage is projected past ex-factory'
  it('a lone stage that is itself late says so, not "a later stage"', () => {
    const r = run([stitching({ qty: 4550, milestone: '2026-11-11' })], days('stitching', FIVE, 100))
    expect(r.stages[0]!.status).toBe('red')
    expect(r.stages[0]!.reasons).toContain(SELF)
    expect(r.stages[0]!.reasons).not.toContain(LATER)
  })
  it('the last late stage names itself; an earlier on-time stage names the later one', () => {
    const cutting = stitching({ stage: 'cutting', sequence: 0, qty: 1000 })
    const sewing = stitching({ stage: 'sewing', sequence: 1, qty: 4000, milestone: '2026-11-20', plannedRate: 400 })
    const r = run([cutting, sewing], days('cutting', FIVE, 100))
    expect(r.stages[1]!.reasons).toContain(SELF)
    expect(r.stages[1]!.reasons).not.toContain(LATER)
    expect(r.stages[0]!.reasons).toContain(LATER)
    expect(r.stages[0]!.reasons).not.toContain(SELF)
  })
  it('two late stages: each names itself', () => {
    const a = stitching({ stage: 'cutting', sequence: 0, qty: 4550, milestone: '2026-11-11' })
    const b = stitching({ stage: 'sewing', sequence: 1, qty: 4550, milestone: '2026-11-20' })
    const r = run([a, b], [...days('cutting', FIVE, 100), ...days('sewing', FIVE, 100)])
    expect(r.stages[0]!.reasons).toContain(SELF)
    expect(r.stages[1]!.reasons).toContain(SELF)
    expect(r.stages[0]!.reasons).not.toContain(LATER)
  })
})

// A stage that has not started while the one before it is still running is waiting its turn, not silent.
// Before this rule every order with a stage still ahead read grey, so a real multi-stage order could never be green.
describe('a later stage waiting for the one before it', () => {
  const cutting = (over: Partial<Stage> = {}): Stage => ({ stage: 'cutting', unitId: 'u1', qty: 1000, milestone: '2026-11-10', sequence: 1, ...over })
  const sewing = (over: Partial<Stage> = {}): Stage => ({ stage: 'sewing', unitId: 'u1', qty: 1000, milestone: '2026-11-16', sequence: 2, ...over })
  const goodCutting = days('cutting', FIVE, 150)   // 750 of 1000 made, 250 left with days to spare

  it('is shown as waiting and does not stop a healthy order from being green', () => {
    const r = run([cutting(), sewing()], goodCutting)
    expect(r.stages[1]!.status).toBe('grey')
    expect(r.stages[1]!.reasons).toEqual(['waiting for the previous stage'])
    expect(r.status).toBe('green')
  })
  it('once the stage before it is complete, silence is "no update yet" again and the order is grey', () => {
    const r = run([cutting(), sewing()], days('cutting', FIVE, 200))   // 1000 of 1000: cutting complete
    expect(r.stages[0]!.complete).toBe(true)
    expect(r.stages[1]!.reasons).toEqual(['no update yet'])
    expect(r.status).toBe('grey')
  })
  it('a waiting stage whose own milestone has passed is still red', () => {
    const r = run([cutting({ milestone: '2026-11-02' }), sewing({ milestone: '2026-11-03' })], goodCutting)
    expect(r.stages[1]!.status).toBe('red')
    expect(r.status).toBe('red')
  })
  it('a brand-new order with no update on any stage is still grey, never green', () => {
    expect(run([cutting(), sewing()], []).status).toBe('grey')
  })
})
