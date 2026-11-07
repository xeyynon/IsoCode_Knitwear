import { describe, expect, it } from 'vitest'
import { BOM, csvCell, csvRow, neutraliseCell, toCsv } from '../src/csv.js'
import { buyerExportCsv, exportFileName, EXPORT_HEADER } from '../src/buyerExport.js'
import type { BuyerView } from '../src/buyerService.js'

describe('formula-injection guard', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '=HYPERLINK("http://x","y")', '\tcmd', '\rcmd'])('puts an apostrophe in front of %j', (text) => {
    expect(neutraliseCell(text)).toBe(`'${text}`)
  })
  it.each(['PO-1', '2026-11-20', 'a=b', 'Sewing is running behind', 'இன்று', '', ' =1'])('leaves %j alone', (text) => {
    expect(neutraliseCell(text)).toBe(text)
  })
  it('is applied to every text cell, even inside quotes', () => {
    expect(csvCell('=2+3')).toBe("'=2+3")
    expect(csvCell('=A1, then "B"')).toBe(`"'=A1, then ""B"""`)
  })
  it('does not treat a real number as a formula', () => {
    expect(csvCell(4550)).toBe('4550')
    expect(csvCell(-5)).toBe('-5')
    expect(csvCell(Number.NaN)).toBe('')
  })
})

describe('cell escaping', () => {
  it('quotes a cell with a comma, a quote or a line break, and doubles inner quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"')
    expect(csvCell('one\r\ntwo')).toBe('"one\r\ntwo"')
  })
  it('leaves plain text unquoted and empties blank', () => {
    expect(csvCell('plain text')).toBe('plain text')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
  it('keeps Tamil as it is', () => {
    expect(csvCell('இன்று மூன்று')).toBe('இன்று மூன்று')
  })
  it('joins cells into a row', () => {
    expect(csvRow(['A', 'b,c', 3, null, '-x'])).toBe(`A,"b,c",3,,'-x`)
  })
})

describe('the file', () => {
  it('starts with the UTF-8 byte order mark so Excel reads Tamil, and ends rows with CRLF', () => {
    const text = toCsv([['a', 'b'], ['c', 'd']])
    expect(text.startsWith(BOM)).toBe(true)
    expect(Buffer.from(text).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(text).toBe(`${BOM}a,b\r\nc,d\r\n`)
  })
})

const order = (over: Partial<BuyerView['orders'][number]> = {}): BuyerView['orders'][number] => ({
  po: 'PO-1', style: 'tee', colour: 'navy', qty: 100, exFactory: '2026-11-20', milestones: [], photos: [], warnings: [], ...over,
})

describe('the buyer file', () => {
  const lines = (v: BuyerView) => buyerExportCsv(v).slice(1).split('\r\n').filter(Boolean)
  it('has one row per stage, with the notice beside its stage', () => {
    const v: BuyerView = { buyer: { name: 'Buyer B' }, orders: [order({
      milestones: [{ stage: 'cutting', plannedEnd: '2026-11-05' }, { stage: 'sewing', plannedEnd: '2026-11-11' }],
      warnings: [{ stage: 'sewing', severity: 'late_risk', text: 'Sewing is behind, adding a shift', since: '2026-11-04T05:00:00Z' }],
    })] }
    expect(lines(v)).toEqual([
      EXPORT_HEADER.join(','),
      'PO-1,tee,navy,100,2026-11-20,Cutting,2026-11-05,',
      'PO-1,tee,navy,100,2026-11-20,Sewing,2026-11-11,"Sewing is behind, adding a shift"',
    ])
  })
  it('still lists an order with no stages, and a notice for a stage with no date', () => {
    const v: BuyerView = { buyer: { name: 'B' }, orders: [
      order({ po: 'A' }),
      order({ po: 'B', warnings: [{ stage: 'packing', severity: 'attention', text: 'Packing may slip', since: '' }] }),
    ] }
    expect(lines(v).slice(1)).toEqual(['A,tee,navy,100,2026-11-20,,,', 'B,tee,navy,100,2026-11-20,Packing,,Packing may slip'])
  })
  it('neutralises a PO, style, colour or notice that starts like a formula', () => {
    const v: BuyerView = { buyer: { name: 'B' }, orders: [order({
      po: '=cmd|x', style: '+SUM(1)', colour: '@x', milestones: [{ stage: 'sewing', plannedEnd: '2026-11-11' }],
      warnings: [{ stage: 'sewing', severity: 'attention', text: '-2+3', since: '' }],
    })] }
    expect(lines(v)[1]).toBe(`'=cmd|x,'+SUM(1),'@x,100,2026-11-20,Sewing,2026-11-11,'-2+3`)
  })
  it('names the file from letters and digits only', () => {
    expect(exportFileName('Buyer B', '2026-11-04')).toBe('orders-buyer-b-2026-11-04.csv')
    expect(exportFileName('Evil"\r\nSet-Cookie: x', '2026-11-04')).toBe('orders-evil-set-cookie-x-2026-11-04.csv')
    expect(exportFileName('தமிழ்', '2026-11-04')).toBe('orders-buyer-2026-11-04.csv')
  })
})
