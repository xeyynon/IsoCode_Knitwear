// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { returnTarget } from '../src/api/sessionRules'

// Final cycle W-19(a): after signing in, go back to the screen the person tried to open (a bookmark to /review), not always to the board.
describe('W-19: where a sign-in goes', () => {
  it.each([
    ['/review', 'merchandiser', '/review'],
    ['/orders/abc?back=%2Fboard', 'merchandiser', '/orders/abc?back=%2Fboard'],
    ['/setup?tab=people', 'merchandiser', '/setup?tab=people'],
    ['/today', 'supervisor', '/today'],
    ['/today/o1/sewing', 'supervisor', '/today/o1/sewing'],
  ] as const)('W-19: %s for a %s goes there', (from, role, to) => expect(returnTarget(from, role)).toBe(to))

  it.each([
    ['nothing asked for', undefined, 'merchandiser', '/board'],
    ['the sign-in itself', '/login', 'merchandiser', '/board'],
    ['the root', '/', 'supervisor', '/today'],
    ['a screen of the other role', '/review', 'supervisor', '/today'],
    ['a screen of the other role', '/today', 'merchandiser', '/board'],
    ['another site', '//evil.example/x', 'merchandiser', '/board'],
    ['a full address', 'https://evil.example/', 'merchandiser', '/board'],
    ['something that is not a path', 42, 'merchandiser', '/board'],
    ['a path nobody has', '/nope', 'merchandiser', '/board'],
  ] as [string, unknown, 'merchandiser' | 'supervisor', string][])('W-19: %s goes to the role\'s home', (_n, from, role, to) => expect(returnTarget(from, role)).toBe(to))
})

const who = vi.hoisted(() => ({ role: null as null | 'merchandiser' | 'supervisor' }))
vi.mock('../src/api/session', async (orig) => ({
  ...(await orig<typeof import('../src/api/session')>()),
  getClaims: () => (who.role ? { sub: 'u1', role: who.role, exp: 9e9 } : null),
  getToken: () => (who.role ? 't' : null),
  apiFetch: () => new Promise(() => {}),
}))
function Probe() { const l = useLocation(); return <output data-testid="loc">{l.pathname}{l.search}|{JSON.stringify(l.state)}</output> }
beforeEach(() => { who.role = null })
afterEach(cleanup)

describe('W-19: the whole trip', () => {
  it('W-19: a signed-out visit to /review is sent to sign-in remembering /review', async () => {
    const { default: App } = await import('../src/App')
    render(<MemoryRouter initialEntries={['/review?x=1']}><App /><Probe /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toMatch(/^\/login\|/))
    expect(JSON.parse(screen.getByTestId('loc').textContent!.split('|')[1]!)).toEqual({ from: '/review?x=1' })
  })
  it('W-19: signing in from there lands on /review', async () => {
    const { default: Login } = await import('../src/pages/Login')
    who.role = 'merchandiser'   // the sign-in has just succeeded
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/review' } }]}>
        <Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Probe />} /></Routes>
      </MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toMatch(/^\/review\|/))
  })
})
