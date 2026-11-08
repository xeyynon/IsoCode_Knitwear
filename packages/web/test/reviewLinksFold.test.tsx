// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { splitLinks } from '../src/review/reviewLogic'

// AUDIT-03 finding 15: the buyer-links table kept every cancelled link forever (a dozen "Cancelled" rows, each with its own Download button).
// Working links come first; cancelled and expired ones sit behind a toggle with their number.
const api = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../src/api/session', async (orig) => ({ ...(await orig<typeof import('../src/api/session')>()), apiFetch: api.fn }))
import Review from '../src/pages/Review'

const FUTURE = '2027-01-31T00:00:00Z'
const L = (id: string, buyerName: string, o: { revoked?: boolean; expired?: boolean } = {}) => ({ id, buyerId: `b-${id}`, buyerName, label: null, expiresAt: FUTURE, revoked: !!o.revoked, expired: !!o.expired })

describe('splitLinks', () => {
  it('puts working links first and the cancelled and expired ones apart, each keeping its order', () => {
    const links = [L('1', 'A', { revoked: true }), L('2', 'B'), L('3', 'C', { expired: true }), L('4', 'D')]
    const { working, past } = splitLinks(links)
    expect(working.map((l) => l.id)).toEqual(['2', '4'])
    expect(past.map((l) => l.id)).toEqual(['1', '3'])
  })
  it('handles none', () => {
    expect(splitLinks([])).toEqual({ working: [], past: [] })
  })
})

describe('Review > Buyer links', () => {
  beforeEach(() => {
    api.fn.mockReset()
    api.fn.mockImplementation((path: string) => {
      if (path === '/api/review') return Promise.resolve({ needsReview: [], confirmed: [], photos: [], approvedPhotos: [], notes: [], reasons: [] })
      if (path === '/api/buyer-links') return Promise.resolve({ links: [L('1', 'Old Buyer', { revoked: true }), L('2', 'Live Buyer'), L('3', 'Gone Buyer', { expired: true }), L('4', 'Old Buyer', { revoked: true })] })
      if (path === '/api/orders/options') return Promise.resolve({ buyers: [] })
      return Promise.resolve({})
    })
  })
  afterEach(cleanup)

  it('shows the working link and folds the rest behind a button that says how many', async () => {
    render(<MemoryRouter><Review /></MemoryRouter>)
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row').length).toBe(2)                 // the header and the one working link
    expect(within(table).getByText('Live Buyer')).toBeTruthy()
    expect(within(table).queryByText('Cancelled')).toBeNull()
    const toggle = screen.getByRole('button', { name: /cancelled and expired links \(3\)/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('the button opens them (and closes them again), and says which state it is in', async () => {
    render(<MemoryRouter><Review /></MemoryRouter>)
    const toggle = await screen.findByRole('button', { name: /Show cancelled and expired links \(3\)/ })
    fireEvent.click(toggle)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row').length).toBe(5)
    expect(within(table).getAllByText('Cancelled').length).toBe(2)
    expect(within(table).getByText('Expired')).toBeTruthy()
    const open = screen.getByRole('button', { name: /Hide cancelled and expired links \(3\)/ })
    expect(open.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(open)
    expect(within(screen.getByRole('table')).getAllByRole('row').length).toBe(2)
  })

  it('when nothing works any more, it says so instead of showing an empty table', async () => {
    api.fn.mockImplementation((path: string) => {
      if (path === '/api/review') return Promise.resolve({ needsReview: [], confirmed: [], photos: [], approvedPhotos: [], notes: [], reasons: [] })
      if (path === '/api/buyer-links') return Promise.resolve({ links: [L('1', 'Old Buyer', { revoked: true })] })
      return Promise.resolve({ buyers: [] })
    })
    render(<MemoryRouter><Review /></MemoryRouter>)
    await screen.findByText(/No link works right now/)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('button', { name: /Show cancelled and expired links \(1\)/ })).toBeTruthy()
  })
})
