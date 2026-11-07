import { describe, expect, it } from 'vitest'
import {
  SHIP_WEEKS, activeConstraints, applyScope, buyersOf, isoWeek, isUnknownChoice, parseScope, progressOf, shipWeekOf, unitsOf, weekRange, withFilter, type BoardRow,
} from '../src/board/boardLogic'
import { readFileSync } from 'node:fs'
import { istDate } from '../src/dates'

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  orderId: crypto.randomUUID(), po: 'P1', buyerId: 'b1', buyerName: 'Buyer B', style: 's', colour: 'c', exFactory: '2026-11-20',
  status: 'green', worstStage: null, maths: null, shortBy: null, reasons: [], noRecentUpdate: false, hasWarning: false, ...over,
})
const pos = (rows: BoardRow[]) => rows.map((r) => r.po)

describe('unit and ship week live in the URL', () => {
  it('reads a unit and a known week, and ignores a week it does not know', () => {
    expect(parseScope(new URLSearchParams('unit=u1&week=next'))).toEqual({ unit: 'u1', week: 'next' })
    expect(parseScope(new URLSearchParams('week=tomorrow'))).toEqual({ unit: null, week: null })
    expect(parseScope(new URLSearchParams(''))).toEqual({ unit: null, week: null })
  })
  it('choosing the active value again clears it, and the other filters are left alone', () => {
    const p = withFilter(withFilter(new URLSearchParams('status=red&buyer=b2&q=knit&sort=po'), 'week', 'this'), 'unit', 'u1')
    expect(p.get('week')).toBe('this')
    expect(p.get('unit')).toBe('u1')
    expect(['status', 'buyer', 'q', 'sort'].map((k) => p.get(k))).toEqual(['red', 'b2', 'knit', 'po'])
    const off = withFilter(withFilter(p, 'week', 'this'), 'unit', null)
    expect(off.toString()).toBe('status=red&buyer=b2&q=knit&sort=po')
  })
  it('offers the weeks in the order a merchandiser reads them', () => {
    expect(SHIP_WEEKS).toEqual(['overdue', 'this', 'next', 'later'])
  })
})

describe('the ISO week of an ex-factory date, against today in India', () => {
  // 2026-11-04 is a Wednesday: this week is Mon 2 to Sun 8 Nov.
  const TODAY = '2026-11-04'
  it('puts Monday and Sunday of the same week together', () => {
    expect(shipWeekOf('2026-11-02', TODAY)).toBe('this')
    expect(shipWeekOf('2026-11-08', TODAY)).toBe('this')
  })
  it('the next day after Sunday is next week, and the Sunday before is overdue', () => {
    expect(shipWeekOf('2026-11-09', TODAY)).toBe('next')
    expect(shipWeekOf('2026-11-15', TODAY)).toBe('next')
    expect(shipWeekOf('2026-11-16', TODAY)).toBe('later')
    expect(shipWeekOf('2026-11-01', TODAY)).toBe('overdue')
  })
  it('a date earlier in the current week is this week; before it is overdue', () => {
    expect(shipWeekOf('2026-11-03', TODAY)).toBe('this')
    expect(shipWeekOf('2025-01-01', TODAY)).toBe('overdue')
  })
  it('works across the year end, where the week has days in two years', () => {
    // 2026-12-31 is a Thursday; its week runs Mon 28 Dec to Sun 3 Jan.
    expect(shipWeekOf('2027-01-03', '2026-12-31')).toBe('this')
    expect(shipWeekOf('2027-01-04', '2026-12-31')).toBe('next')
    expect(shipWeekOf('2026-12-27', '2026-12-31')).toBe('overdue')
    expect(shipWeekOf('2026-12-28', '2027-01-02')).toBe('this')
  })
  it('works across a leap day', () => {
    expect(shipWeekOf('2028-03-01', '2028-02-29')).toBe('this')
    expect(shipWeekOf('2028-03-06', '2028-02-29')).toBe('next')
  })
  it('a date that is not a date belongs to no week', () => {
    expect(shipWeekOf('', TODAY)).toBeNull()
    expect(shipWeekOf('2026-13-40', TODAY)).toBeNull()
    expect(shipWeekOf('2026-02-30', TODAY)).toBeNull()
    expect(shipWeekOf('2026-11-04', 'soon')).toBeNull()
  })
  it('follows the India calendar: late Sunday in UTC is already Monday in India', () => {
    const sundayNightUtc = new Date('2026-11-08T20:00:00Z')   // 01:30 on Monday 9 Nov in India
    expect(istDate(sundayNightUtc)).toBe('2026-11-09')
    expect(shipWeekOf('2026-11-08', istDate(sundayNightUtc))).toBe('overdue')
    expect(shipWeekOf('2026-11-09', istDate(sundayNightUtc))).toBe('this')
    const sundayDayUtc = new Date('2026-11-08T10:00:00Z')     // still Sunday in India
    expect(shipWeekOf('2026-11-08', istDate(sundayDayUtc))).toBe('this')
  })
  it('numbers weeks the ISO way, including the first days of January', () => {
    expect(isoWeek('2026-11-04')).toEqual({ year: 2026, week: 45 })
    expect(isoWeek('2026-12-31')).toEqual({ year: 2026, week: 53 })
    expect(isoWeek('2027-01-03')).toEqual({ year: 2026, week: 53 })
    expect(isoWeek('2027-01-04')).toEqual({ year: 2027, week: 1 })
    expect(isoWeek('2024-12-30')).toEqual({ year: 2025, week: 1 })
    expect(isoWeek('nope')).toBeNull()
  })
  it('names the days of a week for the picker', () => {
    expect(weekRange('2026-11-04', 0)).toBe('2 to 8 Nov')
    expect(weekRange('2026-11-04', 1)).toBe('9 to 15 Nov')
    expect(weekRange('2026-12-31', 0)).toBe('28 Dec to 3 Jan')
    expect(weekRange('bad', 0)).toBe('')
  })
})

describe('filtering by unit and ship week, with the rest of the board', () => {
  const TODAY = '2026-11-04'
  const u1 = { id: 'u1', name: 'Unit 1' }
  const u2 = { id: 'u2', name: 'Unit 2' }
  const rows = [
    row({ po: 'A', units: [u1], exFactory: '2026-11-03' }),
    row({ po: 'B', units: [u1, u2], exFactory: '2026-11-10' }),
    row({ po: 'C', units: [u2], exFactory: '2026-11-30' }),
    row({ po: 'D', units: [u2], exFactory: '2026-10-20' }),
    row({ po: 'E', exFactory: '2026-11-10' }),   // a server that sends no unit data
  ]
  it('no filter keeps every row', () => {
    expect(pos(applyScope(rows, { unit: null, week: null }, TODAY))).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
  it('a unit matches an order when it owns any of its stages', () => {
    expect(pos(applyScope(rows, { unit: 'u2', week: null }, TODAY))).toEqual(['B', 'C', 'D'])
    expect(pos(applyScope(rows, { unit: 'u1', week: null }, TODAY))).toEqual(['A', 'B'])
  })
  it('a week keeps only the orders that ship in it', () => {
    expect(pos(applyScope(rows, { unit: null, week: 'this' }, TODAY))).toEqual(['A'])
    expect(pos(applyScope(rows, { unit: null, week: 'next' }, TODAY))).toEqual(['B', 'E'])
    expect(pos(applyScope(rows, { unit: null, week: 'later' }, TODAY))).toEqual(['C'])
    expect(pos(applyScope(rows, { unit: null, week: 'overdue' }, TODAY))).toEqual(['D'])
  })
  it('unit and week together both have to hold', () => {
    expect(pos(applyScope(rows, { unit: 'u2', week: 'next' }, TODAY))).toEqual(['B'])
    expect(pos(applyScope(rows, { unit: 'u1', week: 'later' }, TODAY))).toEqual([])
  })
  it('lists each unit once, by name', () => {
    expect(unitsOf(rows)).toEqual([u1, u2])
    expect(unitsOf([row({ units: [u2] }), row({ units: [u1, u2] })])).toEqual([u1, u2])
    expect(unitsOf([row()])).toEqual([])
  })
  it('an empty result can name unit and week among what is narrowing the list', () => {
    expect(activeConstraints({ q: '', status: null, buyer: null, unit: 'u1', week: 'next' })).toEqual(['unit', 'week'])
    expect(activeConstraints({ q: 'x', status: 'red', buyer: 'b1', unit: 'u1', week: 'next' })).toEqual(['q', 'status', 'buyer', 'unit', 'week'])
    expect(activeConstraints({ q: '', status: null, buyer: 'b1' })).toEqual(['buyer'])
  })
})

describe('the stage progress of a row', () => {
  it('says stage 3 of 6 while two are done, with the current stage by name', () => {
    expect(progressOf(row({ stagesDone: 2, stagesTotal: 6, currentStage: 'sewing' }))).toEqual({
      done: 2, total: 6, fraction: 2 / 6, text: 'Sewing', label: 'Stage 3 of 6: Sewing',
    })
  })
  it('the first stage of a new order is stage 1, with an empty bar', () => {
    expect(progressOf(row({ stagesDone: 0, stagesTotal: 4, currentStage: 'cutting' }))).toMatchObject({ fraction: 0, label: 'Stage 1 of 4: Cutting' })
  })
  it('when every stage is done the bar is full and says so', () => {
    expect(progressOf(row({ stagesDone: 4, stagesTotal: 4, currentStage: null }))).toMatchObject({
      fraction: 1, text: 'All stages done', label: 'All 4 stages done',
    })
  })
  it('an order with no stages, or from a server that sends none, has no bar rather than an empty one', () => {
    expect(progressOf(row({ stagesDone: 0, stagesTotal: 0, currentStage: null }))).toBeNull()
    expect(progressOf(row())).toBeNull()
  })
  it('never fills past the end if the counts disagree', () => {
    expect(progressOf(row({ stagesDone: 9, stagesTotal: 4, currentStage: null }))).toMatchObject({ done: 4, fraction: 1 })
  })
})

describe('a link naming a buyer with no orders', () => {
  it('is recognised, so the select can keep it visible and clearable', () => {
    const buyers = buyersOf([row({ buyerId: 'b1' }), row({ buyerId: 'b2', buyerName: 'Buyer C' })])
    expect(isUnknownChoice(buyers, 'nobody')).toBe(true)
    expect(isUnknownChoice(buyers, 'b2')).toBe(false)
    expect(isUnknownChoice(buyers, null)).toBe(false)
  })
  it('the board select offers an option for it', () => {
    const src = readFileSync(new URL('../src/pages/Board.tsx', import.meta.url), 'utf8')
    expect(src).toMatch(/isUnknownChoice\(buyers, filters\.buyer\) && <option value=\{filters\.buyer!\}>/)
  })
})
