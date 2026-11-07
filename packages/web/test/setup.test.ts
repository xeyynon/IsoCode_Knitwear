import { describe, expect, it } from 'vitest'
import { accountState, clearDayBody, dayKind, latestRequest, moveRow, purgeDays, templateProblem, tenDigits, weakPin, type StageRow } from '../src/setup/setupLogic'

let id = 0
const row = (stage: string, days: string, unitId = 'u1'): StageRow => ({ id: ++id, stage, days, unitId })

describe('PIN strength (the same rule as the server)', () => {
  it.each([['0000'], ['1111'], ['1234'], ['4321'], ['1212'], ['2580'], ['123'], ['12345'], ['12a4'], ['']])('refuses %j', (p) => expect(weakPin(p)).not.toBeNull())
  it.each([['7391'], ['4072'], ['8514']])('accepts %j', (p) => expect(weakPin(p)).toBeNull())
})

describe('a template as written', () => {
  const good = [row('cutting', '12'), row('sewing', '6'), row('packing', '0')]
  it('is fine when the stages run in order with the biggest number first', () => expect(templateProblem('Knit tee', good)).toBeNull())
  it('a stage may share the number of the one before it', () => expect(templateProblem('x', [row('a', '5'), row('b', '5')])).toBeNull())
  it.each([
    ['no name', ' ', good, /name/],
    ['no stages', 'x', [], /at least one/],
    ['a blank stage name', 'x', [row(' ', '3')], /Stage 1 has no name/],
    ['the same stage twice', 'x', [row('Sewing', '5'), row('sewing', '2')], /listed twice/],
    ['text as the days', 'x', [row('a', 'five')], /whole number/],
    ['a fractional number of days', 'x', [row('a', '1.5')], /whole number/],
    ['more than a year', 'x', [row('a', '400')], /0 to 365/],
    ['no unit', 'x', [row('a', '3', '')], /choose the unit/],
    ['a later stage earlier than the one before', 'x', [row('cutting', '2'), row('sewing', '8')], /would finish before "cutting"/],
  ] as [string, string, StageRow[], RegExp][])('names the problem: %s', (_l, name, rows, msg) => expect(templateProblem(name, rows)).toMatch(msg))
  it('refuses more than 20 stages', () => {
    expect(templateProblem('x', Array.from({ length: 21 }, (_, i) => row(`s${i}`, String(30 - i))))).toMatch(/at most 20/)
  })
})

describe('reordering stages', () => {
  it('moves a row up or down, and never past either end', () => {
    expect(moveRow(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveRow(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveRow(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveRow(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })
  it('never changes the list it was given', () => {
    const list = ['a', 'b']
    moveRow(list, 0, 1)
    expect(list).toEqual(['a', 'b'])
  })
})

describe('plain words for people and days', () => {
  it('stopped beats locked beats active', () => {
    expect(accountState({ disabled: true, locked: true }).tone).toBe('stopped')
    expect(accountState({ disabled: false, locked: true }).tone).toBe('locked')
    expect(accountState({ disabled: false, locked: false })).toEqual({ text: 'Active', tone: 'ok' })
  })
  it('says closed or worked', () => {
    expect(dayKind(false)).toBe('Closed')
    expect(dayKind(true)).toMatch(/Worked/)
  })
  it('reads a phone number however it is typed', () => {
    expect(tenDigits('98100 22334')).toBe('9810022334')
    expect(tenDigits('+91 98100-22334')).toBe('9810022334')
    expect(tenDigits('12345')).toBeNull()
    expect(tenDigits('abcdefghij')).toBeNull()
  })
})

describe('housekeeping days', () => {
  it.each([['7', 7], ['0', 0], [' 30 ', 30], ['3650', 3650]])('accepts %j', (raw, n) => expect(purgeDays(raw)).toBe(n))
  // An empty field must never become 0, which would clear every rejected photo at once.
  it.each([[''], ['  '], ['1e2'], ['0x10'], ['7.0'], ['-1'], ['3651'], ['abc']])('refuses %j', (raw) => expect(purgeDays(raw)).toBeNull())
})

describe('closed days for one unit at a time', () => {
  it('"Back to normal" names the unit the row belongs to, not the unit now selected', () => {
    expect(clearDayBody({ unitId: 'unit-a', date: '2026-12-30' })).toEqual({ unitId: 'unit-a', date: '2026-12-30' })
  })
  it('only the newest list request may fill the table: a late answer for the old unit is ignored', () => {
    const latest = latestRequest()
    const forA = latest.start()
    const forB = latest.start()
    expect(forB()).toBe(true)
    expect(forA()).toBe(false)
    const reloadB = latest.start()
    expect(forB()).toBe(false)
    expect(reloadB()).toBe(true)
  })
})
