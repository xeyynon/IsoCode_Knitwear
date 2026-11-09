// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Buyer from '../src/pages/Buyer'

// Final cycle W-2: a new link pasted into a tab that already shows a buyer page must open that link, and an empty fragment must not leave the
// previous buyer's orders on screen. (The page sits inside a router now: the top bar's brand is a link, even on this public page.)
const TOKEN_A = 'bl_' + 'a'.repeat(30)
const TOKEN_B = 'bl_' + 'b'.repeat(30)
const view = (name: string) => ({ buyer: { name }, orders: [{ po: `PO-${name}`, style: 's', colour: 'c', qty: 10, exFactory: '2026-12-01', milestones: [], photos: [], warnings: [] }] })

let seen: string[]
beforeEach(() => {
  seen = []
  window.sessionStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const auth = (init.headers as Record<string, string>).authorization!
    seen.push(auth)
    if (auth === `Bearer ${TOKEN_A}`) return new Response(JSON.stringify(view('Alpha')), { status: 200 })
    if (auth === `Bearer ${TOKEN_B}`) return new Response(JSON.stringify(view('Beta')), { status: 200 })
    return new Response('{}', { status: 401 })
  }))
  window.history.replaceState(null, '', `/buyer#${TOKEN_A}`)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const navigateTo = (hash: string) => act(async () => {
  window.history.pushState(null, '', `/buyer${hash}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
})

describe('W-2: the buyer page follows the address', () => {
  it('W-2: a new link pasted into the same tab opens that buyer', async () => {
    render(<MemoryRouter><Buyer /></MemoryRouter>)
    expect(await screen.findByText('PO-Alpha')).toBeTruthy()
    await navigateTo(`#${TOKEN_B}`)
    expect(await screen.findByText('PO-Beta')).toBeTruthy()
    expect(screen.queryByText('PO-Alpha')).toBeNull()
    expect(window.location.hash).toBe('')   // the token is taken out of the address again
  })

  it('W-2: an empty fragment does not show the previous buyer\'s orders', async () => {
    render(<MemoryRouter><Buyer /></MemoryRouter>)
    expect(await screen.findByText('PO-Alpha')).toBeTruthy()
    await navigateTo('#')
    await waitFor(() => expect(screen.queryByText('PO-Alpha')).toBeNull())
    expect(screen.getAllByText('This link is not valid').length).toBeGreaterThan(0)
    expect(window.sessionStorage.getItem('buyer.token')).toBeNull()
  })

  it('W-2: the skip link\'s #main is not a new link', async () => {
    render(<MemoryRouter><Buyer /></MemoryRouter>)
    expect(await screen.findByText('PO-Alpha')).toBeTruthy()
    await navigateTo('#main')
    expect(screen.getByText('PO-Alpha')).toBeTruthy()
  })
})
