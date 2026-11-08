import { describe, expect, it } from 'vitest'
import { afterHide, afterUndo, offersUndo, undoOutcome, type HiddenItem } from '../src/review/undoLogic'
import { ApiError } from '../src/api/session'

// UI/UX plan, slice 4.1 (principle 7, rule 18): "Don't show" on a warning that was still WAITING for review can be undone; "Hide from buyer" on a
// warning that was already CONFIRMED cannot (a buyer may have seen it: showing it again needs a fresh confirmation).
const item = (id: string): HiddenItem => ({ id, po: `PO-${id}`, stage: 'sewing', buyerName: 'Buyer B' })

describe('offersUndo', () => {
  it('offers it for a warning hidden from the waiting list', () => {
    expect(offersUndo('waiting')).toBe(true)
  })
  it('never offers it for a warning that was confirmed', () => {
    expect(offersUndo('confirmed')).toBe(false)
  })
})

describe('afterHide / afterUndo', () => {
  it('keeps the newest hidden item first and each item once', () => {
    const a = afterHide([], item('a'))
    const b = afterHide(a, item('b'))
    expect(b.map((h) => h.id)).toEqual(['b', 'a'])
    expect(afterHide(b, item('a')).map((h) => h.id)).toEqual(['a', 'b'])
  })
  it('removes only the undone item', () => {
    expect(afterUndo([item('b'), item('a')], 'b').map((h) => h.id)).toEqual(['a'])
    expect(afterUndo([item('a')], 'zzz').map((h) => h.id)).toEqual(['a'])
  })
})

describe('undoOutcome: what a refused or failed undo says, in words', () => {
  const refused = (code: string) => new ApiError(409, code, 'server words')
  it('a confirmed warning cannot be brought back: say how to show it again; retrying cannot help', () => {
    const o = undoOutcome(refused('needs_confirmation'))
    expect(o.text).toMatch(/confirm/i)
    expect(o.final).toBe(true)
    expect(o.back).toBe(false)
  })
  it('already back in the list: nothing to undo, the list is reloaded', () => {
    const o = undoOutcome(refused('not_dismissed'))
    expect(o.back).toBe(true)
    expect(o.text.length).toBeGreaterThan(5)
  })
  it('no longer open: it ended on its own; retrying cannot help', () => {
    const o = undoOutcome(refused('not_open'))
    expect(o.text).toMatch(/no longer/i)
    expect(o.final).toBe(true)
  })
  it('anything else (a network failure, a server error) can be tried again', () => {
    for (const e of [new Error('Failed to fetch'), new ApiError(500, 'server_error', 'x')]) {
      const o = undoOutcome(e)
      expect(o.final).toBe(false)
      expect(o.back).toBe(false)
      expect(o.text).toMatch(/try again/i)
    }
  })
})
