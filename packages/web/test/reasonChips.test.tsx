// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { DEFAULT_REASONS, toggleReasons } from '../src/notes/reasons'
import { ReasonChips } from '../src/ui/molecules/ReasonChips'

// The form review: "Why is it slow?" takes one reason or several. Chips are toggles, a second tap removes only that one.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

function Harness({ onChange }: { onChange?: (s: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <ReasonChips legend="Why is it slow? (optional)" reasons={DEFAULT_REASONS} lang="en" selected={selected} countText={(n) => `${n} selected`}
      onToggle={(id) => { const next = toggleReasons(selected, id); setSelected(next); onChange?.(next) }} />
  )
}

afterEach(cleanup)

describe('ReasonChips', () => {
  it('shows the seven reasons as checkboxes in one named group', () => {
    render(<Harness />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(7)
    expect(screen.getByRole('group', { name: 'Why is it slow? (optional)' })).toBeTruthy()
    for (const r of DEFAULT_REASONS) expect(screen.getByLabelText(r.en)).toBeTruthy()
  })
  it('selecting a second reason keeps the first, and the order of the taps is kept', () => {
    const seen = vi.fn()
    render(<Harness onChange={seen} />)
    fireEvent.click(screen.getByLabelText('Machine problem'))
    fireEvent.click(screen.getByLabelText('Not enough workers'))
    fireEvent.click(screen.getByLabelText('Material is late'))
    expect(seen).toHaveBeenLastCalledWith(['machine', 'labour', 'material'])
    for (const l of ['Machine problem', 'Not enough workers', 'Material is late']) expect((screen.getByLabelText(l) as HTMLInputElement).checked, l).toBe(true)
    expect((screen.getByLabelText('No power') as HTMLInputElement).checked).toBe(false)
  })
  it('deselecting one leaves the others as they were', () => {
    const seen = vi.fn()
    render(<Harness onChange={seen} />)
    for (const l of ['Machine problem', 'Not enough workers', 'No power']) fireEvent.click(screen.getByLabelText(l))
    fireEvent.click(screen.getByLabelText('Not enough workers'))
    expect(seen).toHaveBeenLastCalledWith(['machine', 'power'])
    expect((screen.getByLabelText('Not enough workers') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('Machine problem') as HTMLInputElement).checked).toBe(true)
  })
  it('says how many are selected, quietly and only when some are', () => {
    const { container } = render(<Harness />)
    expect(container.querySelector('.reasons__count')?.textContent ?? '').toBe('')
    fireEvent.click(screen.getByLabelText('Machine problem'))
    fireEvent.click(screen.getByLabelText('No power'))
    const count = container.querySelector('.reasons__count')!
    expect(count.textContent).toBe('2 selected')
    expect(count.getAttribute('aria-live')).toBe('polite')
  })
  it('the selected look is still the check mark plus the action colour (never colour alone)', () => {
    const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.reason input:checked \+ \.reason__pill\s*\{[^}]*background:\s*var\(--accent\)/)
    expect(css).toMatch(/\.reason input:checked \+ \.reason__pill::before\s*\{[^}]*content:\s*"\\2713"/)
  })
  it('keeps the class names the narrow-screen rules rely on', () => {
    const { container } = render(<Harness />)
    expect(container.querySelector('fieldset.reasons .reasons__list label.reason .reason__pill')).not.toBeNull()
  })
})
