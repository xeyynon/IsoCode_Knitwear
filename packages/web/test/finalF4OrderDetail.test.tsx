// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

// Final cycle W-11, W-14, W-15, W-16: the order page. An unknown order is not a failure to retry; a date change to a day that has gone is asked about,
// with the year when it is not this year; the "Order created" line does not come back on reload; dates are written as people read them.
const api = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../src/api/session', async (orig) => ({ ...(await orig<typeof import('../src/api/session')>()), apiFetch: api.fn }))
import OrderDetail from '../src/pages/OrderDetail'
import { ApiError } from '../src/api/session'

const detail = () => ({
  today: '2026-11-09',
  order: { id: 'o1', po: 'PO-1', buyerName: 'Buyer B', style: 'polo', colour: 'white', sizes: { M: 100 }, qty: 100, exFactory: '2026-11-20', status: 'green' },
  stages: [], calendar: { from: '2026-11-01', to: '2026-12-01', units: [] }, history: [],
  notes: [{ id: 'n1', stage: 'sewing', takenOn: '2026-11-05', language: 'en', original: 'Machine broke', textEn: null, category: null, categoryBy: null, reviewed: false }],
  reasons: [],
})
let loadFails: ApiError | null
let calls: { path: string; body?: string }[]
let moveResult: { exFactory: { old: string; new: string }; milestones: unknown[]; leftAlone: string[] }

beforeEach(() => {
  loadFails = null; calls = []
  moveResult = { exFactory: { old: '2026-11-20', new: '2026-11-25' }, milestones: [], leftAlone: [] }
  api.fn.mockReset()
  api.fn.mockImplementation((path: string, init?: RequestInit) => {
    calls.push({ path, body: init?.body as string | undefined })
    if (path.endsWith('/ex-factory')) return Promise.resolve(moveResult)
    if (path.startsWith('/api/orders/')) return loadFails ? Promise.reject(loadFails) : Promise.resolve(detail())
    return Promise.resolve({})
  })
  // jsdom has no modal <dialog>: the minimum the confirmation needs
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement, v?: string) { this.returnValue = v ?? ''; this.removeAttribute('open'); this.dispatchEvent(new Event('close')) }
})
afterEach(cleanup)

function Probe() { const l = useLocation(); return <output data-testid="loc">{JSON.stringify({ path: l.pathname, state: l.state })}</output> }
const mount = (state?: unknown) => render(
  <MemoryRouter initialEntries={[{ pathname: '/orders/o1', state }]}>
    <Probe />
    <Routes><Route path="/orders/:id" element={<OrderDetail />} /></Routes>
  </MemoryRouter>)

describe('W-11: an order that is not there', () => {
  it.each([400, 404])('W-11: a %i says the order could not be found, links to the board, and offers no Retry', async (status) => {
    loadFails = new ApiError(status, 'not_found', status === 400 ? 'Invalid order' : 'No such order')
    mount()
    expect(await screen.findByText('This order could not be found.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /retry|try again/i })).toBeNull()
    expect(screen.queryByText('Invalid order')).toBeNull()
    expect(screen.getAllByRole('link', { name: /order board/i }).length).toBeGreaterThan(0)
  })
  it('W-11: a failed connection still offers Retry (it can work)', async () => {
    loadFails = new ApiError(0, 'unreachable', 'down')
    mount()
    expect(await screen.findByRole('button', { name: /retry|try again/i })).toBeTruthy()
  })
})

const fillChange = async (newDate: string) => {
  fireEvent.click(await screen.findByText('Change the ex-factory date'))
  fireEvent.change(screen.getByLabelText('New ex-factory date'), { target: { value: newDate } })
  fireEvent.change(screen.getByLabelText('Reason (kept in the history)'), { target: { value: 'Buyer asked' } })
  fireEvent.click(screen.getByRole('button', { name: 'Change date' }))
}
const posted = () => calls.filter((c) => c.path.endsWith('/ex-factory'))

describe('W-14: moving ex-factory to a day that has gone', () => {
  it('W-14: asks first, in a sentence with the date (no year in this year), and sends nothing until confirmed', async () => {
    mount()
    await fillChange('2026-11-03')
    const box = await screen.findByRole('dialog', { hidden: true })
    expect(box.textContent).toContain('3 Nov')
    expect(box.textContent).not.toContain('2026')
    expect(box.textContent).toMatch(/before today/)
    expect(posted()).toHaveLength(0)
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel', hidden: true }))
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).toBeNull())
    expect(posted()).toHaveLength(0)
  })
  it('W-14: the year is in the sentence when it is not this year; confirming sends the change', async () => {
    mount()
    await fillChange('2025-12-31')
    const box = await screen.findByRole('dialog', { hidden: true })
    expect(box.textContent).toContain('31 Dec 2025')
    fireEvent.click(within(box).getByRole('button', { name: 'Change date', hidden: true }))
    await waitFor(() => expect(posted()).toHaveLength(1))
  })
  it('W-14: a date from today on is sent without asking', async () => {
    mount()
    await fillChange('2026-11-09')
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull()
  })
  it('W-14: the confirmation of a move into another year names the year', async () => {
    moveResult = { exFactory: { old: '2026-11-20', new: '2027-01-05' }, milestones: [], leftAlone: [] }
    mount()
    await fillChange('2027-01-05')
    expect(await screen.findByText(/Ex-factory moved from 20 Nov to 5 Jan 2027\./)).toBeTruthy()
  })
})

describe('W-15 and W-16', () => {
  it('W-15: "Order created" shows, and is taken out of the history entry so a reload does not bring it back', async () => {
    mount({ created: true })
    expect(await screen.findByText(/Order created\./)).toBeTruthy()
    await waitFor(() => expect(JSON.parse(screen.getByTestId('loc').textContent!).state).toBeNull())
    expect(screen.getByText(/Order created\./)).toBeTruthy()   // still said on this visit
  })
  it('W-16: a note\'s day is "5 Nov", not 2026-11-05', async () => {
    mount()
    await screen.findByText('Machine broke')
    expect(screen.getByText('5 Nov')).toBeTruthy()
    expect(document.body.textContent).not.toContain('2026-11-05')
  })
})
