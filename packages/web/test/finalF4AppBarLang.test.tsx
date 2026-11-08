// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { languageAfterSignIn, parseStoredLang } from '../src/langRules'

// Final cycle W-4: the language switch is for supervisors. A merchandiser's screens are English only, so the switch is not offered to them,
// <html lang> says "en" on them, and a Tamil left in this phone's storage by a supervisor is ignored (and left for the supervisor).
const session = vi.hoisted(() => ({ role: 'merchandiser' as 'merchandiser' | 'supervisor' }))
vi.mock('../src/api/session', async (orig) => ({
  ...(await orig<typeof import('../src/api/session')>()),
  getClaims: () => ({ sub: 'u1', role: session.role }),
  apiFetch: () => Promise.resolve({}),
}))
import { AppBar } from '../src/ui/AppBar'
import { applySignInLanguage, getLang, setLang } from '../src/i18n'

beforeEach(() => { window.localStorage.clear(); setLang('en'); window.localStorage.clear() })
afterEach(cleanup)

const openMenu = (role: 'merchandiser' | 'supervisor') => {
  session.role = role
  render(<MemoryRouter><AppBar title="Board" /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: /Menu|மெனு/ }))
  return screen.getAllByRole('menuitem').map((i) => i.textContent)
}

describe('W-4: the language switch', () => {
  it('W-4: a merchandiser is not offered it', () => {
    const items = openMenu('merchandiser')
    expect(items).not.toContain('தமிழ்')
    expect(items).toContain('Sign out')
  })
  it('W-4: a supervisor still is', () => {
    expect(openMenu('supervisor')).toContain('தமிழ்')
  })
})

describe('W-4: a merchandiser is always in English', () => {
  it('W-4: the rule says English whatever was stored', () => {
    expect(languageAfterSignIn('merchandiser', parseStoredLang('ta', null)).lang).toBe('en')
    expect(languageAfterSignIn('merchandiser', parseStoredLang('ta', 'default')).lang).toBe('en')
  })
  it('W-4: a stored Tamil is ignored, <html lang> is en, and the supervisor\'s choice is left in storage', () => {
    setLang('ta')
    expect(document.documentElement.lang).toBe('ta')
    applySignInLanguage('merchandiser')
    expect(getLang()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(window.localStorage.getItem('orders.lang')).toBe('ta')
  })
})
