import { describe, expect, it } from 'vitest'
import { parseSizes, type SizeRow } from '../src/orders/orderForm'
import { parsePieces } from '../src/dates'

// Final cycle W-12: the Update screen takes "1,000", "1 000" and "1,00,000" for pieces; the order form refused them. Same forms, same meaning.
let id = 0
const one = (qty: string): SizeRow[] => [{ id: ++id, size: 'M', qty }]

describe('W-12: a quantity typed the way people write numbers', () => {
  it.each([['1,000', 1000], ['1 000', 1000], ['1,00,000', 100000], ['12 500', 12500], [' 500 ', 500]])('W-12: "%s" is %i', (text, n) => {
    const p = parseSizes(one(text))
    expect(p.errors).toEqual([])
    expect(p.sizes.M).toBe(n)
  })
  it('W-12: "0" is accepted without an error, and the size is simply not ordered (FE-M-18: a size of 0 is not stored)', () => {
    const p = parseSizes(one('0').concat([{ id: ++id, size: 'L', qty: '5' }]))
    expect(p.errors).toEqual([])
    expect(p.sizes.M).toBeUndefined()
    expect(p.sizes.L).toBe(5)
  })
  it('W-12: reads every form the Update screen reads, to the same number', () => {
    for (const t of ['1,000', '1 000', '1,00,000', '250', '40,000']) expect(parseSizes(one(t)).sizes.M).toBe(parsePieces(t))
  })
  it.each(['-3', '1.5', 'ten', '1,5x', ',', '1e3'])('W-12: "%s" is still refused as not a whole number', (t) => {
    expect(parseSizes(one(t)).errors.join(' ')).toMatch(/whole number/)
  })
  it('W-12: an absurd quantity is still too large, however it is written', () => {
    expect(parseSizes(one('99,99,99,99,999')).errors.join(' ')).toMatch(/too large/)
  })
  it('W-12: the total adds up the numbers as read', () => {
    const rows: SizeRow[] = [{ id: ++id, size: 'S', qty: '1,000' }, { id: ++id, size: 'M', qty: '2 500' }]
    expect(parseSizes(rows).total).toBe(3500)
  })
})
