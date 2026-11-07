import { describe, expect, it, vi } from 'vitest'
import {
  LIST_PREVIEW, applyFilters, buyersOf, counts, parseFilters, preview, shortDate, withFilter, type BoardRow, type Status,
} from '../src/board/boardLogic'
import { decodeClaims, homeFor, isExpired, signInMessage, storeKind } from '../src/api/sessionRules'
import { getClaims, signIn, signOut } from '../src/api/session'
import { isChunkError, shouldReload } from '../src/ui/chunkReload'
import { savedText, translate } from '../src/i18n'

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

describe('saved message', () => {
  it('says "1 piece", never "1 pieces"', () => {
    expect(savedText('en', 1, false, false)).toBe('Saved 1 piece.')
    expect(savedText('en', 350, true, true)).toBe('Saved 350 pieces with a photo and a note.')
    expect(savedText('en', 0, false, false)).toBe('Saved 0 pieces.')
  })
  it('a Tamil supervisor reads it in Tamil', () => {
    expect(savedText('ta', 1, false, false)).not.toMatch(/Saved|piece/)
    expect(savedText('ta', 5, true, false)).toContain('5')
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
    for (const k of ['rejected', 'locked', 'rate_limited', 'unreachable', 'invalid', 'clock'] as const) {
      expect(signInMessage(k)).not.toMatch(/https?:|localhost|:\d{4}/)
    }
    expect(signInMessage('unreachable')).toMatch(/Cannot reach the server/)
    expect(signInMessage('locked', 'Too many wrong attempts. Try again in 15 minutes.')).toMatch(/15 minutes/)
  })
  // A token already past its expiry by this device's clock used to be dropped on read while
  // signIn still said ok, so the login screen did nothing and showed nothing.
  it('a token that is already expired by the device clock fails sign-in with a plain clock message', async () => {
    const exp = Date.UTC(2026, 10, 4, 16, 30) / 1000
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ token: token({ role: 'merchandiser', exp }), role: 'merchandiser' }), { status: 200 }))
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(exp * 1000 + 60_000)
      const r = await signIn({ email: 'm@example.test', password: 'x' })
      expect(r.ok).toBe(false)
      if (!r.ok) { expect(r.kind).toBe('clock'); expect(r.message).toMatch(/date or time/i) }
      expect(getClaims()).toBeNull()
      vi.setSystemTime(exp * 1000 - 60_000)
      expect((await signIn({ email: 'm@example.test', password: 'x' })).ok).toBe(true)
      expect(getClaims()?.role).toBe('merchandiser')
    } finally {
      signOut(); vi.useRealTimers(); vi.unstubAllGlobals()
    }
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

import { istDate, notWholeNumber, parsePieces, remainingPieces } from '../src/dates'
import { storageWarning, LOW_SPACE_BYTES } from '../src/queue/storageStatus'

describe('the supervisor number field', () => {
  it('accepts whole numbers and ignores what a keyboard might add', () => {
    expect(parsePieces('350')).toBe(350)
    expect(parsePieces(' 1,200 ')).toBe(1200)
    expect(parsePieces('٣٥٠')).toBeNull()      // other digit scripts are not guessed at
    expect(parsePieces('12.5')).toBeNull()      // a fraction of a piece is not a thing
  })
  it.each([[''], ['0'], ['000'], ['abc'], ['-5'], ['12345678'], ['1000001']])('refuses %j', (raw) => {
    expect(parsePieces(raw)).toBeNull()
  })
  it('keeps what was typed and says so when it is not a whole number, rather than sending 125 for "12.5"', () => {
    for (const typed of ['12.5', '-5', '1.5', '12,5x']) {
      expect(parsePieces(typed)).toBeNull()
      expect(notWholeNumber(typed)).toBe(true)
    }
    expect(notWholeNumber('')).toBe(false)        // an empty field is not a mistake yet
    expect(notWholeNumber('1,200')).toBe(false)
    expect(notWholeNumber('350')).toBe(false)
  })
  it('never shows a negative number of pieces left', () => {
    expect(remainingPieces(1000, 400)).toBe(600)
    expect(remainingPieces(1000, 1500)).toBe(0)
  })
})

describe("the supervisor's day is India's date, whatever the phone's time zone says", () => {
  it('rolls over at midnight in India, not in UTC', () => {
    expect(istDate(new Date('2026-11-03T18:00:00Z'))).toBe('2026-11-03')   // 23:30 in India
    expect(istDate(new Date('2026-11-03T18:31:00Z'))).toBe('2026-11-04')   // 00:01 in India
  })
})

describe('storage warnings', () => {
  const ok = { durable: true, persisted: true, usage: 1e6, quota: 1e9 }
  it('says nothing when all is well', () => expect(storageWarning(ok)).toBeNull())
  it('always warns when updates cannot be kept at all, with plain words', () => {
    expect(storageWarning({ ...ok, durable: false })).toMatch(/Do not close the app/)
    expect(storageWarning({ ...ok, durable: false }, 0)).not.toBeNull()
  })
  it('warns about low space even with nothing waiting', () => {
    expect(storageWarning({ ...ok, usage: 1e9 - LOW_SPACE_BYTES + 1 })).toMatch(/almost full/)
    expect(storageWarning({ ...ok, usage: 1e9 - LOW_SPACE_BYTES - 1 })).toBeNull()
  })
  it('asks to add the app to the home screen only when something is waiting to be lost', () => {
    expect(storageWarning({ ...ok, persisted: false }, 0)).toBeNull()
    expect(storageWarning({ ...ok, persisted: false }, 3)).toMatch(/home screen/)
    expect(storageWarning({ ...ok, persisted: null }, 3)).toBeNull()   // unknown: do not guess
  })
  it('the most serious problem wins', () => {
    expect(storageWarning({ durable: false, persisted: false, usage: 1e9, quota: 1e9 }, 5)).toMatch(/Do not close/)
  })
})
