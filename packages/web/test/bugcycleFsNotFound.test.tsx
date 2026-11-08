// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NotFound from '../src/pages/NotFound'
import { setLang, translate } from '../src/i18n'

// Final bug cycle (9 Nov 2026): FE-S-08. A signed-out visitor who chose Tamil on the sign-in screen got an English not-found page.
afterEach(() => { cleanup(); setLang('en') })

describe('FE-S-08: the not-found page for someone not signed in follows the chosen language', () => {
  it('FE-S-08: in Tamil it uses the existing Tamil words and says "sign in" in Tamil', () => {
    setLang('ta')
    const c = render(<MemoryRouter><NotFound /></MemoryRouter>).container
    const text = c.textContent ?? ''
    expect(text).toContain(translate('ta', 'err.notFoundTitle'))
    expect(text).toContain(translate('ta', 'err.notFound'))
    expect(text).toContain(translate('ta', 'login.title'))
    expect(text).not.toContain('Page not found')
    expect(text).not.toContain('Go to sign in')
  })
  it('FE-S-08: in English it still reads as before', () => {
    setLang('en')
    const text = render(<MemoryRouter><NotFound /></MemoryRouter>).container.textContent ?? ''
    expect(text).toContain('Page not found')
    expect(text).toContain('That page does not exist.')
  })
})
