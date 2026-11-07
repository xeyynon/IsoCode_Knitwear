import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { pieces } from '../src/numberFormat'

// UI/UX plan, slice 3.5 (audit 02 finding 5): one rule for piece counts on every screen, the supervisor's included.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('pieces()', () => {
  it('groups the Indian way, from four digits on', () => {
    expect(pieces(0)).toBe('0')
    expect(pieces(999)).toBe('999')
    expect(pieces(1750)).toBe('1,750')
    expect(pieces(4550)).toBe('4,550')
    expect(pieces(125000)).toBe('1,25,000')
  })
  it('says a dash, never NaN, for a value that is not a number', () => {
    expect(pieces(Number.NaN)).toBe('–')
    expect(pieces(undefined)).toBe('–')
    expect(pieces(null)).toBe('–')
  })
  it('keeps the sign of a negative number', () => {
    expect(pieces(-1750)).toBe('-1,750')
  })
})

describe('every screen uses it', () => {
  const files = ['pages/Today.tsx', 'pages/Update.tsx', 'pages/OrderDetail.tsx', 'pages/Board.tsx', 'pages/Buyer.tsx', 'pages/OrderSetup.tsx', 'orders/visitEntry.ts']
  it('no screen groups a number by itself', () => {
    for (const f of files) expect(read(`../src/${f}`), f).not.toContain("toLocaleString('en-IN')")
  })
  it('the supervisor screens show piece counts through it', () => {
    expect(read('../src/pages/Today.tsx')).toContain('pieces(s.qty)')
    expect(read('../src/pages/Update.tsx')).toContain('pieces(left)')
  })
})
