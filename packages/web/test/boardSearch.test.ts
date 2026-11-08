import { describe, expect, it } from 'vitest'
import {
  SORTS, activeConstraints, parseView, searchRows, sortRows, withQuery, withSort, type BoardRow,
} from '../src/board/boardLogic'

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  orderId: crypto.randomUUID(), po: 'P1', buyerId: 'b1', buyerName: 'Buyer B', style: 's', colour: 'c', exFactory: '2026-11-20',
  status: 'green', worstStage: null, maths: null, shortBy: null, reasons: [], noRecentUpdate: false, hasWarning: false, ...over,
})
const pos = (rows: BoardRow[]) => rows.map((r) => r.po)

describe('board search and sort live in the URL', () => {
  it('reads q and sort, and ignores a sort it does not know', () => {
    expect(parseView(new URLSearchParams('q=po-12&sort=buyer'))).toEqual({ q: 'po-12', sort: 'buyer' })
    expect(parseView(new URLSearchParams('sort=banana'))).toEqual({ q: '', sort: 'status' })
    expect(parseView(new URLSearchParams(''))).toEqual({ q: '', sort: 'status' })
  })
  it('an empty or blank query and the default sort leave no key, so URLs stay short', () => {
    expect(withQuery(new URLSearchParams('q=x'), '').toString()).toBe('')
    expect(withQuery(new URLSearchParams('q=x'), '   ').toString()).toBe('')
    expect(withSort(new URLSearchParams('sort=po'), 'status').toString()).toBe('')
    expect(withSort(new URLSearchParams(), 'exfactory').toString()).toBe('sort=exfactory')
  })
  it('does not disturb the other parameters', () => {
    const p = withQuery(withSort(new URLSearchParams('status=red&buyer=b2'), 'po'), 'knit')
    expect(p.get('status')).toBe('red')
    expect(p.get('buyer')).toBe('b2')
    expect(p.get('sort')).toBe('po')
    expect(p.get('q')).toBe('knit')
  })
  it('lists a sort for every option the screen offers', () => {
    expect(SORTS).toEqual(['status', 'exfactory', 'buyer', 'po'])
  })
})

describe('searching orders', () => {
  const rows = [
    row({ po: 'PO-1001', buyerName: 'Northwind Knits', style: 'Crew Neck' }),
    row({ po: 'PO-2002', buyerName: 'Southgate', style: 'Cardigan' }),
    row({ po: 'ABC/77', buyerName: 'Chennai Exports', style: 'Polo' }),
  ]
  it('an empty query keeps every row, in the same order, as the same array contents', () => {
    expect(searchRows(rows, '')).toEqual(rows)
    expect(searchRows(rows, '   ')).toEqual(rows)
  })
  it('matches PO, buyer and style, ignoring case', () => {
    expect(pos(searchRows(rows, 'po-1001'))).toEqual(['PO-1001'])
    expect(pos(searchRows(rows, 'SOUTH'))).toEqual(['PO-2002'])
    expect(pos(searchRows(rows, 'cArDi'))).toEqual(['PO-2002'])
    expect(pos(searchRows(rows, 'abc/77'))).toEqual(['ABC/77'])
  })
  it('every word must match, in any field and any order', () => {
    expect(pos(searchRows(rows, 'knits crew'))).toEqual(['PO-1001'])
    expect(pos(searchRows(rows, 'crew southgate'))).toEqual([])
    expect(pos(searchRows(rows, '  northwind    po-1001 '))).toEqual(['PO-1001'])
  })
  // FE-M-06 (final bug cycle): the colour is part of how a style is spoken ("men's crew neck tee, navy"), so it is searched. The working is not.
  it('searches the colour, but not the working', () => {
    expect(searchRows([row({ colour: 'Maroon', maths: 'Need 5/day' })], 'maroon')).toHaveLength(1)
    expect(searchRows([row({ colour: 'Maroon', maths: 'Need 5/day' })], 'need')).toEqual([])
  })
  it('finds Tamil and mixed-script text, and treats composed and decomposed forms alike', () => {
    const ta = [row({ po: 'PO-9', buyerName: 'சென்னை Knits' }), row({ po: 'PO-8', buyerName: 'Other' })]
    expect(pos(searchRows(ta, 'சென்னை'))).toEqual(['PO-9'])
    expect(pos(searchRows(ta, 'சென்னை KNITS'))).toEqual(['PO-9'])
    const accented = [row({ po: 'PO-7', buyerName: 'Café Mills' })]
    expect(pos(searchRows(accented, 'café'))).toEqual(['PO-7'])
  })
  it('regular-expression characters in the query are plain text', () => {
    expect(searchRows(rows, '(')).toEqual([])
    expect(searchRows(rows, '.*')).toEqual([])
  })
})

describe('sorting orders', () => {
  const a = row({ po: 'PO-10', buyerName: 'Zed', exFactory: '2026-12-01', status: 'red' })
  const b = row({ po: 'PO-9', buyerName: 'ace', exFactory: '2026-11-05', status: 'amber' })
  const c = row({ po: 'PO-100', buyerName: 'Ace', exFactory: '2026-11-05', status: 'green' })
  const d = row({ po: 'PO-8', buyerName: 'Mid', exFactory: '', status: 'grey' })
  const rows = [a, b, c, d]
  it('the default keeps the order the server gave, which is worst status first', () => {
    expect(sortRows(rows, 'status')).toEqual(rows)
  })
  it('never changes the array it is given', () => {
    const copy = [...rows]
    sortRows(rows, 'po')
    expect(rows).toEqual(copy)
  })
  it('sorts by ex-factory date, soonest first, with a missing date last and ties in the server order', () => {
    expect(pos(sortRows(rows, 'exfactory'))).toEqual(['PO-9', 'PO-100', 'PO-10', 'PO-8'])
  })
  it('sorts by buyer name ignoring case, with ties in the server order', () => {
    expect(pos(sortRows(rows, 'buyer'))).toEqual(['PO-9', 'PO-100', 'PO-8', 'PO-10'])
  })
  it('sorts PO numbers as numbers, so PO-9 comes before PO-10', () => {
    expect(pos(sortRows(rows, 'po'))).toEqual(['PO-8', 'PO-9', 'PO-10', 'PO-100'])
  })
})

describe('what to change when nothing matches', () => {
  it('names each narrowing in use, search first', () => {
    expect(activeConstraints({ q: 'x', status: 'red', buyer: 'b1' })).toEqual(['q', 'status', 'buyer'])
    expect(activeConstraints({ q: '', status: null, buyer: 'b1' })).toEqual(['buyer'])
    expect(activeConstraints({ q: '  ', status: null, buyer: null })).toEqual([])
  })
})
