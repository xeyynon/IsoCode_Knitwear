// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { composeReasonNote } from '@isocode/engine'

// The form review, through the real Review page with a fake API: a note with several reasons shows them in the order they were tapped, the first as the
// main reason; a note written from the choices needs no AI; an edited note keeps the AI flow; an old note renders as it always did.
const api = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../src/api/session', async (orig) => ({ ...(await orig<typeof import('../src/api/session')>()), apiFetch: api.fn }))
import Review from '../src/pages/Review'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const REASONS = [
  { id: 'labour', en: 'Not enough workers', ta: 'x' }, { id: 'absence', en: 'Workers on leave', ta: 'x' }, { id: 'machine', en: 'Machine problem', ta: 'x' },
  { id: 'material', en: 'Material is late', ta: 'x' }, { id: 'power', en: 'No power', ta: 'x' }, { id: 'quality', en: 'Fixing quality', ta: 'x' }, { id: 'other', en: 'Something else', ta: 'x' },
]
const base = { po: 'B-PO-88240', buyerName: 'Buyer B', stage: 'sewing', takenOn: '2026-11-05', language: 'ta', original: 'இயந்திரம் பழுது', textEn: null, category: null, categoryBy: null, ai: null }
type N = Record<string, unknown> & { id: string }
let notes: N[]
let calls: { path: string; body: string | undefined }[]

function fakeApi(path: string, init?: RequestInit): Promise<unknown> {
  calls.push({ path: `${init?.method ?? 'GET'} ${path}`, body: init?.body as string | undefined })
  if (path === '/api/review') return Promise.resolve({ needsReview: [], confirmed: [], photos: [], approvedPhotos: [], notes, reasons: REASONS, aiEnabled: true })
  if (path === '/api/buyer-links') return Promise.resolve({ links: [] })
  if (path === '/api/orders/options') return Promise.resolve({ buyers: [] })
  if (path === '/api/notes/suggest') return Promise.resolve({ asked: 0, suggested: 0, unsure: 0, failed: 0 })
  return Promise.resolve({})
}
beforeEach(() => { notes = []; calls = []; api.fn.mockReset(); api.fn.mockImplementation(fakeApi) })
afterEach(cleanup)
const mount = () => render(<MemoryRouter><Review /></MemoryRouter>)
const chips = (card: HTMLElement) => [...card.querySelectorAll('li.reasonlist__item')].map((li) => li.textContent)
const cardOf = async (po = 'B-PO-88240') => (await screen.findByText(po)).closest('li.stagecard') as HTMLElement

describe('REV-10: several reasons are shown in the order they were tapped', () => {
  it('three reasons: the chips follow the tap order and only the first says "Main reason"', async () => {
    notes = [{ ...base, id: 'n1', category: 'machine', categoryBy: 'supervisor', categories: ['machine', 'labour', 'material'] }]
    mount()
    const card = await cardOf()
    expect(chips(card)).toEqual(['Main reasonMachine problem', 'Not enough workers', 'Material is late'])
    expect(within(card).getByRole('list', { name: /reasons/i })).toBeTruthy()
  })
  it('the main reason is said in words, so it does not rely on colour', async () => {
    notes = [{ ...base, id: 'n1', category: 'power', categoryBy: 'supervisor', categories: ['power', 'other'] }]
    mount()
    expect(within(await cardOf()).getAllByText('Main reason').length).toBeGreaterThan(0)
  })
  it('the field that changes the reason is called "Main reason" when there are several, and keeps the old name for one', async () => {
    notes = [{ ...base, id: 'n1', category: 'machine', categoryBy: 'supervisor', categories: ['machine', 'labour'] }, { ...base, id: 'n2', po: 'C-PO-0488', category: 'power', categoryBy: 'supervisor', categories: ['power'] }]
    mount()
    expect(within(await cardOf()).getByRole('combobox', { name: /^Main reason/ })).toBeTruthy()
    expect(within(await cardOf('C-PO-0488')).getByRole('combobox', { name: /^Reason/ })).toBeTruthy()
  })
})

describe('REV-11: changing the main reason keeps the others in view', () => {
  it('picking another main reason moves it to the front, loses nothing, and the confirm sends it as the category', async () => {
    notes = [{ ...base, id: 'n1', category: 'machine', categoryBy: 'supervisor', categories: ['machine', 'labour', 'material'] }]
    mount()
    const card = await cardOf()
    fireEvent.change(within(card).getByRole('combobox', { name: /^Main reason/ }), { target: { value: 'material' } })
    await waitFor(() => expect(chips(card)).toEqual(['Main reasonMaterial is late', 'Machine problem', 'Not enough workers']))
    fireEvent.click(within(card).getByRole('button', { name: 'Mark as reviewed' }))
    await waitFor(() => expect(calls.some((c) => c.path === 'POST /api/notes/n1/confirm')).toBe(true))
    const body = JSON.parse(calls.find((c) => c.path === 'POST /api/notes/n1/confirm')!.body!)
    expect(body.category).toBe('material')
  })
  it('after reviewing, focus returns to the notes heading as before', async () => {
    notes = [{ ...base, id: 'n1', category: 'machine', categoryBy: 'supervisor', categories: ['machine'] }]
    mount()
    fireEvent.click(within(await cardOf()).getByRole('button', { name: 'Mark as reviewed' }))
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H2'))
  })
})

describe('REV-12: a note written from the supervisors choices needs no AI', () => {
  const gen = (): N => ({ ...base, id: 'g1', category: 'machine', categoryBy: 'supervisor', categories: ['machine', 'labour'], generated: true, original: composeReasonNote('ta', ['machine', 'labour']), textEn: composeReasonNote('en', ['machine', 'labour']) })
  it('says where it came from, quietly, and never shows "Asking AI" or "not sure"', async () => {
    notes = [gen()]
    mount()
    const card = await cardOf()
    expect(within(card).getByText("Written from the supervisor's choices")).toBeTruthy()
    expect(within(card).queryByText(/Asking AI|not sure|AI suggests/)).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Ask AI again' })).toBeNull()
  })
  it('does not ask the server for a suggestion for it', async () => {
    notes = [gen()]
    mount()
    await cardOf()
    await new Promise((r) => setTimeout(r, 30))
    expect(calls.filter((c) => c.path === 'POST /api/notes/suggest')).toHaveLength(0)
  })
  it('the English box starts as the composed English sentence, which the person can still edit', async () => {
    notes = [gen()]
    mount()
    const card = await cardOf()
    const box = within(card).getByLabelText(/What it means, in English/) as HTMLTextAreaElement
    expect(box.value).toBe(composeReasonNote('en', ['machine', 'labour']))
    expect(within(card).queryByText(/AI draft/)).toBeNull()
    fireEvent.change(box, { target: { value: 'Edited.' } })
    expect(box.value).toBe('Edited.')
  })
})

describe('REV-13: an edited or typed note keeps todays AI flow', () => {
  it('shows the reasons AND "AI is not sure (40%)" for a note that is not generated', async () => {
    notes = [{ ...base, id: 'e1', category: 'machine', categoryBy: 'supervisor', categories: ['machine', 'labour'], generated: false, ai: { status: 'unsure', textEn: 'Machine broke, few workers', category: 'labour', confidence: 0.4, why: null, model: 'm', error: null, attempts: 1, at: null } }]
    mount()
    const card = await cardOf()
    expect(within(card).getByText(/AI is not sure \(40%\)/)).toBeTruthy()
    expect(chips(card)[0]).toBe('Main reasonMachine problem')
    expect(within(card).queryByText("Written from the supervisor's choices")).toBeNull()
  })
})

describe('REV-14: an old note, without the new fields, renders exactly as it always did', () => {
  it('no reason list, no caption, the field is "Reason", and the AI flow is unchanged', async () => {
    notes = [{ ...base, id: 'o1', category: 'machine', categoryBy: 'supervisor', ai: { status: 'suggested', textEn: 'Machine broke', category: 'machine', confidence: 0.9, why: null, model: 'm', error: null, attempts: 1, at: null } }]
    mount()
    const card = await cardOf()
    expect(card.querySelector('.reasonlist')).toBeNull()
    expect(within(card).queryByText("Written from the supervisor's choices")).toBeNull()
    expect(within(card).getByRole('combobox', { name: /^Reason/ })).toBeTruthy()
    expect(within(card).getByText(/AI suggests "Machine problem" \(90% sure\)/)).toBeTruthy()
  })
})

describe('REV-15: the molecule is plain and neutral', () => {
  const css = read('../src/ui/molecules/ReasonList.css').replace(/\/\*[\s\S]*?\*\//g, '')
  it('uses tokens only, no tint, no edge bar, no fill that is not the surface', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|tint|status|border-(left|right)\s*:/i)
    expect(css).not.toMatch(/background:\s*var\(--(accent|ink)\)/)
  })
})
