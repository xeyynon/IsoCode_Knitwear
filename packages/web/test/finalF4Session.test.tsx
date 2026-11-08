// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'

// Final cycle W-9: a token the server no longer accepts (or one that ran out) sends the person to the sign-in. The sign-in has to say why, once, in the
// language on screen; deliberate sign-out and a wrong PIN are not "your session ended".
const token = (expOffsetSec: number) => `${btoa(JSON.stringify({ role: 'merchandiser', sub: 'u1', exp: Math.floor(Date.now() / 1000) + expOffsetSec }))}.sig`
const respond = (status: number, body: unknown = {}) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

beforeEach(() => { vi.resetModules(); window.localStorage.clear(); window.sessionStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const load = async () => ({ s: await import('../src/api/session'), i: await import('../src/i18n'), Login: (await import('../src/pages/Login')).default })
const mount = (Login: () => ReactElement) => render(<MemoryRouter><Login /></MemoryRouter>)
const sayings = { en: 'Your session ended. Sign in again.', ta: 'உங்கள் உள்நுழைவு முடிந்தது. மீண்டும் உள்நுழையுங்கள்.' }

describe('W-9: the sign-in says the session ended', () => {
  it('W-9: a 401 on a signed-in call puts the notice on the sign-in page, once', async () => {
    const { s, i, Login } = await load()
    i.setLang('en')
    window.sessionStorage.setItem('orders.token', token(3600))
    respond(401, { error: { code: 'unauthorized', message: 'Sign in again' } })
    await expect(s.apiFetch('/api/review')).rejects.toBeTruthy()
    expect(s.getToken()).toBeNull()
    const first = mount(Login)
    expect(screen.getByText(sayings.en)).toBeTruthy()
    first.unmount()
    mount(Login)
    expect(screen.queryByText(sayings.en)).toBeNull()   // shown once
  })

  it('W-9: in Tamil it is the Tamil sentence', async () => {
    const { s, i, Login } = await load()
    window.sessionStorage.setItem('orders.token', token(3600))
    respond(401)
    await s.apiFetch('/api/review').catch(() => undefined)
    act(() => i.setLang('ta'))
    mount(Login)
    expect(screen.getByText(sayings.ta)).toBeTruthy()
    act(() => i.setLang('en'))
  })

  it('W-9: a token that ran out on this device\'s clock counts too', async () => {
    const { s, Login } = await load()
    window.sessionStorage.setItem('orders.token', token(-60))
    expect(s.getToken()).toBeNull()
    mount(Login)
    expect(screen.getByText(sayings.en)).toBeTruthy()
  })

  it('W-9: a wrong PIN (a 401 with no token yet) and a deliberate sign-out are not "session ended"', async () => {
    const { s, Login } = await load()
    respond(401, { error: { code: 'invalid_credentials', message: 'Incorrect details.' } })
    await s.signIn({ email: 'a@b.test', password: 'x' })
    window.sessionStorage.setItem('orders.token', token(3600))
    s.signOut()
    mount(Login)
    expect(screen.queryByText(sayings.en)).toBeNull()
  })

  it('W-9: signing in again clears it', async () => {
    const { s, Login } = await load()
    window.sessionStorage.setItem('orders.token', token(3600))
    respond(401)
    await s.apiFetch('/api/review').catch(() => undefined)
    expect(s.sessionEndedNotice()).toBe(true)
    respond(200, { token: token(3600), role: 'merchandiser' })
    await s.signIn({ email: 'a@b.test', password: 'x' })
    expect(s.sessionEndedNotice()).toBe(false)
    s.signOut()
    mount(Login)
    expect(screen.queryByText(sayings.en)).toBeNull()
  })
})
