// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { THEME_COLOURS, THEME_KEY, applyTheme, currentTheme, readTheme, saveTheme, setTheme } from '../src/ui/theme'
import { ThemeMenuItem } from '../src/ui/ThemeMenuItem'
import { strings } from '../src/i18n'

// Dark mode is a choice made in the menu and kept on the device (localStorage `orders.theme`). Light is the default; nothing else turns dark on.
// (read through a function: inside jsdom, Vite rewrites a literal new URL('...', import.meta.url) into an http address)
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const tokens = read('../../design/tokens.css')
const initSource = read('../public/theme-init.js')

function meta(): HTMLMetaElement {
  let m = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
  if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; m.content = THEME_COLOURS.light; document.head.append(m) }
  return m
}

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); meta().content = THEME_COLOURS.light })
afterEach(() => { cleanup(); localStorage.clear(); document.documentElement.removeAttribute('data-theme') })

describe('the theme module', () => {
  it('is light unless dark was chosen: nothing stored, junk stored, or storage that throws', () => {
    expect(readTheme()).toBe('light')
    localStorage.setItem(THEME_KEY, 'purple')
    expect(readTheme()).toBe('light')
    expect(readTheme({ getItem: () => { throw new Error('blocked') } })).toBe('light')
    localStorage.setItem(THEME_KEY, 'dark')
    expect(readTheme()).toBe('dark')
  })
  it('applies by an attribute on <html>, and says so to the phone\'s address bar (theme-color)', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(currentTheme()).toBe('dark')
    expect(meta().content).toBe(THEME_COLOURS.dark)
    applyTheme('light')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(meta().content).toBe(THEME_COLOURS.light)
  })
  it('saves the choice, and a storage that throws does not break the page', () => {
    saveTheme('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(() => saveTheme('dark', { setItem: () => { throw new Error('private window') } })).not.toThrow()
  })
  it('setTheme applies and saves in one step', () => {
    setTheme('dark')
    expect(currentTheme()).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })
  it('the address-bar colours are the page colours of the two token sets', () => {
    const colour = (css: string) => /--page:\s*(#[0-9A-Fa-f]{6})/.exec(css)?.[1]?.toLowerCase()
    const darkAt = tokens.indexOf(":root[data-theme='dark'] {")
    expect(colour(tokens.slice(0, darkAt))).toBe(THEME_COLOURS.light.toLowerCase())
    expect(colour(tokens.slice(darkAt))).toBe(THEME_COLOURS.dark.toLowerCase())
  })
})

describe('theme-init.js (the first thing the page runs: no inline script is allowed, so it is a file)', () => {
  const run = (storage: { getItem: (k: string) => string | null } | null) => {
    const attrs: Record<string, string> = {}
    const m = { content: '' }
    const documentElement = { setAttribute: (k: string, v: string) => { attrs[k] = v } }
    const doc = { documentElement, querySelector: (sel: string) => (sel.includes('theme-color') ? { setAttribute: (_k: string, v: string) => { m.content = v } } : null) }
    const win = storage === null
      ? { get localStorage(): never { throw new Error('blocked') }, document: doc }
      : { localStorage: storage, document: doc }
    runInNewContext(initSource, { document: doc, window: win })
    return { attrs, meta: m.content }
  }
  it('sets dark when dark was saved, and the address-bar colour with it', () => {
    const r = run({ getItem: (k) => (k === THEME_KEY ? 'dark' : null) })
    expect(r.attrs['data-theme']).toBe('dark')
    expect(r.meta).toBe(THEME_COLOURS.dark)
  })
  it('does nothing for light, for an unknown value, and when storage is blocked', () => {
    expect(run({ getItem: () => null }).attrs).toEqual({})
    expect(run({ getItem: () => 'neon' }).attrs).toEqual({})
    expect(run(null).attrs).toEqual({})
  })
  it('reads no device setting', () => {
    expect(initSource).not.toMatch(/matchMedia|prefers-color-scheme/)
  })
})

describe('the menu item', () => {
  it('offers the other theme, switches on a click, keeps it, and closes the menu through its callback', () => {
    let closed = 0
    render(<ThemeMenuItem onChosen={() => { closed++ }} />)
    const item = screen.getByRole('menuitem')
    expect(item.textContent).toBe(strings.en['nav.darkTheme'])
    fireEvent.click(item)
    expect(currentTheme()).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(closed).toBe(1)
    expect(screen.getByRole('menuitem').textContent).toBe(strings.en['nav.lightTheme'])
    fireEvent.click(screen.getByRole('menuitem'))
    expect(currentTheme()).toBe('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
  })
  it('follows a change made elsewhere (another menu, another tab\'s script)', () => {
    render(<ThemeMenuItem onChosen={() => undefined} />)
    act(() => { setTheme('dark') })
    expect(screen.getByRole('menuitem').textContent).toBe(strings.en['nav.lightTheme'])
  })
  it('has Tamil for a supervisor, drafted and marked', () => {
    expect(strings.ta['nav.darkTheme']).toBeTruthy()
    expect(strings.ta['nav.lightTheme']).toBeTruthy()
    expect(read('../src/i18n.ts')).toMatch(/'nav\.darkTheme':[^\n]*DRAFT, unreviewed/)
  })
})
