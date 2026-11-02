import { describe, expect, it } from 'vitest'
import { daysBetween, isRealDate, parseSizes, slipText, validateOrder, type OrderForm, type SizeRow } from '../src/orders/orderForm'

let id = 0
const rows = (...pairs: [string, string][]): SizeRow[] => pairs.map(([size, qty]) => ({ id: ++id, size, qty }))
const ok: OrderForm = {
  buyerId: 'b', po: 'PO-1', style: 'polo', colour: 'white', exFactory: '2026-11-20', templateId: 't',
  rows: rows(['S', '500'], ['M', '1200']),
}

describe('parseSizes', () => {
  it('builds the size map and adds up the quantity', () => {
    const p = parseSizes(rows(['S', '500'], ['M', '1200'], ['L', '800']))
    expect(p.sizes).toEqual({ S: 500, M: 1200, L: 800 })
    expect(p.total).toBe(2500)
    expect(p.errors).toEqual([])
  })
  it('ignores blank rows, trims names, accepts a zero for one size', () => {
    const p = parseSizes(rows(['', ''], [' M ', ' 40 '], ['XL', '0']))
    expect(p.sizes).toEqual({ M: 40, XL: 0 })
    expect(p.total).toBe(40)
    expect(p.errors).toEqual([])
  })
  it('a size left without a quantity is simply not ordered (the form starts with S, M, L and XL named)', () => {
    const p = parseSizes(rows(['S', ''], ['M', '300'], ['L', ''], ['XL', '']))
    expect(p.sizes).toEqual({ M: 300 })
    expect(p.total).toBe(300)
    expect(p.errors).toEqual([])
  })
  it('but a form with every quantity blank is still refused', () => {
    expect(parseSizes(rows(['S', ''], ['M', ''])).errors.join(' ')).toMatch(/at least one size/)
  })
  it.each([
    ['a quantity with no size', [['', '10']], /no size name/],
    ['a fractional quantity', [['M', '1.5']], /whole number/],
    ['a negative quantity', [['M', '-3']], /whole number/],
    ['text as a quantity', [['M', 'ten']], /whole number/],
    ['the same size twice, in any case', [['M', '1'], ['m', '2']], /listed twice/],
    ['an absurd quantity', [['M', '99999999999']], /too large/],
    ['nothing at all', [['', '']], /at least one size/],
    ['every size zero', [['M', '0']], /more than 0/],
  ] as [string, [string, string][], RegExp][])('names the problem: %s', (_l, input, msg) => {
    expect(parseSizes(rows(...input)).errors.join(' ')).toMatch(msg)
  })
})

describe('validateOrder', () => {
  it('a complete form has no errors', () => expect(validateOrder(ok)).toEqual({}))
  it('names each missing field in plain words', () => {
    const e = validateOrder({ ...ok, buyerId: '', po: ' ', style: '', colour: '', templateId: '', exFactory: '', rows: rows(['', '']) })
    expect(Object.keys(e).sort()).toEqual(['buyerId', 'colour', 'exFactory', 'po', 'sizes', 'style', 'templateId'])
    expect(e.buyerId).toBe('Choose a buyer.')
  })
  it('refuses an impossible date, not just an empty one', () => {
    expect(validateOrder({ ...ok, exFactory: '2026-02-30' }).exFactory).toMatch(/not a real date/)
    expect(isRealDate('2026-02-28')).toBe(true)
    expect(isRealDate('2026-2-3')).toBe(false)
  })
  it('surfaces a size problem', () => {
    expect(validateOrder({ ...ok, rows: rows(['M', 'x']) }).sizes).toMatch(/whole number/)
  })
})

describe('dates on the detail page', () => {
  it('counts calendar days between two dates, across a month end', () => {
    expect(daysBetween('2026-11-11', '2026-11-13')).toBe(2)
    expect(daysBetween('2026-11-28', '2026-12-02')).toBe(4)
    expect(daysBetween('2026-11-13', '2026-11-11')).toBe(-2)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)     // never shifted by a daylight-saving change
  })
  it('says how far the projection is from the plan, in words', () => {
    expect(slipText('2026-11-11', '2026-11-13')).toBe('2 days after plan')
    expect(slipText('2026-11-11', '2026-11-12')).toBe('1 day after plan')
    expect(slipText('2026-11-11', '2026-11-11')).toBe('on plan')
    expect(slipText('2026-11-11', '2026-11-09')).toBe('2 days before plan')
    expect(slipText('2026-11-11', null)).toBeNull()               // no projection: say nothing, do not guess
  })
})
