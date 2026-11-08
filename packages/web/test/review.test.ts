import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { activeLinkCount, afterRevoke, buyerLinkUrl, emptyLine, linkStatus, offersNoReason, parseDays, readBuyerToken, reviewSummary, sectionAnchor, sectionTitle, severityStatus, severityWord, type ReviewCounts, type ReviewSectionId } from '../src/review/reviewLogic'

describe('buyer link addresses', () => {
  it('puts the token after a # so it never reaches a server or a Referer header', () => {
    const url = buyerLinkUrl('https://app.example.com/', 'bl_abcdefghijklmnopqrstuvwxyz012345')
    expect(url).toBe('https://app.example.com/buyer#bl_abcdefghijklmnopqrstuvwxyz012345')
    expect(url.split('#')[0]).not.toContain('bl_')       // nothing secret before the hash
  })
  it('reads a token back, with or without the #', () => {
    const t = 'bl_abcdefghijklmnopqrstuvwxyz012345'
    expect(readBuyerToken('#' + t)).toBe(t)
    expect(readBuyerToken(t)).toBe(t)
  })
  it.each([[''], ['#'], ['#nope'], ['#bl_short'], ['#xx_abcdefghijklmnopqrstuvwxyz012345'], ['#bl_has space abcdefghijklmnopqrstuvw'], ['#bl_' + 'a'.repeat(500)]])('ignores %j', (h) => {
    expect(readBuyerToken(h)).toBeNull()
  })
})

describe('link status', () => {
  it('says plainly whether a link works', () => {
    expect(linkStatus({ revoked: false, expired: false, expiresAt: '2026-12-04T00:00:00Z' })).toEqual({ text: 'Works until 4 Dec', active: true })
    expect(linkStatus({ revoked: false, expired: true, expiresAt: '2026-11-01T00:00:00Z' })).toEqual({ text: 'Expired', active: false })
  })
  it('a cancelled link is cancelled even if it has also expired', () => {
    expect(linkStatus({ revoked: true, expired: true, expiresAt: '2026-11-01T00:00:00Z' }).text).toBe('Cancelled')
  })
})

describe('cancelling a link', () => {
  const made = { id: 'l1', url: 'https://app.example.com/buyer#bl_abcdefghijklmnopqrstuvwxyz012345', copied: false }
  it('stops offering the just-made link for copying once that link is cancelled, and says so', () => {
    expect(afterRevoke(made, 'l1')).toEqual({ made: null, announce: 'Link cancelled. It no longer works.' })
  })
  it('keeps the copy box when a different link is cancelled', () => {
    expect(afterRevoke(made, 'l2')).toEqual({ made, announce: 'Link cancelled. It no longer works.' })
    expect(afterRevoke(null, 'l2').made).toBeNull()
  })
})

describe('what a buyer reads', () => {
  it('has a word and a status mark for each severity, and they differ', () => {
    expect(severityWord('late_risk')).toBe('Late risk')
    expect(severityWord('attention')).toBe('Needs attention')
    expect(severityStatus('late_risk')).toBe('red')
    expect(severityStatus('attention')).toBe('amber')
  })
})

describe('reason on a note', () => {
  it('offers "No reason chosen" only while the note has no reason', () => {
    expect(offersNoReason(null)).toBe(true)
    expect(offersNoReason('')).toBe(true)
  })
  it('does not offer it once the supervisor chose one: the server cannot clear a reason, so the choice would be lost', () => {
    expect(offersNoReason('machine')).toBe(false)
  })
})

describe('link length', () => {
  it.each([['30', 30], ['1', 1], ['180', 180], [' 7 ', 7]])('accepts %j', (raw, n) => expect(parseDays(raw)).toBe(n))
  it.each([[''], ['0'], ['181'], ['-5'], ['1.5'], ['abc'], ['1000']])('refuses %j', (raw) => expect(parseDays(raw)).toBeNull())
})

describe('focus after a review action', () => {
  // The card that had focus is gone after an action. Focus (and so the scroll) goes to the heading
  // of the section the button was in, not always the first one at the top of a long page.
  const src = readFileSync(new URL('../src/pages/Review.tsx', import.meta.url), 'utf8')
  const sections = src.split('<h2').slice(1).map((s) => '<h2' + s)
  const acting = sections.filter((s) => /void (decide|reviewNote|decidePhoto)\(/.test(s))
  it('finds every section with an action', () => expect(acting.length).toBe(5))
  it.each(acting.map((s) => [s.slice(0, s.indexOf('</h2>') + 5), s]))('%s focuses its own heading', (_h, s) => {
    const ref = /^<h2 id=\{sectionAnchor\('\w+'\)\} tabIndex=\{-1\} ref=\{(\w+)\}>/.exec(s)?.[1]
    expect(ref).toBeTruthy()
    const calls = [...s.matchAll(/void (?:decide|reviewNote|decidePhoto)\(([^)]*)\)/g)].map((m) => m[1] ?? '')
    for (const args of calls) expect(args.trim().endsWith(`, ${ref}`)).toBe(true)
  })
  it('handlers focus the heading they are given', () => {
    expect(src).not.toMatch(/pendingHeading\.current\?\.focus/)
  })
})

describe('the summary bar', () => {
  const counts: ReviewCounts = { warnings: 3, notes: 0, photos: 2, approved: 1, confirmed: 4, activeLinks: 1 }
  it('lists the five sections in page order, each with its count', () => {
    expect(reviewSummary(counts).map((i) => [i.key, i.count])).toEqual([['warnings', 3], ['notes', 0], ['photos', 2], ['visible', 5], ['links', 1]])
  })
  it('counts visible items as approved photos plus confirmed warnings, and jumps to the first of them that has something', () => {
    const visible = (c: ReviewCounts) => reviewSummary(c).find((i) => i.key === 'visible')!
    expect(visible(counts).target).toBe('approved')
    expect(visible({ ...counts, approved: 0 }).target).toBe('confirmed')
    expect(visible({ ...counts, approved: 0, confirmed: 0 })).toMatchObject({ count: 0, target: 'approved' })
  })
  it('points every item at an anchor that exists in the page', () => {
    const src = readFileSync(new URL('../src/pages/Review.tsx', import.meta.url), 'utf8')
    const ids = ['warnings', 'notes', 'photos', 'approved', 'confirmed', 'links'] as ReviewSectionId[]
    expect(new Set(ids.map(sectionAnchor)).size).toBe(6)
    for (const id of ids) expect(src).toContain(`id={sectionAnchor('${id}')}`)
  })
  it('moves focus to the section heading when a jump link is used', () => {
    const src = readFileSync(new URL('../src/pages/Review.tsx', import.meta.url), 'utf8')
    const jump = src.slice(src.indexOf('function jump('), src.indexOf('async function makeLink'))
    expect(jump).toMatch(/h\.focus\(/)
    expect(jump).toMatch(/preventDefault\(\)/)
    expect(src).toMatch(/onClick=\{\(e\) => jump\(e, i\.target\)\}/)
    expect(src).toMatch(/href=\{`#\$\{sectionAnchor\(i\.target\)\}`\}/)
  })
  it('puts the count in the heading, and an empty section says when items appear', () => {
    expect(sectionTitle('Notes from the floor', 0)).toBe('Notes from the floor (0)')
    expect(sectionTitle('Buyer links', 2, 'working')).toBe('Buyer links (2 working)')
    for (const id of ['warnings', 'notes', 'photos', 'approved', 'confirmed', 'links'] as ReviewSectionId[]) expect(emptyLine(id).length).toBeGreaterThan(20)
    expect(emptyLine('warnings')).toMatch(/appear/)
  })
  it('counts a link as active only while it works', () => {
    const l = (revoked: boolean, expired: boolean) => ({ revoked, expired, expiresAt: '2026-12-04T00:00:00Z' })
    expect(activeLinkCount([l(false, false), l(true, false), l(false, true), l(false, false)])).toBe(2)
    expect(activeLinkCount([])).toBe(0)
  })
})

describe('a double click on Make link', () => {
  // A token is shown once and only its hash is kept. A second POST while the first is still
  // running would leave an active link whose address nobody ever saw.
  const src = readFileSync(new URL('../src/pages/Review.tsx', import.meta.url), 'utf8')
  const makeLink = src.slice(src.indexOf('async function makeLink'), src.indexOf('async function copy'))
  it('sends the request only once at a time, even two clicks in the same tick', () => {
    expect(makeLink).toMatch(/oneAtATime\(making,/)
    expect(makeLink.indexOf('oneAtATime(')).toBeLessThan(makeLink.indexOf("'/api/buyer-links'"))
  })
  it('disables the button while the link is being made', () => {
    // Same promise through the atom: the filled Button, disabled while `busy === 'link'` (atoms.test.tsx: `variant="primary"` draws `btn btn--primary`).
    expect(src).toMatch(/<Button variant="primary" disabled=\{busy === 'link'\}>Make link<\/Button>/)
  })
})
