import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { languageAfterSignIn, parseStoredLang } from '../src/langRules'

describe('which language a person starts in', () => {
  it('a supervisor with no stored choice starts in Tamil, and it counts as a default', () => {
    expect(languageAfterSignIn('supervisor', parseStoredLang(null, null))).toEqual({ lang: 'ta', chosen: false })
  })

  it('a supervisor who chose English keeps English', () => {
    // the language switch writes the language and no "default" marker
    expect(languageAfterSignIn('supervisor', parseStoredLang('en', null))).toEqual({ lang: 'en', chosen: true })
  })

  it('a supervisor who chose Tamil keeps Tamil', () => {
    expect(languageAfterSignIn('supervisor', parseStoredLang('ta', null))).toEqual({ lang: 'ta', chosen: true })
  })

  it('a merchandiser with no stored choice stays in English', () => {
    expect(languageAfterSignIn('merchandiser', parseStoredLang(null, null))).toEqual({ lang: 'en', chosen: false })
  })

  it('a merchandiser is in English even if Tamil was stored (their screens are English only; final cycle W-4)', () => {
    expect(languageAfterSignIn('merchandiser', parseStoredLang('ta', null))).toEqual({ lang: 'en', chosen: false })
  })

  it('a stored value from before this rule existed is a choice, because only the switch ever wrote it', () => {
    expect(parseStoredLang('en', null).chosen).toBe(true)
    expect(parseStoredLang('ta', null).chosen).toBe(true)
  })

  it("a default left by an earlier sign-in is replaced by the next person's default", () => {
    const left = parseStoredLang('ta', 'default')
    expect(left).toEqual({ lang: 'ta', chosen: false })
    expect(languageAfterSignIn('merchandiser', left)).toEqual({ lang: 'en', chosen: false })
    expect(languageAfterSignIn('supervisor', parseStoredLang('en', 'default'))).toEqual({ lang: 'ta', chosen: false })
  })

  it('anything unreadable counts as nobody having chosen', () => {
    expect(parseStoredLang('fr', null)).toEqual({ lang: null, chosen: false })
    expect(parseStoredLang('', 'default')).toEqual({ lang: null, chosen: false })
    expect(languageAfterSignIn('supervisor', parseStoredLang('fr', null))).toEqual({ lang: 'ta', chosen: false })
  })
})

// The same rules as the app applies them: through i18n.ts, with a stand-in for the browser's storage.
describe('the language the app shows', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    vi.resetModules()
    vi.stubGlobal('window', { localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    } })
  })
  afterEach(() => { vi.unstubAllGlobals() })
  const load = () => import('../src/i18n')

  it('a supervisor with no choice gets Tamil, and still has no choice stored', async () => {
    const i = await load()
    expect(i.getLang()).toBe('en')
    i.applySignInLanguage('supervisor')
    expect(i.getLang()).toBe('ta')
    expect(store.get('orders.lang.src')).toBe('default')
  })

  it('a merchandiser with no choice stays in English', async () => {
    const i = await load()
    i.applySignInLanguage('merchandiser')
    expect(i.getLang()).toBe('en')
  })

  it('a choice from the language switch wins over the default, even after signing in again', async () => {
    const i = await load()
    i.setLang('en')
    i.applySignInLanguage('supervisor')
    expect(i.getLang()).toBe('en')
    expect(store.get('orders.lang.src')).toBeUndefined()
  })

  it('choosing after a default turns the default into a choice', async () => {
    const i = await load()
    i.applySignInLanguage('supervisor')
    i.setLang('en')
    expect(store.get('orders.lang.src')).toBeUndefined()
    i.applySignInLanguage('supervisor')
    expect(i.getLang()).toBe('en')
  })

  it('a supervisor who chose English still has English on the next visit (a fresh page load)', async () => {
    const first = await load()
    first.setLang('en')
    vi.resetModules()
    const again = await load()
    again.applySignInLanguage('supervisor')
    expect(again.getLang()).toBe('en')
  })

  it('a default Tamil is replaced when a merchandiser signs in on the same phone', async () => {
    const i = await load()
    i.applySignInLanguage('supervisor')
    i.applySignInLanguage('merchandiser')
    expect(i.getLang()).toBe('en')
  })

  it('a default Tamil is remembered on the next visit, so the sign-in screen is already Tamil', async () => {
    const first = await load()
    first.applySignInLanguage('supervisor')
    vi.resetModules()
    const again = await load()
    expect(again.getLang()).toBe('ta')
  })

  it('signing out does not touch the language', async () => {
    const session = await import('../src/api/session')
    const i = await load()
    i.setLang('ta')
    session.signOut()
    expect(store.get('orders.lang')).toBe('ta')
    expect(i.getLang()).toBe('ta')
  })
})
