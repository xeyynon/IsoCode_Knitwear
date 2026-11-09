// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PopoverMenu } from '../src/ui/molecules/PopoverMenu'

// The one menu behaviour for the whole app (top bar guide, section 7): focus enters on open, arrows wrap, Home/End, Esc closes and gives the
// focus back (and goes no further), Tab and an outside click close it. Each was shown to fail first.
afterEach(cleanup)
const mount = (outerKey = vi.fn()) => {
  render(
    <div onKeyDown={outerKey}>
      <button>before</button>
      <PopoverMenu label="Menu" menuLabel="Account" icon={<span>menu</span>}>
        {(close) => (
          <>
            <button role="menuitem" onClick={() => close(true)}>One</button>
            <button role="menuitem">Two</button>
            <button role="menuitem">Three</button>
          </>
        )}
      </PopoverMenu>
    </div>,
  )
  return { trigger: screen.getByRole('button', { name: 'Menu' }), outerKey }
}
const open = (trigger: HTMLElement) => fireEvent.click(trigger)
const items = () => screen.getAllByRole('menuitem')

describe('PopoverMenu', () => {
  it('is closed at first, and the button says so', () => {
    const { trigger } = mount()
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('opens a labelled menu and moves focus to its first item', () => {
    const { trigger } = mount()
    open(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menu', { name: 'Account' })).toBeTruthy()
    expect(document.activeElement).toBe(items()[0])
  })
  it('arrow keys move and wrap, Home and End jump', () => {
    const { trigger } = mount()
    open(trigger)
    const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k })
    key('ArrowDown')
    expect(document.activeElement).toBe(items()[1])
    key('ArrowDown')
    key('ArrowDown')
    expect(document.activeElement).toBe(items()[0]) // wrapped
    key('ArrowUp')
    expect(document.activeElement).toBe(items()[2]) // wrapped the other way
    key('Home')
    expect(document.activeElement).toBe(items()[0])
    key('End')
    expect(document.activeElement).toBe(items()[2])
  })
  it('Esc closes, gives the focus back to the button, and does not reach anything outside (one press, one step)', () => {
    const { trigger, outerKey } = mount()
    open(trigger)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(outerKey).not.toHaveBeenCalled()
  })
  it('Tab closes it', () => {
    const { trigger } = mount()
    open(trigger)
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('a click outside closes it, a click inside does not', () => {
    const { trigger } = mount()
    open(trigger)
    fireEvent.mouseDown(items()[1]!)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(screen.getByText('before'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('a row can close it and give the focus back through the close function it is handed', () => {
    const { trigger } = mount()
    open(trigger)
    fireEvent.click(items()[0]!)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
  it('the same button opens and closes it', () => {
    const { trigger } = mount()
    open(trigger)
    open(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
