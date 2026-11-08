// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Final cycle W-3 and the Review half of W-1, through the real Review page with a fake API.
const api = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../src/api/session', async (orig) => ({ ...(await orig<typeof import('../src/api/session')>()), apiFetch: api.fn }))
import Review from '../src/pages/Review'
import { ApiError } from '../src/api/session'

const note = (id: string, ai: unknown = null) => ({ id, po: `PO-${id}`, buyerName: 'Buyer B', stage: 'sewing', takenOn: '2026-11-05', language: 'ta', original: 'இரண்டு மெஷின் பழுது', textEn: null, category: null, categoryBy: null, ai })
let notes: ReturnType<typeof note>[]
let suggest: () => Promise<unknown>
let one: (id: string) => Promise<unknown>
let calls: string[]
let confirmFails: ApiError | null

function fakeApi(path: string, init?: RequestInit): Promise<unknown> {
  calls.push(`${init?.method ?? 'GET'} ${path}`)
  if (path === '/api/review') return Promise.resolve({ needsReview: [], confirmed: [], photos: [], approvedPhotos: [], notes, reasons: [{ id: 'machine', en: 'Machine problem', ta: 'x' }], aiEnabled: true })
  if (path === '/api/buyer-links') return Promise.resolve({ links: [] })
  if (path === '/api/orders/options') return Promise.resolve({ buyers: [] })
  if (path === '/api/notes/suggest') return suggest()
  const m = /^\/api\/notes\/([^/]+)\/suggest$/.exec(path)
  if (m) return one(m[1]!)
  if (/\/confirm$/.test(path) && confirmFails) return Promise.reject(confirmFails)
  return Promise.resolve({})
}
const suggestCalls = () => calls.filter((c) => c === 'POST /api/notes/suggest').length

beforeEach(() => {
  notes = [note('n1')]; calls = []; confirmFails = null
  suggest = () => Promise.resolve({ asked: 0, suggested: 0, unsure: 0, failed: 0 })
  one = () => Promise.resolve({ asked: 1, suggested: 1, unsure: 0, failed: 0 })
  api.fn.mockReset(); api.fn.mockImplementation(fakeApi)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const mount = () => render(<MemoryRouter><Review /></MemoryRouter>)

describe('W-3: Review does not wait for ever on the AI', () => {
  it('W-3: a failed suggest call ends in a plain line and an Ask AI again button on the note', async () => {
    suggest = () => Promise.reject(new ApiError(0, 'unreachable', 'down'))
    mount()
    expect(await screen.findByText('No suggestion: the AI service could not be reached. Choose the reason yourself, or ask again.')).toBeTruthy()
    expect(screen.queryByText('Asking AI for a suggestion…')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ask AI again' })).toBeTruthy()
  })

  it('W-3: 429 ai_busy shows the server\'s message on the note and stops asking', async () => {
    const msg = 'The AI has been used as much as it can be today. Please write the English yourself, or try again tomorrow.'
    suggest = () => Promise.reject(new ApiError(429, 'ai_busy', msg))
    mount()
    expect(await screen.findByText(msg)).toBeTruthy()
    expect(suggestCalls()).toBe(1)
  })

  it('W-3: Ask again answered 429 ai_ask_limit shows that message on the note, not as a banner at the top', async () => {
    const msg = 'This note has been asked about enough times. Please write the English yourself.'
    suggest = () => Promise.reject(new ApiError(0, 'unreachable', 'down'))
    one = () => Promise.reject(new ApiError(429, 'ai_ask_limit', msg))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Ask AI again' }))
    const line = await screen.findByText(msg)
    expect(line.closest('.ai-box')).not.toBeNull()
  })

  it('W-3: rounds that ask nothing (a rate-limited batch) rest 60 seconds between them and never pass six', async () => {
    vi.useFakeTimers()
    mount()
    const settle = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
    await settle(100)
    expect(suggestCalls()).toBe(1)
    await settle(30_000)
    expect(suggestCalls()).toBe(1)
    await settle(31_000)
    expect(suggestCalls()).toBe(2)
    for (let i = 0; i < 10; i++) await settle(61_000)
    expect(suggestCalls()).toBe(6)
    expect(screen.queryByText('Asking AI for a suggestion…')).toBeNull()
  })
})

describe('W-16: dates on Review read as people say them', () => {
  it('W-16: a note and a photo show "5 Nov", not 2026-11-05', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    api.fn.mockImplementation((path: string, init?: RequestInit) => path === '/api/review'
      ? Promise.resolve({ needsReview: [], confirmed: [], notes: [note('n1', { status: 'suggested', textEn: 'x', category: 'machine', confidence: 0.9, why: null, model: 'm', error: null, attempts: 1, at: null })],
        photos: [{ id: 'p1', po: 'PO-9', buyerName: 'Buyer B', stage: 'sewing', takenOn: '2026-11-05', bytes: 10 }],
        approvedPhotos: [{ id: 'p2', po: 'PO-8', buyerName: 'Buyer B', stage: 'sewing', takenOn: '2026-11-06' }],
        reasons: [{ id: 'machine', en: 'Machine problem', ta: 'x' }], aiEnabled: true })
      : fakeApi(path, init))
    mount()
    await screen.findByText(/PO-n1/)
    expect(document.body.textContent).toContain('Sewing · 5 Nov')
    expect(document.body.textContent).toContain('Sewing · 6 Nov')
    expect(document.body.textContent).not.toMatch(/2026-11-0\d/)
    vi.unstubAllGlobals()
  })
})

describe('W-1: a refused action on Review is seen', () => {
  it('W-1: the error banner takes focus', async () => {
    notes = [note('n1', { status: 'suggested', textEn: 'x', category: 'machine', confidence: 0.9, why: null, model: 'm', error: null, attempts: 1, at: null })]
    confirmFails = new ApiError(409, 'changed', 'This note was changed by someone else.')
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as reviewed' }))
    const banner = await screen.findByText('This note was changed by someone else.')
    await waitFor(() => expect(document.activeElement).toBe(banner))
  })
})
