import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { translate } from '../src/i18n'

// Final bug cycle (9 Nov 2026): FE-S-07. Signing out with updates still on the phone asks first, and the sign-in screen says they are waiting.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const appbar = read('../src/ui/AppBar.tsx')
const login = read('../src/pages/Login.tsx')
const i18n = read('../src/i18n.ts')
const review = read('../../../audit/TAMIL-REVIEW.md')
const KEYS = ['nav.signOutWaitingTitle', 'nav.signOutWaiting', 'nav.signOutStay', 'login.waiting'] as const

describe('FE-S-07: sign-out and sign-in with updates waiting', () => {
  it('FE-S-07: signing out with updates waiting asks first, in the person\'s language, and a supervisor only', () => {
    expect(appbar).toContain('useQueue()')
    expect(appbar).toMatch(/!merchandiser && waiting > 0/)
    for (const k of ['nav.signOutWaitingTitle', 'nav.signOutWaiting', 'nav.signOutStay']) expect(appbar).toContain(`t('${k}'`)
  })
  it('FE-S-07: signing out with nothing waiting is still one tap', () => {
    expect(appbar).toMatch(/waiting > 0 && !\(await confirm/)
  })
  it('FE-S-07: the sign-in screen says how many updates wait on this phone', () => {
    expect(login).toContain('useQueue()')
    expect(login).toMatch(/pending > 0/)
    expect(login).toContain("t('login.waiting'")
  })
  it.each(KEYS)('FE-S-07: %s has Tamil, marked as a draft and listed for review', (key) => {
    expect(translate('ta', key, { n: 2 })).toMatch(/[஀-௿]/)
    expect(i18n).toMatch(new RegExp(`'${key.replace('.', '\.')}':[^\n]*DRAFT, unreviewed`))
    expect(review).toContain(`\`${key}\``)
  })
})
