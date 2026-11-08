// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

// UI/UX plan, slice 4.1, driven through the real Review page with a fake API: "Don't show" on a warning that was waiting can be undone;
// "Hide from buyer" on a confirmed one cannot; a failed undo says so in words in the same place and leaves the page as it was.
const api = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../src/api/session', async (orig) => ({ ...(await orig<typeof import('../src/api/session')>()), apiFetch: api.fn }))
import Review from '../src/pages/Review'
import { ApiError } from '../src/api/session'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

interface W { id: string; orderId: string; po: string; buyerName: string; stage: string; status: 'amber' | 'red'; buyerText: string; maths: string; state: string }
const warn = (id: string, po: string): W => ({ id, orderId: `o-${id}`, po, buyerName: 'Buyer B', stage: 'sewing', status: 'red', buyerText: `Words for ${po}`, maths: 'Need 467/day', state: 'open' })

let waiting: W[]
let confirmed: W[]
let hidden: W[]
let undoFails: unknown = null
let calls: string[]

function fakeApi(path: string, init?: RequestInit): Promise<unknown> {
  calls.push(`${init?.method ?? 'GET'} ${path}`)
  if (path === '/api/review') return Promise.resolve({ needsReview: waiting, confirmed, photos: [], approvedPhotos: [], notes: [], reasons: [] })
  if (path === '/api/buyer-links') return Promise.resolve({ links: [] })
  if (path === '/api/orders/options') return Promise.resolve({ buyers: [] })
  const m = /^\/api\/warnings\/([^/]+)\/(dismiss|undo-dismiss)$/.exec(path)
  if (m) {
    const [, id, what] = m
    if (what === 'dismiss') {
      const w = waiting.find((x) => x.id === id) ?? confirmed.find((x) => x.id === id)!
      waiting = waiting.filter((x) => x.id !== id); confirmed = confirmed.filter((x) => x.id !== id); hidden.push(w)
      return Promise.resolve({ ok: true })
    }
    if (undoFails) return Promise.reject(undoFails)
    const w = hidden.find((x) => x.id === id)!
    hidden = hidden.filter((x) => x.id !== id); waiting.push(w)
    return Promise.resolve({ ok: true })
  }
  return Promise.resolve({})
}

beforeEach(() => {
  waiting = [warn('w1', 'B-PO-88240')]; confirmed = [warn('c1', 'C-PO-0488')]; hidden = []; undoFails = null; calls = []
  api.fn.mockReset(); api.fn.mockImplementation(fakeApi)
})
afterEach(cleanup)

const mount = () => render(<MemoryRouter><Review /></MemoryRouter>)
const waitingHeading = () => screen.getByRole('heading', { level: 2, name: /Waiting for your review/ })

describe('Review: undo for "Don\'t show"', () => {
  it('hiding a waiting warning leaves an Undo line where the card was, and the count follows', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: "Don't show" }))
    const undo = await screen.findByRole('button', { name: /^Undo: B-PO-88240/ })
    expect(undo).toBeTruthy()
    expect(waitingHeading().textContent).toContain('(0)')
    expect(screen.queryByText('Words for B-PO-88240', { exact: false })).toBeNull()   // the card is gone
    // the line is inside the waiting section, under its heading
    expect(undo.closest('section')!.contains(waitingHeading())).toBe(true)
  })

  it('undo brings the card back, drops the line, updates the count and puts focus on the section heading', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: "Don't show" }))
    fireEvent.click(await screen.findByRole('button', { name: /^Undo: B-PO-88240/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Undo:/ })).toBeNull())
    expect(await screen.findByRole('button', { name: "Don't show" })).toBeTruthy()
    expect(waitingHeading().textContent).toContain('(1)')
    expect(document.activeElement).toBe(waitingHeading())
    expect(calls).toContain('POST /api/warnings/w1/undo-dismiss')
  })

  it('"Hide from buyer" on a confirmed warning offers NO undo', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Hide from buyer' }))
    await waitFor(() => expect(calls).toContain('POST /api/warnings/c1/dismiss'))
    await screen.findByRole('heading', { level: 2, name: /Warnings visible to buyers now \(0\)/ })
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Undo/)
  })

  it('a refusal says so in words in the same line, with no button, and the warning stays hidden', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: "Don't show" }))
    undoFails = new ApiError(409, 'needs_confirmation', 'server words')
    fireEvent.click(await screen.findByRole('button', { name: /^Undo: B-PO-88240/ }))
    const alert = await screen.findByText(/had been confirmed, so it cannot be brought back/)
    expect(alert.closest('li')!.textContent).toContain('B-PO-88240')
    expect(screen.queryByRole('button', { name: /^Undo:/ })).toBeNull()
    expect(waitingHeading().textContent).toContain('(0)')
  })

  it('a network failure says so, leaves the page as it was and lets the person try again', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: "Don't show" }))
    undoFails = new ApiError(0, 'unreachable', 'offline')
    fireEvent.click(await screen.findByRole('button', { name: /^Undo: B-PO-88240/ }))
    await screen.findByText('Could not undo. Try again.')
    expect(waitingHeading().textContent).toContain('(0)')
    undoFails = null
    fireEvent.click(await screen.findByRole('button', { name: /^Undo: B-PO-88240/ }))
    await waitFor(() => expect(waitingHeading().textContent).toContain('(1)'))
  })

  it('no timer and no toast: the line is still there long after it appeared', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: "Don't show" }))
    await screen.findByRole('button', { name: /^Undo: B-PO-88240/ })
    vi.useFakeTimers()
    vi.advanceTimersByTime(10 * 60 * 1000)
    vi.useRealTimers()
    expect(screen.getByRole('button', { name: /^Undo: B-PO-88240/ })).toBeTruthy()
  })
})

describe('Review source: the promise stays visible in the code', () => {
  const src = read('../src/pages/Review.tsx')
  it('only the waiting list can leave an Undo line; the confirmed list never does', () => {
    expect(src).toMatch(/decide\(w, 'dismiss-waiting', pendingHeading\)/)
    expect(src).toMatch(/decide\(w, 'dismiss', confirmedHeading\)/)
    expect(src).toMatch(/offersUndo\(from\)/)
    expect(src).toMatch(/const from: HiddenFrom = action === 'dismiss-waiting' \? 'waiting' : 'confirmed'/)
  })
  it('the undo line is the InlineUndo molecule', () => {
    expect(src).toContain('<InlineUndo')
  })
})
