import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { shipIn, shortByStatus, counts, type BoardRow } from '../src/board/boardLogic'

// UI/UX 2.0 phase 8B: the board as a dashboard on a wide screen (status tiles, a toolbar that belongs to the table, a ship date in words).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const board = read('../src/pages/Board.tsx')

const row = (o: Partial<BoardRow>): BoardRow => ({
  orderId: 'o', po: 'PO', buyerId: 'b1', buyerName: 'Buyer B', style: 'tee', colour: 'navy', exFactory: '2026-11-20',
  status: 'green', worstStage: null, maths: null, shortBy: null, reasons: [], noRecentUpdate: false, hasWarning: false, ...o,
})

describe('shortByStatus', () => {
  const rows = [
    row({ status: 'red', shortBy: 700 }), row({ status: 'red', shortBy: 300 }),
    row({ status: 'amber', shortBy: 220 }),
    row({ status: 'grey', shortBy: null }), row({ status: 'green', shortBy: 0 }),
    row({ status: 'red', shortBy: 50, buyerId: 'b2' }),
  ]
  it('adds up the real shortfalls of each status, and in total', () => {
    expect(shortByStatus(rows, { status: null, buyer: null })).toEqual({ red: 1050, amber: 220, grey: 0, green: 0, total: 1270 })
  })
  it('follows the buyer choice exactly as the counts do, so a tile\'s number and its shortfall agree', () => {
    const f = { status: null, buyer: 'b1' }
    expect(shortByStatus(rows, f).red).toBe(1000)
    expect(counts(rows, f).red).toBe(2)
  })
  it('ignores a missing or negative value instead of inventing one', () => {
    expect(shortByStatus([row({ status: 'red', shortBy: null }), row({ status: 'red', shortBy: -5 })], { status: null, buyer: null }).red).toBe(0)
  })
})

describe('shipIn', () => {
  it('says how far away the ship date is, in words', () => {
    expect(shipIn('2026-11-20', '2026-11-04')).toBe('in 16 days')
    expect(shipIn('2026-11-05', '2026-11-04')).toBe('tomorrow')
    expect(shipIn('2026-11-04', '2026-11-04')).toBe('today')
    expect(shipIn('2026-11-03', '2026-11-04')).toBe('1 day ago')
    expect(shipIn('2026-10-30', '2026-11-04')).toBe('5 days ago')
  })
  it('says nothing for a date it cannot read', () => {
    expect(shipIn('soon', '2026-11-04')).toBe('')
    expect(shipIn('2026-11-20', '')).toBe('')
  })
})

describe('Board.tsx on a wide screen', () => {
  it('shows the status tiles in place of the chip row, and keeps the chips for the phone', () => {
    expect(board).toContain('<StatusTiles')
    expect(board).toMatch(/narrow \? \([\s\S]*?\{chips\}[\s\S]*?\) : \(/)
  })
  it('gives the tiles the same numbers the chips had (the counts), and the buyer choice sits above them with the tools, since it changes their numbers', () => {
    expect(board).toMatch(/count:\s*c\[s\]/)
    expect(board).toMatch(/<div className="strip boardhead"[^>]*>\s*\{buyerSelect\}\{tools\}/)
  })
  it('attaches the search and filters to the table as its toolbar, on a wide screen only', () => {
    expect(board).toMatch(/<form className="strip strip--find strip--attached"/)
  })
  it('still reads and writes the status filter through the address', () => {
    expect(board).toContain("withFilter(params, 'status'")
  })
  it('names the ship date in words under the date', () => {
    expect(board).toContain('shipIn(r.exFactory')
  })
})
