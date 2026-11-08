// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import type { ReactElement } from 'react'
import { SupervisorShell } from '../src/ui/templates/SupervisorShell'
import { MerchandiserShell } from '../src/ui/templates/MerchandiserShell'
import { AuthShell } from '../src/ui/templates/AuthShell'
import { PublicShell } from '../src/ui/templates/PublicShell'
import { setLang, strings, translate } from '../src/i18n'

// AUDIT-03, findings 16 and 17: no skip link (the board has seven stops before its tiles) and an unknown address that silently lands on the board.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const mount = (el: ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>).container

afterEach(cleanup)

describe('the skip link', () => {
  const shells: [string, ReactElement][] = [
    ['SupervisorShell', <SupervisorShell title="T">body</SupervisorShell>],
    ['MerchandiserShell', <MerchandiserShell title="T">body</MerchandiserShell>],
    ['AuthShell', <AuthShell>body</AuthShell>],
    ['PublicShell', <PublicShell>body</PublicShell>],
  ]
  it.each(shells)('%s: the first thing in the page is a link to main, and main can take focus', (_name, el) => {
    const c = mount(el)
    const first = c.querySelector('a, button, input, select, textarea, [tabindex]') as HTMLElement
    expect(first.className).toContain('skiplink')
    expect(first.getAttribute('href')).toBe('#main')
    const main = c.querySelector('main')!
    expect(main.id).toBe('main')
    expect(main.getAttribute('tabindex')).toBe('-1')
  })
  it('following it puts the focus on main (a bare #main would only scroll)', () => {
    const c = mount(<MerchandiserShell title="T">body</MerchandiserShell>)
    fireEvent.click(c.querySelector('a.skiplink')!)
    expect(document.activeElement).toBe(c.querySelector('main'))
  })
  it('is hidden until it has the keyboard, then drawn on top with a visible edge', () => {
    const css = read('../src/ui/atoms/SkipLink.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.skiplink\s*\{[^}]*position:\s*absolute/)
    expect(css).toMatch(/\.skiplink:focus[^{]*\{[^}]*z-index/)
    expect(css).not.toMatch(/display:\s*none|visibility:\s*hidden/)   // either would take it out of the tab order
  })
  it('says it in the supervisor\'s language, with draft Tamil', () => {
    expect(strings.en['common.skip']).toBe('Skip to main content')
    expect(strings.ta['common.skip']).toBeTruthy()
    expect(read('../../../audit/TAMIL-REVIEW.md')).toContain('`common.skip`')
  })
})

describe('an address that does not exist', () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock('../src/api/session') })
  it('is not sent silently to the home screen: the catch-all route is the NotFound page', () => {
    const app = read('../src/App.tsx')
    expect(app).toMatch(/<Route path="\*" element=\{<NotFound \/>\} \/>/)
    expect(app).not.toMatch(/<Route path="\*" element=\{<Home \/>\} \/>/)
  })
  it('has Tamil for what a supervisor can read (draft, in the review list)', () => {
    for (const k of ['err.notFoundTitle', 'err.notFound', 'err.notFoundBack'] as const) {
      expect(strings.en[k], k).toBeTruthy()
      expect(strings.ta[k], k).toBeTruthy()
    }
    expect(translate('en', 'err.notFound')).toBe('That page does not exist.')
    const review = read('../../../audit/TAMIL-REVIEW.md')
    for (const k of ['err.notFoundTitle', 'err.notFound', 'err.notFoundBack']) expect(review).toContain('`' + k + '`')
  })
  async function page(role: 'supervisor' | 'merchandiser' | null, lang: 'en' | 'ta' = 'en') {
    vi.resetModules()
    vi.doMock('../src/api/session', async (orig) => ({ ...(await orig<typeof import('../src/api/session')>()), getClaims: () => (role ? { role, sub: 'x', exp: 0 } : null), snapshot: () => 0, subscribe: () => () => {} }))
    const { default: NotFound } = await import('../src/pages/NotFound')
    const i18n = await import('../src/i18n')
    act(() => i18n.setLang(lang))
    return mount(<NotFound />)
  }
  it('a merchandiser gets a plain sentence and a way back to the board, in English', async () => {
    const c = await page('merchandiser')
    expect(c.querySelector('h1, p.appbar__title')!.textContent).toContain('Page not found')
    expect(c.textContent).toContain('That page does not exist.')
    expect((c.querySelector('main a.btn') as HTMLAnchorElement).getAttribute('href')).toBe('/board')
  })
  it('a supervisor gets it in Tamil with a way back to Today', async () => {
    const c = await page('supervisor', 'ta')
    expect(c.textContent).toContain(strings.ta['err.notFound'])
    expect((c.querySelector('main a.btn') as HTMLAnchorElement).getAttribute('href')).toBe('/today')
    act(() => setLang('en'))
  })
  it('someone not signed in gets a way to the sign-in, and no app bar', async () => {
    const c = await page(null)
    expect(c.querySelector('header.appbar')).toBeNull()
    expect((c.querySelector('main a.btn') as HTMLAnchorElement).getAttribute('href')).toBe('/login')
  })
})
