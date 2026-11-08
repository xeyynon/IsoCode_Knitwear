// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { InlineUndo } from '../src/ui/molecules/InlineUndo'

// UI/UX plan, slice 4.1: an Undo line in the page where the card was. States: idle (words + Undo), working (Undo disabled, "Undoing..."),
// failed (the words of the failure under it, in an alert), failed for good (the words only: no button, retrying cannot help).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = read('../src/ui/molecules/InlineUndo.css').replace(/\/\*[\s\S]*?\*\//g, '')

const line = (p: Partial<Parameters<typeof InlineUndo>[0]> = {}) => {
  const onUndo = vi.fn()
  const r = render(<ul><InlineUndo label="B-PO-88240 · Sewing hidden. Buyer B will not see it." onUndo={onUndo} {...p} /></ul>)
  return { ...r, onUndo, li: r.container.querySelector('li') as HTMLElement, button: () => r.container.querySelector('button') as HTMLButtonElement | null }
}

describe('InlineUndo states', () => {
  it('idle: the words and an Undo button that asks to undo, once per click', () => {
    const { li, button, onUndo } = line()
    expect(li.textContent).toContain('B-PO-88240 · Sewing hidden. Buyer B will not see it.')
    expect(button()!.textContent).toBe('Undo')
    expect(button()!.disabled).toBe(false)
    fireEvent.click(button()!)
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(li.querySelector('[role=alert]')).toBeNull()
  })
  it('working: the button is disabled and says so, so a second click cannot send a second request', () => {
    const { button } = line({ busy: true })
    expect(button()!.disabled).toBe(true)
    expect(button()!.textContent).toBe('Undoing…')
  })
  it('failed: the words of the failure sit in the same line, announced, and the button is still there to try again', () => {
    const { li, button } = line({ error: 'Could not undo. Try again.' })
    expect(li.querySelector('[role=alert]')!.textContent).toBe('Could not undo. Try again.')
    expect(button()!.disabled).toBe(false)
  })
  it('failed for good: the words stay and the button goes, because trying again cannot help', () => {
    const { li, button } = line({ error: 'This warning had been confirmed.', final: true })
    expect(li.querySelector('[role=alert]')!.textContent).toContain('confirmed')
    expect(button()).toBeNull()
  })
  it('the error is linked to the button, so a screen reader reads it with the control', () => {
    const { li, button } = line({ error: 'Could not undo. Try again.' })
    const id = li.querySelector('[role=alert]')!.id
    expect(id).toBeTruthy()
    expect(button()!.getAttribute('aria-describedby')).toBe(id)
  })
  it('the button names what it undoes (the words alone are not enough when there are several lines)', () => {
    const { button } = line()
    expect(button()!.getAttribute('aria-label')).toMatch(/Undo.*B-PO-88240/)
  })
})

describe('InlineUndo look', () => {
  it('has no timer, no animation and no status colour or tint (a calm line, not a toast)', () => {
    expect(css).not.toMatch(/animation|transition|@keyframes/)
    expect(css).not.toMatch(/status|tint|--red|--amber|--green/)
  })
})
