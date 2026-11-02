import { describe, expect, it } from 'vitest'
import {
  LIST_PREVIEW, applyFilters, buyersOf, counts, parseFilters, preview, shortDate, withFilter, type BoardRow, type Status,
} from '../src/board/boardLogic'
import { decodeClaims, homeFor, isExpired, signInMessage, storeKind } from '../src/api/sessionRules'
import { isChunkError, shouldReload } from '../src/ui/chunkReload'
import { translate } from '../src/i18n'

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  orderId: crypto.randomUUID(), po: 'P', buyerId: 'b1', buyerName: 'Buyer B', style: 's', colour: 'c', exFactory: '2026-11-20',
  status: 'green', worstStage: null, maths: null, shortBy: null, reasons: [], noRecentUpdate: false, hasWarning: false, ...over,
})
const many = (n: number, status: Status = 'green') => Array.from({ length: n }, () => row({ status }))

describe('board filters live in the URL', () => {
  it('reads a valid status and buyer, ignores junk', () => {
    expect(parseFilters(new URLSearchParams('status=red&buyer=b2'))).toEqual({ status: 'red', buyer: 'b2' })
    expect(parseFilters(new URLSearchParams('status=purple'))).toEqual({ status: null, buyer: null })
    expect(parseFilters(new URLSearchParams(''))).toEqual({ status: null, buyer: null })
  })
  it('choosing the active filter again clears it, and a cleared filter leaves no key', () => {
    const on = withFilter(new URLSearchParams(), 'status', 'red')
    expect(on.toString()).toBe('status=red')
    expect(withFilter(on, 'status', 'red').toString()).toBe('')
    expect(withFilter(on, 'status', null).toString()).toBe('')
    expect(withFilter(on, 'status', 'amber').toString()).toBe('status=amber')
  })
  it('does not disturb the other filter', () => {
    const p = withFilter(new URLSearchParams('buyer=b1'), 'status', 'red')
    expect(parseFilters(p)).toEqual({ status: 'red', buyer: 'b1' })
  })
  it('filters by status and buyer together', () => {
    const rows = [row({ status: 'red', buyerId: 'b1' }), row({ status: 'red', buyerId: 'b2' }), row({ status: 'green', buyerId: 'b1' })]
    expect(applyFilters(rows, { status: 'red', buyer: 'b1' })).toHaveLength(1)
    expect(applyFilters(rows, { status: null, buyer: 'b1' })).toHaveLength(2)
    expect(applyFilters(rows, { status: null, buyer: null })).toHaveLength(3)
  })
})

describe('counts', () => {
  const rows = [row({ status: 'red', buyerId: 'b1' }), row({ status: 'red', buyerId: 'b2' }), row({ status: 'amber', buyerId: 'b1' }), row({ status: 'grey', buyerId: 'b1' })]
  it('counts every status', () => {
    expect(counts(rows, { status: null, buyer: null })).toEqual({ red: 2, amber: 1, grey: 1, green: 0, total: 4 })
  })
  it('ignores the status filter, so each count stays a working button', () => {
    expect(counts(rows, { status: 'red', buyer: null }).amber).toBe(1)
  })
  it('respects the buyer filter', () => {
    expect(counts(rows, { status: null, buyer: 'b1' })).toEqual({ red: 1, amber: 1, grey: 1, green: 0, total: 3 })
  })
  it('lists buyers once, sorted', () => {
    expect(buyersOf([row({ buyerId: 'b2', buyerName: 'Zed' }), row({ buyerId: 'b1', buyerName: 'Ace' }), row({ buyerId: 'b2', buyerName: 'Zed' })]).map((b) => b.name)).toEqual(['Ace', 'Zed'])
  })
})

describe('the preview states its cap and never cuts silently', () => {
  it('shows everything at or under the cap', () => {
    expect(preview(many(LIST_PREVIEW), false)).toMatchObject({ capped: false })
    expect(preview(many(LIST_PREVIEW), false).shown).toHaveLength(LIST_PREVIEW)
  })
  it('caps above it, in the given order, and Show all lifts it', () => {
    const rows = many(LIST_PREVIEW + 10)
    const p = preview(rows, false)
    expect(p.capped).toBe(true)
    expect(p.shown).toHaveLength(LIST_PREVIEW)
    expect(p.shown[0]).toBe(rows[0])
    expect(preview(rows, true)).toMatchObject({ capped: false })
    expect(preview(rows, true).shown).toHaveLength(LIST_PREVIEW + 10)
  })
})

describe('dates', () => {
  it('formats date-only strings with no time zone involved', () => {
    expect(shortDate('2026-11-20')).toBe('20 Nov')
    expect(shortDate('2026-01-05')).toBe('5 Jan')
    expect(shortDate('')).toBe('-')
    expect(shortDate('20/11/2026')).toBe('-')
  })
})

describe('status words', () => {
  it('Tamil has its own word for every status, English is the fallback', () => {
    for (const s of ['red', 'amber', 'green', 'grey'] as const) {
      expect(translate('ta', `status.${s}`)).not.toBe(translate('en', `status.${s}`))
    }
    // not translated yet: shown in English, never a guessed Tamil label
    expect(translate('ta', 'board.title')).toBe('Order board')
  })
  it('the four English words are all different (a status is never ambiguous)', () => {
    const words = (['red', 'amber', 'green', 'grey'] as const).map((s) => translate('en', `status.${s}`))
    expect(new Set(words).size).toBe(4)
  })
})

describe('session rules', () => {
  const token = (c: object) => `${Buffer.from(JSON.stringify(c)).toString('base64url')}.sig`
  it('reads the role and expiry from a token', () => {
    expect(decodeClaims(token({ role: 'supervisor', exp: 100, unitId: 'u' }))).toEqual({ role: 'supervisor', exp: 100 })
  })
  it.each([[null], [undefined], [''], ['garbage'], [token({ role: 'admin', exp: 1 })], [token({ role: 'merchandiser' })], ['!!!.sig']])('rejects %j', (t) => {
    expect(decodeClaims(t as string)).toBeNull()
  })
  it('expiry', () => {
    expect(isExpired({ role: 'merchandiser', exp: 100 }, 99_999)).toBe(false)
    expect(isExpired({ role: 'merchandiser', exp: 100 }, 100_000)).toBe(true)
  })
  it('supervisors stay signed in on their phone; merchandisers end with the tab', () => {
    expect(storeKind('supervisor')).toBe('local')
    expect(storeKind('merchandiser')).toBe('session')
  })
  it('sends each role to its own home', () => {
    expect(homeFor('merchandiser')).toBe('/board')
    expect(homeFor('supervisor')).toBe('/today')
  })
  it('sign-in messages are plain and never contain an address', () => {
    for (const k of ['rejected', 'locked', 'rate_limited', 'unreachable', 'invalid'] as const) {
      expect(signInMessage(k)).not.toMatch(/https?:|localhost|:\d{4}/)
    }
    expect(signInMessage('unreachable')).toMatch(/Cannot reach the server/)
    expect(signInMessage('locked', 'Too many wrong attempts. Try again in 15 minutes.')).toMatch(/15 minutes/)
  })
})

describe('reloading after a deploy', () => {
  it('reloads once, then not again within a minute (no loop)', () => {
    expect(shouldReload(null, 1_000)).toBe(true)
    expect(shouldReload(1_000, 30_000)).toBe(false)
    expect(shouldReload(1_000, 61_001)).toBe(true)
  })
  it('recognises a missing chunk across browsers, and nothing else', () => {
    expect(isChunkError(new Error('Failed to fetch dynamically imported module: /assets/Board-abc.js'))).toBe(true)
    expect(isChunkError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isChunkError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkError(new TypeError('x is not a function'))).toBe(false)
  })
})
