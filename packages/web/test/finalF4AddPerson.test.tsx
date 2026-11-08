// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { personProblem, EMPTY_PERSON } from '../src/setup/addPerson'

// Final cycle W-13: the phone rule on the form is the server's rule (ten digits, the first one 6, 7, 8 or 9), and a refusal that is on screen from an
// earlier try goes away as soon as the form is sent again, even when this time it is stopped before it reaches the server.
const api = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../src/api/session', async (orig) => ({ ...(await orig<typeof import('../src/api/session')>()), apiFetch: api.fn }))
import { PeopleTab } from '../src/setup/PeopleTab'
import { ApiError } from '../src/api/session'

const INDIAN = 'Enter an Indian mobile number: ten digits starting with 6, 7, 8 or 9'
const sup = { ...EMPTY_PERSON, label: 'Meena', phone: '98765 43211', pin: '4821', unitId: 'u1' }

describe('W-13: the phone rule is the server\'s rule', () => {
  it.each(['98765 43211', '60000 00000', '70000 00000', '80000 00000', '+91 98765 43211', '098765 43211'.slice(1)])('W-13: "%s" is accepted', (phone) => {
    expect(personProblem('supervisor', { ...sup, phone })).toBeNull()
  })
  it.each(['01234 56789', '12345 67890', '50000 00000', '+91 40000 00000'])('W-13: "%s" gets the Indian-mobile sentence', (phone) => {
    expect(personProblem('supervisor', { ...sup, phone })).toBe(INDIAN)
  })
  it('W-13: a number that is not ten digits keeps the existing sentence', () => {
    expect(personProblem('supervisor', { ...sup, phone: '12345' })).toBe('Enter a 10-digit phone number.')
  })
})

let accountsFail: ApiError | null
beforeEach(() => {
  accountsFail = new ApiError(400, 'bad_request', 'That phone number already has an account')
  api.fn.mockReset()
  api.fn.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/accounts' && !init) return Promise.resolve({ accounts: [] })
    if (path === '/api/units') return Promise.resolve({ units: [{ id: 'u1', name: 'Unit 1', type: 'own' }] })
    if (path === '/api/accounts/audit') return Promise.resolve({ entries: [] })
    if (path === '/api/accounts/supervisors') return accountsFail ? Promise.reject(accountsFail) : Promise.resolve({ id: 'a1' })
    return Promise.resolve({})
  })
})
afterEach(cleanup)

describe('W-13: a stale refusal clears when the form is sent again', () => {
  it('W-13: the server\'s refusal is gone once the next try is stopped by the form itself', async () => {
    render(<MemoryRouter><PeopleTab meId="me" /></MemoryRouter>)
    const form = within(await screen.findByRole('form', { name: 'Add a person' }))
    fireEvent.change(form.getByLabelText('Name'), { target: { value: 'Meena' } })
    fireEvent.change(form.getByLabelText('Phone number'), { target: { value: '98765 43211' } })
    fireEvent.change(form.getByLabelText('4-digit PIN'), { target: { value: '4821' } })
    fireEvent.change(form.getByLabelText('Unit'), { target: { value: 'u1' } })
    fireEvent.click(form.getByRole('button', { name: 'Add supervisor' }))
    expect(await screen.findByText('That phone number already has an account')).toBeTruthy()
    // now a number the form itself refuses
    fireEvent.change(form.getByLabelText('Phone number'), { target: { value: '12345 67890' } })
    fireEvent.click(form.getByRole('button', { name: 'Add supervisor' }))
    expect(await screen.findByText(INDIAN)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('That phone number already has an account')).toBeNull())
  })
})
