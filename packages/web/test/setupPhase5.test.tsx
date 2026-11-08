// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { checklist } from '../src/setup/setupChecklist'
import type { PersonFields, PersonRole } from '../src/setup/addPerson'
import { SetupChecklist } from '../src/ui/organisms/SetupChecklist'
import { AddPersonForm } from '../src/ui/organisms/AddPersonForm'

// UI/UX plan, slices 5.1 and 5.2: the setup checklist and the one "Add a person" form.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
afterEach(cleanup)   // vitest has no globals here, so Testing Library does not tidy up by itself: queries on the page would see earlier renders

const none = checklist({ units: [], accounts: [{ role: 'merchandiser', disabled: false }], templates: [], days: [] })
const partly = checklist({ units: [{ id: '1', name: 'Unit 1' }], accounts: [{ role: 'merchandiser', disabled: false }], templates: [], days: [] })
const all = checklist({ units: [{ id: '1', name: 'Unit 1' }], accounts: [{ role: 'merchandiser', disabled: false }, { role: 'supervisor', disabled: false }], templates: [{ name: 'Basic tee', stages: [{ stage: 'Sewing' }] }], days: [{ working: false }] })
const part = checklist({ units: [{ id: '1', name: 'Unit 1' }], accounts: null, templates: [], days: [] })
const show = (props: Partial<Parameters<typeof SetupChecklist>[0]> & { result: ReturnType<typeof checklist> | null }) =>
  render(<MemoryRouter><SetupChecklist failure={null} onRetry={() => {}} onGo={() => {}} {...props} /></MemoryRouter>)

describe('SetupChecklist: its states', () => {
  it('loading: says it is checking, and draws no list', () => {
    const { container } = show({ result: null })
    expect(container.textContent).toMatch(/checking what is set up/i)
    expect(container.querySelector('li')).toBeNull()
  })
  it('failed to load: the shared failure card with Retry, which asks again', () => {
    const onRetry = vi.fn()
    const failed = checklist({ units: null, accounts: null, templates: null, days: null })
    const { container, getByText } = show({ result: failed, failure: { message: 'Could not check what is set up.', unreachable: false }, onRetry })
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Could not check what is set up.')
    fireEvent.click(getByText('Retry'))
    expect(onRetry).toHaveBeenCalled()
  })
  it('nothing set up: four to-do rows, each with its own action', () => {
    const { container } = show({ result: none })
    expect(container.querySelector('.setupcheck__line')?.textContent).toMatch(/nothing is set up yet/i)
    expect([...container.querySelectorAll('.setupcheck__go')].map((a) => a.textContent)).toEqual(['Add a unit', 'Add closed days', 'Add a template', 'Add a person'])
  })
  it('partly: the list is open and the line names what is left', () => {
    const { container } = show({ result: partly })
    expect(container.querySelector('.setupcheck__line')?.textContent).toBe('1 of 4 done. Left: Closed days, Templates, People.')
    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(true)
  })
  it('partly, on a phone: the list is folded behind "Show the steps", so the page below is not pushed down', () => {
    const original = window.matchMedia
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
    try {
      const { container } = show({ result: partly })
      expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(false)
      expect(container.querySelector('summary')?.textContent).toBe('Show the steps')
      expect(container.querySelector('.setupcheck__line')?.textContent).toContain('Left:')   // the line that matters stays in view
    } finally { window.matchMedia = original }
  })
  it('all done: one line, the list folded away', () => {
    const { container } = show({ result: all })
    expect(container.querySelector('.setupcheck__line')?.textContent).toBe('Everything is set up for the pilot.')
    expect((container.querySelector('details') as HTMLDetailsElement).open).toBe(false)
  })
  it('an item that could not be read says "Not checked", it is not shown as done or to do', () => {
    const { container } = show({ result: part })
    const rows = [...container.querySelectorAll('.setupcheck__item')]
    expect(rows[3]!.textContent).toContain('Not checked')
    expect(rows[3]!.className).toContain('setupcheck__item--unknown')
  })
})

describe('SetupChecklist: each row', () => {
  it('has a mark and a word, never colour alone', () => {
    const { container } = show({ result: partly })
    for (const row of container.querySelectorAll('.setupcheck__item')) {
      expect(row.querySelector('svg')).not.toBeNull()
      expect(row.querySelector('.setupcheck__state')?.textContent).toMatch(/^(Done|To do|Not checked)$/)
    }
  })
  it('links to the section that fixes it, and the unit link names the unit form', () => {
    const onGo = vi.fn()
    const { container } = show({ result: none, onGo })
    const links = [...container.querySelectorAll('a')] as HTMLAnchorElement[]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/setup?tab=people', '/setup?tab=days', '/setup?tab=templates', '/setup?tab=people'])
    fireEvent.click(links[0]!)
    expect(onGo).toHaveBeenLastCalledWith('people', 'add-unit')
    fireEvent.click(links[3]!)
    expect(onGo).toHaveBeenLastCalledWith('people', undefined)
  })
  it('a done row says "Open" and names what it opens for a screen reader', () => {
    const { container } = show({ result: all })
    const a = container.querySelector('a') as HTMLAnchorElement
    expect(a.textContent).toBe('Open')
    expect(a.getAttribute('aria-label')).toBe('Open Units')
  })
})

describe('AddPersonForm', () => {
  const units = [{ id: 'u1', name: 'Unit 1' }]
  const fill = (c: HTMLElement, label: string, value: string) => {
    const field = [...c.querySelectorAll('label.field')].find((l) => l.querySelector('span')?.textContent === label)
    fireEvent.change(field!.querySelector('input,select')!, { target: { value } })
  }

  it('shows the supervisor fields first, and swaps them when the role changes, keeping the name', () => {
    const { container, getByLabelText } = render(<AddPersonForm units={units} onAdd={async () => true} />)
    expect(container.textContent).toContain('Phone number')
    expect(container.textContent).not.toContain('Email')
    fill(container, 'Name', 'Meena')
    fireEvent.click(getByLabelText(/Merchandiser/))
    expect(container.textContent).toContain('Email')
    expect(container.textContent).toContain('Password (at least 10 characters)')
    expect(container.textContent).not.toContain('Phone number')
    expect((container.querySelector('label.field input') as HTMLInputElement).value).toBe('Meena')
  })
  it('does not send a supervisor that is not ready, and says why beside the button', () => {
    const onAdd = vi.fn(async () => true)
    const { container } = render(<AddPersonForm units={units} onAdd={onAdd} />)
    fireEvent.submit(container.querySelector('form')!)
    expect(onAdd).not.toHaveBeenCalled()
    expect(container.querySelector('[role=alert]')?.textContent).toBe("Enter the supervisor's name.")
  })
  it('sends a ready supervisor, then clears the fields but keeps the unit for the next one', async () => {
    const onAdd = vi.fn(async (_role: PersonRole, _fields: PersonFields) => true)
    const { container } = render(<AddPersonForm units={units} onAdd={onAdd} />)
    fill(container, 'Name', 'Meena'); fill(container, 'Phone number', '98765 43211'); fill(container, '4-digit PIN', '4821'); fill(container, 'Unit', 'u1')
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1))
    expect(onAdd.mock.calls[0]![0]).toBe('supervisor')
    await waitFor(() => expect((container.querySelector('label.field input') as HTMLInputElement).value).toBe(''))
    expect((container.querySelector('select') as HTMLSelectElement).value).toBe('u1')
  })
  it('keeps what was typed when the server refuses', async () => {
    const onAdd = vi.fn(async () => false)
    const { container } = render(<AddPersonForm units={units} onAdd={onAdd} />)
    fill(container, 'Name', 'Meena'); fill(container, 'Phone number', '98765 43211'); fill(container, '4-digit PIN', '4821'); fill(container, 'Unit', 'u1')
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(onAdd).toHaveBeenCalled())
    expect((container.querySelector('label.field input') as HTMLInputElement).value).toBe('Meena')
  })
  it('the radio itself is as big as the choice box, not a 20 px dot (npm run ux caught the first version under the tap size)', () => {
    const css = stripComments(read('../src/ui/organisms/AddPersonForm.css'))
    expect(css).toMatch(/\.addperson__choice input\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%/)
    expect(css).toMatch(/\.addperson__choice\s*\{[^}]*position:\s*relative;[^}]*min-height:\s*var\(--tap-primary\)/)
  })
  it('the button names the role it will add', () => {
    const { container, getByLabelText } = render(<AddPersonForm units={units} onAdd={async () => true} />)
    expect(container.querySelector('button')?.textContent).toBe('Add supervisor')
    fireEvent.click(getByLabelText(/Merchandiser/))
    expect(container.querySelector('button')?.textContent).toBe('Add merchandiser')
  })
})

describe('the People screen has one filled button', () => {
  const tab = read('../src/setup/PeopleTab.tsx')
  const form = read('../src/ui/organisms/AddPersonForm.tsx')
  it('the tab itself has no primary button: Save PIN and Add unit are plain', () => {
    expect(tab).not.toContain('btn--primary')
    expect(tab).toContain('<button className="btn">Add unit</button>')
  })
  it('the person form has exactly one', () => {
    expect(form.match(/btn--primary/g)).toHaveLength(1)
  })
  it('a unit is not a person: Add a unit stays its own form, with an anchor the checklist can reach', () => {
    expect(tab).toContain('<h2 id="add-unit" tabIndex={-1}>Add a unit</h2>')
    expect(tab).not.toMatch(/Add a supervisor|Add a merchandiser/)
  })
  it('the old two forms are gone', () => {
    expect(tab).not.toContain('addSupervisor')
    expect(tab).not.toContain('addMerchandiser')
    expect(tab).toContain('<AddPersonForm')
  })
})

describe('the Setup page', () => {
  const setup = read('../src/pages/Setup.tsx')
  it('a request to move focus waits for the section it names (the route can catch up a render later), so focus never lands on <body>', () => {
    expect(setup).toMatch(/pending\.current = \{ tab: section, anchor: at \?\? null \}/)
    expect(setup).toMatch(/if \(!p \|\| p\.tab !== tab\) return/)
    expect(setup).toMatch(/pending\.current = \{ tab: id, anchor: null \}; setParams/)
    expect(setup).not.toContain('changed.current')
  })
  it('shows the checklist above the section buttons', () => {
    expect(setup.indexOf('<SetupChecklist')).toBeGreaterThan(0)
    expect(setup.indexOf('<SetupChecklist')).toBeLessThan(setup.indexOf('<nav className="seg seg--tabs"'))
  })
  it('the People tab tells the checklist when it changed something', () => {
    expect(read('../src/setup/PeopleTab.tsx')).toContain('notifySetupChanged()')
  })
})

describe('the new styles: tokens only, no status colour, no tinted fill', () => {
  for (const f of ['SetupChecklist', 'AddPersonForm', 'AccountActivity']) {
    const css = stripComments(read(`../src/ui/organisms/${f}.css`))
    it(`${f}.css`, () => {
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|rgba\(|hsl\(/i)
      expect(css).not.toMatch(/status|tint|--(red|amber|green)/)
      expect(css).not.toMatch(/border-(left|right|inline-start|inline-end)\s*:/)
    })
  }
})
