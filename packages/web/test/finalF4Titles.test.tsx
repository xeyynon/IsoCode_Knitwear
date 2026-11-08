// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Final cycle W-8: every screen sets the browser tab's title from its own heading ("Board | Order tracking"), in the language on screen, so history,
// tabs and a screen reader's page announcement say where the person is. The API never answers here: the title is there from the first paint.
const who = vi.hoisted(() => ({ role: 'merchandiser' as 'merchandiser' | 'supervisor' | null }))
vi.mock('../src/api/session', async (orig) => ({
  ...(await orig<typeof import('../src/api/session')>()),
  getClaims: () => (who.role ? { sub: 'u1', role: who.role } : null),
  getToken: () => (who.role ? 't' : null),
  apiFetch: () => new Promise(() => {}),
}))
import { setLang } from '../src/i18n'
import Board from '../src/pages/Board'
import Buyer from '../src/pages/Buyer'
import Login from '../src/pages/Login'
import NotFound from '../src/pages/NotFound'
import OrderDetail from '../src/pages/OrderDetail'
import OrderSetup from '../src/pages/OrderSetup'
import Review from '../src/pages/Review'
import Setup from '../src/pages/Setup'
import Status from '../src/pages/Status'
import Today from '../src/pages/Today'

beforeEach(() => {
  who.role = 'merchandiser'; setLang('en'); document.title = ''
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  window.history.replaceState(null, '', '/')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const at = (path: string, ui: ReactElement) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="*" element={ui} /></Routes></MemoryRouter>)
const title = () => document.title

describe('W-8: the tab title follows the screen', () => {
  it.each([
    ['the board', '/board', <Board />, 'Order board | Order tracking'],
    ['a new order', '/orders/new', <OrderSetup />, 'New order | Order tracking'],
    ['review', '/review', <Review />, 'Review | Order tracking'],
    ['setup', '/setup', <Setup />, 'Setup | Order tracking'],
    ['an order, while it loads', '/orders/abc', <OrderDetail />, 'Order | Order tracking'],
    ['a page that does not exist (merchandiser)', '/nope', <NotFound />, 'Page not found | Order tracking'],
  ] as [string, string, ReactElement, string][])('W-8: %s', async (_n, path, ui, expected) => {
    at(path, ui)
    await waitFor(() => expect(title()).toBe(expected))
  })

  it('W-8: the supervisor screens say it in the language on screen', async () => {
    who.role = 'supervisor'; setLang('ta')
    at('/today', <Today />)
    await waitFor(() => expect(title()).toMatch(/ \| ஆர்டர் கண்காணிப்பு$/))
    expect(title().split(' | ')[0]!.length).toBeGreaterThan(0)
    setLang('en')
  })

  it('W-8: the sign-in, the status page, a missing page when signed out, and a buyer link', async () => {
    who.role = null
    at('/login', <Login />)
    await waitFor(() => expect(title()).toMatch(/^Sign in \| Order tracking$/))
    cleanup()
    at('/status', <Status />)
    await waitFor(() => expect(title()).toBe('System status | Order tracking'))
    cleanup()
    at('/nope', <NotFound />)
    await waitFor(() => expect(title()).toBe('Page not found | Order tracking'))
    cleanup()
    at('/buyer', <Buyer />)   // no link in the address: the page says so
    await waitFor(() => expect(title()).toBe('This link is not valid | Order tracking'))
  })
})
