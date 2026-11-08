// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Final cycle W-1: a refusal from the server on Create order has to be seen and heard. The banner was drawn far above the
// button (off screen) and focus fell to the page because the button was disabled while it worked.
const api = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../src/api/session', async (orig) => ({ ...(await orig<typeof import('../src/api/session')>()), apiFetch: api.fn }))
import OrderSetup from '../src/pages/OrderSetup'
import { ApiError } from '../src/api/session'

let createFails: ApiError | null
function fakeApi(path: string, init?: RequestInit): Promise<unknown> {
  if (path === '/api/orders/options') return Promise.resolve({ buyers: [{ id: 'b1', name: 'Buyer B', country: null }], templates: [{ id: 't1', name: 'Tee', stages: [] }] })
  if (path === '/api/orders/preview') return Promise.resolve({ milestones: [], problems: [], alreadyDue: [] })
  if (path === '/api/orders' && init?.method === 'POST') return createFails ? Promise.reject(createFails) : Promise.resolve({ orderId: 'o1' })
  return Promise.resolve({})
}
beforeEach(() => { createFails = null; api.fn.mockReset(); api.fn.mockImplementation(fakeApi); window.scrollTo = vi.fn(); Element.prototype.scrollIntoView = vi.fn() })
afterEach(cleanup)

async function fillAndCreate() {
  render(<MemoryRouter><OrderSetup /></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('Buyer'), { target: { value: 'b1' } })
  fireEvent.change(screen.getByLabelText('PO number'), { target: { value: 'PO-1' } })
  fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'polo' } })
  fireEvent.change(screen.getByLabelText('Colour'), { target: { value: 'white' } })
  fireEvent.change(screen.getAllByPlaceholderText('Pieces')[0]!, { target: { value: '500' } })
  fireEvent.change(screen.getByLabelText('Ex-factory date'), { target: { value: '2026-12-20' } })
  fireEvent.change(screen.getByLabelText('TNA template'), { target: { value: 't1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
}

describe('W-1: a refused Create order', () => {
  it('W-1: puts focus on the server message (focus() brings it into view)', async () => {
    createFails = new ApiError(400, 'bad_request', 'The PO number is too long.')
    await fillAndCreate()
    const banner = await screen.findByText('The PO number is too long.')
    await waitFor(() => expect(document.activeElement).toBe(banner))
  })

  it('W-1: a second refusal with the same words moves focus there again', async () => {
    createFails = new ApiError(400, 'bad_request', 'The PO number is too long.')
    await fillAndCreate()
    const banner = await screen.findByText('The PO number is too long.')
    await waitFor(() => expect(document.activeElement).toBe(banner))
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.click(screen.getByRole('button', { name: 'Create order' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('The PO number is too long.')))
  })

  it('W-1: PO, Style and Colour stop at the server limit of 200', async () => {
    render(<MemoryRouter><OrderSetup /></MemoryRouter>)
    for (const label of ['PO number', 'Style', 'Colour']) {
      expect((await screen.findByLabelText(label)).getAttribute('maxlength')).toBe('200')
    }
  })
})
