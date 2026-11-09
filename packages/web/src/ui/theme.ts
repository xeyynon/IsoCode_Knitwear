import { useSyncExternalStore } from 'react'

/**
 * Light by default; dark only when the person chose it in the menu (kept on this device in localStorage `orders.theme`, applied as
 * data-theme="dark" on <html>). The device's own dark setting is deliberately never read: the floor reads these screens in bright
 * light, and red, amber and green must look the same on every phone (frontendskill.md). public/theme-init.js applies the saved theme
 * before the first paint (no inline script is allowed by the Content-Security-Policy); this module does the same after the app starts,
 * and lets the menu change it. Storage can be blocked (a private window): every read and write is guarded, and the page stays light.
 */
export type Theme = 'light' | 'dark'

export const THEME_KEY = 'orders.theme'

/** The browser's address-bar colour for each theme: the --page token of each set (test/theme.test.tsx keeps them equal). */
export const THEME_COLOURS: Record<Theme, string> = { light: '#F6F5F9', dark: '#15141B' }

const CHANGED = 'orders:theme'

/** Dark only when 'dark' is what was saved; nothing saved, anything else, or storage that throws is light. */
export function readTheme(storage?: Pick<Storage, 'getItem'>): Theme {
  try {
    return (storage ?? window.localStorage).getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function currentTheme(doc: Document = document): Theme {
  return doc.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

/** Puts the theme on the page: the attribute on <html>, and the address-bar colour. Light is the absence of the attribute. */
export function applyTheme(theme: Theme, doc: Document = document): void {
  if (theme === 'dark') doc.documentElement.setAttribute('data-theme', 'dark')
  else doc.documentElement.removeAttribute('data-theme')
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOURS[theme])
}

export function saveTheme(theme: Theme, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(THEME_KEY, theme)
  } catch { /* storage blocked: the choice lasts until the page is closed */ }
}

/** The menu's choice: apply it, keep it, and tell every part of the page that shows it. */
export function setTheme(theme: Theme): void {
  applyTheme(theme)
  saveTheme(theme)
  window.dispatchEvent(new Event(CHANGED))
}

/** At start-up: make the page match what was saved (theme-init.js has usually done it already). */
export function startTheme(): void {
  applyTheme(readTheme())
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange)
  window.addEventListener('storage', onChange)   // another tab changed it
  return () => { window.removeEventListener(CHANGED, onChange); window.removeEventListener('storage', onChange) }
}

/** The theme in use, kept up to date when it changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => currentTheme(), () => 'light')
}
