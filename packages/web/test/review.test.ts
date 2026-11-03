import { describe, expect, it } from 'vitest'
import { buyerLinkUrl, linkStatus, parseDays, readBuyerToken, severityStatus, severityWord } from '../src/review/reviewLogic'

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

describe('what a buyer reads', () => {
  it('has a word and a status mark for each severity, and they differ', () => {
    expect(severityWord('late_risk')).toBe('Late risk')
    expect(severityWord('attention')).toBe('Needs attention')
    expect(severityStatus('late_risk')).toBe('red')
    expect(severityStatus('attention')).toBe('amber')
  })
})

describe('link length', () => {
  it.each([['30', 30], ['1', 1], ['180', 180], [' 7 ', 7]])('accepts %j', (raw, n) => expect(parseDays(raw)).toBe(n))
  it.each([[''], ['0'], ['181'], ['-5'], ['1.5'], ['abc'], ['1000']])('refuses %j', (raw) => expect(parseDays(raw)).toBeNull())
})
