import { describe, expect, it } from 'vitest'
import { checkVisitEntry, lowConfidenceText, LOW_CONFIDENCE, visitEntryDone, type VisitEntryForm } from '../src/orders/visitEntry'

const today = '2026-11-04'
const id = '11111111-1111-4111-8111-111111111111'
const form = (over: Partial<VisitEntryForm> = {}): VisitEntryForm => ({ stage: 'sewing', date: today, pieces: '300', note: '', ...over })
const stages = ['cutting', 'sewing']
const check = (over: Partial<VisitEntryForm> = {}) => checkVisitEntry(form(over), { today, stages, orderId: 'o1', clientUuid: id })

describe('a merchandiser enters a stage on a visit', () => {
  it('builds the same update a phone would send', () => {
    expect(check()).toEqual({ ok: true, body: { clientUuid: id, orderId: 'o1', stage: 'sewing', date: today, qty: 300 } })
  })
  it('accepts spaces and thousands commas like the supervisor field', () => {
    expect(check({ pieces: '1,200' })).toMatchObject({ ok: true, body: { qty: 1200 } })
  })
  it('refuses "-5" instead of turning it into 5', () => {
    expect(check({ pieces: '-5' })).toMatchObject({ ok: false, field: 'pieces' })
  })
  it('refuses letters, decimals, zero and nothing', () => {
    for (const pieces of ['abc', '3.5', '0', '', '  ', '12 pcs']) expect(check({ pieces })).toMatchObject({ ok: false, field: 'pieces' })
  })
  it('says what is wrong in words, not a code', () => {
    expect(check({ pieces: '-5' })).toMatchObject({ error: expect.stringMatching(/whole number/) })
    expect(check({ pieces: '' })).toMatchObject({ error: expect.stringMatching(/how many pieces/i) })
  })
  it('needs a stage that the order has', () => {
    expect(check({ stage: '' })).toMatchObject({ ok: false, field: 'stage' })
    expect(check({ stage: 'embroidery' })).toMatchObject({ ok: false, field: 'stage' })
  })
  it('needs a real date, not in the future', () => {
    expect(check({ date: '' })).toMatchObject({ ok: false, field: 'date' })
    expect(check({ date: '2026-02-30' })).toMatchObject({ ok: false, field: 'date' })
    expect(check({ date: '2026-11-05' })).toMatchObject({ ok: false, field: 'date', error: expect.stringMatching(/not come yet/) })
    expect(check({ date: '2026-11-03' })).toMatchObject({ ok: true })
  })
  it('sends a note only when something was typed, tidied and kept to the limit', () => {
    expect(check({ note: '   ' })).not.toHaveProperty('body.note')
    expect(check({ note: '  Counted  by   hand ' })).toMatchObject({ body: { note: { text: 'Counted by hand' } } })
    const long = check({ note: 'x'.repeat(900) })
    expect(long).toMatchObject({ ok: true })
    if (long.ok) expect(long.body.note?.text).toHaveLength(500)
  })
  it('checks the first problem in the order the form reads: stage, date, pieces', () => {
    expect(check({ stage: '', date: '', pieces: '' })).toMatchObject({ field: 'stage' })
    expect(check({ date: '', pieces: '' })).toMatchObject({ field: 'date' })
  })
})

describe('the words for a visit entry', () => {
  it('names the flag in words, so colour is never the only signal', () => {
    expect(LOW_CONFIDENCE).toBe('Entered by a merchandiser, low confidence')
  })
  it('the board names which stages', () => {
    expect(lowConfidenceText(['sewing'])).toBe('Sewing: entered by a merchandiser, low confidence')
    expect(lowConfidenceText(['cutting', 'sewing'])).toBe('Cutting and sewing: entered by a merchandiser, low confidence')
    expect(lowConfidenceText(['a', 'b', 'c'])).toBe('A, b and c: entered by a merchandiser, low confidence')
  })
  it('says nothing when there is nothing to say (an older server sends no list)', () => {
    expect(lowConfidenceText([])).toBeNull()
    expect(lowConfidenceText(undefined)).toBeNull()
  })
  it('confirms what was added and that it will be marked', () => {
    expect(visitEntryDone('sewing', 300, '2026-11-04')).toBe('Added 300 pieces to Sewing for 4 Nov. It is marked as entered by a merchandiser.')
    expect(visitEntryDone('cutting', 1, '2026-11-03')).toBe('Added 1 piece to Cutting for 3 Nov. It is marked as entered by a merchandiser.')
  })
})
