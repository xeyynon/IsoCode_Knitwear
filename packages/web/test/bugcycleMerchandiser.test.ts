import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkVisitEntry } from '../src/orders/visitEntry'
import { exFactoryRule, parseSizes, sizeEntries, validateOrder, MAX_SIZE_ROWS, type OrderForm } from '../src/orders/orderForm'
import { searchRows, type BoardRow } from '../src/board/boardLogic'
import { historyOrder } from '../src/orders/orderDetailLogic'
import { dayBody } from '../src/setup/setupLogic'
import { showAiTag } from '../src/review/noteAiLogic'

// Final bug cycle, merchandiser findings (audit/bugcycle/fm.md). Each test name starts with its finding id.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '')

const ctx = { today: '2026-11-06', stages: ['stitching'], orderId: 'o1', clientUuid: 'u1' }
const entry = (pieces: string) => ({ stage: 'stitching', date: '2026-11-06', pieces, note: '' })

describe('FE-M-02: a merchandiser entry is checked against what is left', () => {
  const withLeft = { ...ctx, left: 5200, stageQty: 12000 }
  it('FE-M-02: more than the whole stage is refused with the numbers in the sentence', () => {
    const c = checkVisitEntry(entry('999999'), withLeft)
    expect(c.ok).toBe(false)
    if (!c.ok) { expect(c.field).toBe('pieces'); expect(c.error).toContain('12,000'); expect(c.confirm).toBeFalsy() }
  })
  it('FE-M-02: more than is left, but not more than the stage, asks first (a plain send-anyway step)', () => {
    const c = checkVisitEntry(entry('6000'), withLeft)
    expect(c.ok).toBe(false)
    if (!c.ok) { expect(c.confirm).toBe(true); expect(c.error).toContain('5,200') }
  })
  it('FE-M-02: once confirmed it goes through, and a count inside what is left never asks', () => {
    expect(checkVisitEntry(entry('6000'), { ...withLeft, confirmed: true }).ok).toBe(true)
    expect(checkVisitEntry(entry('5000'), withLeft).ok).toBe(true)
  })
  it('FE-M-02: a caller that gives no figures behaves as before', () => {
    expect(checkVisitEntry(entry('999999'), ctx).ok).toBe(true)
  })
  it('FE-M-07: zero is refused for the right reason, not "minus signs and decimals"', () => {
    const c = checkVisitEntry(entry('0'), withLeft)
    expect(c.ok).toBe(false)
    if (!c.ok) { expect(c.error).toMatch(/at least 1/i); expect(c.error).not.toMatch(/minus/i) }
  })
  it('FE-M-02: the form asks, and keeps asking only until the numbers change', () => {
    const form = read('../src/ui/VisitEntryForm.tsx')
    expect(form).toContain('confirmed:')
    expect(form).toMatch(/confirm/i)
    expect(read('../src/pages/OrderDetail.tsx')).toMatch(/<VisitEntryForm[\s\S]{0,300}left=/)
  })
})

describe('FE-M-03 and FE-M-08: the ex-factory date has a sane range', () => {
  const today = '2026-11-06'
  it('FE-M-03: more than two years away, or more than a year back, is refused with a reason', () => {
    expect(exFactoryRule('2099-01-01', today)?.kind).toBe('refuse')
    expect(exFactoryRule('1999-01-01', today)?.kind).toBe('refuse')
    expect(exFactoryRule('2028-11-06', today)?.kind).toBe('refuse')   // 731 days
    expect(exFactoryRule('2025-11-05', today)?.kind).toBe('refuse')   // 366 days back
  })
  it('FE-M-03: the edges are allowed', () => {
    expect(exFactoryRule('2028-11-05', today)).toBeNull()   // 730 days ahead
    expect(exFactoryRule('2027-03-01', today)).toBeNull()
  })
  it('FE-M-03: a date that has already passed is allowed only as a confirmed late move', () => {
    const r = exFactoryRule('2026-10-01', today)
    expect(r?.kind).toBe('confirm')
    expect(r?.text).toMatch(/passed|late/i)
    expect(exFactoryRule('2025-11-06', today)?.kind).toBe('confirm')   // exactly 365 days back
  })
  it('FE-M-08: a 1999 date on New order says too far from today, not "not a real date"', () => {
    const f: OrderForm = { buyerId: 'b', po: 'P1', style: 's', colour: 'c', exFactory: '1999-01-01', templateId: 't', rows: [{ id: 1, size: 'S', qty: '10' }] }
    const e = validateOrder(f, today)
    expect(e.exFactory).toMatch(/two years|too far|too early/i)
    expect(e.exFactory).not.toMatch(/real date/)
    expect(validateOrder({ ...f, exFactory: '2026-12-01' }, today).exFactory).toBeUndefined()
    expect(validateOrder({ ...f, exFactory: 'x' }, today).exFactory).toMatch(/real date/)
  })
  it('FE-M-03: the order page confirms the move in a dialog, naming what moves', () => {
    const page = read('../src/pages/OrderDetail.tsx')
    expect(page).toContain('useConfirm')
    expect(page).toContain('exFactoryRule(')
    expect(page).toMatch(/stage date/)
  })
  it('FE-M-03: history rows show the year', () => {
    const page = read('../src/pages/OrderDetail.tsx')
    expect(page).toMatch(/dateWithYear\(h\.from\)/)
    expect(page).toMatch(/dateWithYear\(h\.to\)/)
  })
})

describe('FE-M-04: destructive one-click actions ask first', () => {
  it('FE-M-04: Cancel link on Review asks, and says what it does to a link already shared', () => {
    const src = read('../src/pages/Review.tsx')
    expect(src).toContain('useConfirm')
    expect(src).toMatch(/confirm\(\{[^}]*Cancel this link/)
  })
  it('FE-M-04: Hide from buyer on a confirmed warning asks', () => {
    const src = read('../src/pages/Review.tsx')
    expect(src).toMatch(/action === 'dismiss'[\s\S]{0,400}confirm\(/)
  })
  it('FE-M-04: "Back to normal" on a closed day asks, and says the board will re-count', () => {
    const src = read('../src/setup/DaysTab.tsx')
    expect(src).toContain('useConfirm')
    expect(src).toMatch(/confirm\(\{[^}]*normal week/)
  })
  it('FE-M-04: all three dialogs are the destructive kind (focus starts on Cancel)', () => {
    for (const f of ['../src/pages/Review.tsx', '../src/setup/DaysTab.tsx']) {
      const src = read(f)
      const calls = src.match(/confirm\(\{[^)]*\)/g) ?? []
      expect(calls.length).toBeGreaterThan(0)
    }
    expect(read('../src/setup/DaysTab.tsx')).toMatch(/destructive: true/)
    expect(read('../src/pages/Review.tsx')).toMatch(/destructive: true/)
  })
})

describe('FE-M-05: a merchandiser has no language switch', () => {
  it('FE-M-05: the menu offers the language only to someone who is not a merchandiser', () => {
    const bar = read('../src/ui/AppBar.tsx')
    // (main's wording of the same promise: `canSwitch` is false for a merchandiser, and the switch is drawn only when it is true; finalF4AppBarLang renders it)
    expect(bar).toMatch(/const canSwitch = role !== 'merchandiser'/)
    expect(bar).toMatch(/\{canSwitch && \(\s*<button[\s\S]{0,200}setLang/)
  })
})

describe('FE-M-06: search finds a colour', () => {
  const row = (o: Partial<BoardRow>) => ({ po: 'B-PO-88213', buyerName: 'Company B', style: "Men's crew neck tee", colour: 'Navy', ...o }) as BoardRow
  it('FE-M-06: "navy" and "tee navy" find the order', () => {
    expect(searchRows([row({})], 'navy')).toHaveLength(1)
    expect(searchRows([row({})], 'TEE navy')).toHaveLength(1)
    expect(searchRows([row({})], 'green')).toHaveLength(0)
  })
  it('FE-M-06: the box says it searches colour too', () => {
    expect(read('../src/pages/Board.tsx')).toMatch(/Search PO, buyer, style or colour/)
  })
})

describe('FE-M-07, FE-M-09, FE-M-18: sizes', () => {
  const rows = (...q: [string, string][]) => q.map(([size, qty], i) => ({ id: i, size, qty }))
  it('FE-M-07: "1,000" is a quantity (the way people type it in India), but "1,00" is not', () => {
    expect(parseSizes(rows(['S', '1,000'])).sizes).toEqual({ S: 1000 })
    expect(parseSizes(rows(['S', '1,25,000'])).errors.length).toBe(0)
    expect(parseSizes(rows(['S', '1,00'])).errors.length).toBeGreaterThan(0)
  })
  it('FE-M-18: a size with 0 is "not ordered": it is not stored', () => {
    const p = parseSizes(rows(['S', '0'], ['M', '40']))
    expect(p.sizes).toEqual({ M: 40 })
  })
  it('FE-M-18: the form stops at the number of sizes the server allows', () => {
    expect(MAX_SIZE_ROWS).toBe(30)
    expect(read('../src/pages/OrderSetup.tsx')).toContain('MAX_SIZE_ROWS')
  })
  it('FE-M-09: sizes are listed S M L XL, not in key order; unknown ones keep their order after', () => {
    expect(sizeEntries({ L: 1, M: 2, S: 3, XL: 4 }).map(([s]) => s)).toEqual(['S', 'M', 'L', 'XL'])
    expect(sizeEntries({ XXL: 1, XL: 2, XS: 3 }).map(([s]) => s)).toEqual(['XS', 'XL', 'XXL'])
    expect(sizeEntries({ '36': 1, '32': 2, '34': 3 }).map(([s]) => s)).toEqual(['32', '34', '36'])
    expect(sizeEntries({ Free: 1, S: 2 }).map(([s]) => s)).toEqual(['S', 'Free'])
    expect(read('../src/pages/OrderDetail.tsx')).toContain('sizeEntries(')
  })
})

describe('FE-M-13 and FE-M-14: history and note dates', () => {
  it('FE-M-13: in one change the ex-factory row comes first, then the stages in the order the server sent them', () => {
    const at = '2026-11-06T10:00:00.100Z'
    const h = [
      { at, by: 'a', what: 'Packing finish date', from: null, to: null, reason: '' },
      { at, by: 'a', what: 'Ex-factory date', from: null, to: null, reason: '' },
      { at, by: 'a', what: 'Cutting finish date', from: null, to: null, reason: '' },
      { at: '2026-11-05T09:00:00.000Z', by: 'a', what: 'Cutting finish date', from: null, to: null, reason: '' },
    ]
    expect(historyOrder(h).map((x) => x.what)).toEqual(['Ex-factory date', 'Packing finish date', 'Cutting finish date', 'Cutting finish date'])
  })
  it('FE-M-14: "Notes from the floor" writes the day the way everything else does', () => {
    expect(read('../src/pages/OrderDetail.tsx')).toMatch(/shortDateIn\(n\.takenOn, /)   // the same helper as the rest of the page: the year only when it is not this year
  })
})

describe('FE-M-15: a bad order address is "not found", not a useless Retry', () => {
  it('FE-M-15: the order page says "could not be found", with a way back and no Retry, for a 400 or 404 (finalF4OrderDetail W-11 renders it)', () => {
    const page = read('../src/pages/OrderDetail.tsx')
    expect(page).toContain('This order could not be found.')
    expect(page).toMatch(/status === 404|status === 400/)
  })
})

describe('FE-M-10, FE-M-11, FE-M-19: People and Closed days', () => {
  it('FE-M-10: a name is at most 60 characters in the form, and a long one wraps inside its cell', () => {
    expect(read('../src/ui/organisms/AddPersonForm.tsx')).toMatch(/Field label="Name"><Input[^>]*maxLength=\{60\}/)
    expect(css('../src/styles.css')).toMatch(/\.people td\.people__name\s*\{[^}]*overflow-wrap:\s*anywhere/)   // two classes: a later ".people td" rule must not beat it
    expect(read('../src/setup/PeopleTab.tsx')).toContain('people__name')
  })
  it('FE-M-11: an old error goes away as soon as a field is edited', () => {
    const f = read('../src/ui/organisms/AddPersonForm.tsx')
    expect(f).toMatch(/const set = \(patch[^\n]*setProblem\(null\)/)
  })
  it('FE-M-11: a refusal the server sent (shown by the People tab) also goes when a field is edited', () => {
    expect(read('../src/ui/organisms/AddPersonForm.tsx')).toMatch(/setProblem\(null\); onEdit\?\.\(\)/)
    expect(read('../src/setup/PeopleTab.tsx')).toMatch(/<AddPersonForm[^\n]*onEdit=\{\(\) => setError\(null\)\}/)
  })
  it('FE-M-19: saving a day again with a blank note keeps the note it had', () => {
    expect(dayBody({ unitId: 'u', date: '2026-11-09', working: false, note: '', existing: { note: 'Deepavali' } })).toEqual({ unitId: 'u', date: '2026-11-09', working: false, note: 'Deepavali' })
    expect(dayBody({ unitId: 'u', date: '2026-11-09', working: false, note: 'Power cut', existing: { note: 'Deepavali' } }).note).toBe('Power cut')
    expect(dayBody({ unitId: 'u', date: '2026-11-09', working: false, note: '', existing: undefined }).note).toBe('')
  })
  it('FE-M-19: the confirmation names the year', () => {
    expect(read('../src/setup/DaysTab.tsx')).toMatch(/dateWithYear\(date\)/)
  })
})

describe('FE-M-17 and D-14: wording', () => {
  it('FE-M-17: the file button says what the file is (CSV, which opens in Excel)', () => {
    expect(read('../src/pages/Buyer.tsx')).not.toContain("'Download (Excel)'")
    expect(read('../src/pages/Buyer.tsx')).toMatch(/Download \(CSV, opens in Excel\)/)
    expect(read('../src/pages/Review.tsx')).not.toMatch(/>Download \(Excel\)</)
  })
  it('FE-D-14: the "AI" tag is not repeated when the sentence already starts with "AI"', () => {
    expect(showAiTag('AI is not sure (40%). It might be "Machine problem".')).toBe(false)
    expect(showAiTag('AI suggests "Machine problem" (80% sure).')).toBe(false)
    expect(showAiTag('No suggestion: the AI service had a problem. Choose the reason yourself, or ask again.')).toBe(false)
    expect(showAiTag('Asking AI for a suggestion…')).toBe(false)
    expect(showAiTag('Could not match this note to a reason on the list.')).toBe(true)
    expect(read('../src/pages/Review.tsx')).toContain('showAiTag(line.text)')
  })
})

describe('FE-M-01: the timeline fits its card on a desktop', () => {
  it('FE-M-01: the timeline has the whole width of the page, and the stage cards sit under it', () => {
    const c = css('../src/ui/organisms/OrderBento.css')
    expect(c).toMatch(/"timeline timeline"/)
    expect(c).toMatch(/"stages stages"/)
  })
  it('FE-M-01: a day is drawn 20 px wide at the least, so a five-stage order fits a 1024 px window without scrolling', () => {
    expect(css('../src/styles.css')).toMatch(/\.tlc__grid\s*\{[^}]*var\(--days\)\s*\*\s*20px/)
  })
  it('FE-M-01: when a period is too long to fit, the box is a visible scroll box that starts at the ex-factory end', () => {
    expect(read('../src/ui/StageTimeline.tsx')).toMatch(/scrollLeft/)
  })
})
