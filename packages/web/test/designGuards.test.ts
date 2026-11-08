import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Design rule: tokens only. A colour is written once, in packages/design/tokens.css; a component asks for a
// token. Text on a filled control is a token too (--on-accent, --on-ink), so a button's text is never a literal "#fff".
// The same idea fails a build in the Dukaan Dost guide ("a test fails on any literal colour outside the token rules").
const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const css = readFileSync(join(SRC, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith('.tsx') ? [p] : []
  })
}
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

// a hex colour, or a functional colour. (An id selector such as #history is not hex: h is not a hex digit.)
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(/g

function filesWith(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? filesWith(p, ext) : p.endsWith(ext) ? [p] : []
  })
}

describe('no literal colour outside tokens.css', () => {
  it('styles.css uses tokens only', () => {
    expect(css.match(LITERAL) ?? []).toEqual([])
  })
  // a component may bring its own stylesheet (ui/molecules/ActionBar.css): the same rule
  for (const file of filesWith(SRC, '.css').filter((f) => !f.endsWith('styles.css'))) {
    const name = file.slice(SRC.length).replace(/\\/g, '/')
    it(`${name} uses tokens only`, () => {
      expect(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').match(LITERAL) ?? []).toEqual([])
    })
  }
  for (const file of tsxFiles(SRC)) {
    const name = file.slice(SRC.length).replace(/\\/g, '/')
    it(`${name} uses tokens only`, () => {
      expect(stripTsComments(readFileSync(file, 'utf8')).match(LITERAL) ?? []).toEqual([])
    })
  }
})

// The product is light only (floor screens are read in bright light). Declaring it keeps a phone browser's "dark mode for
// websites" from recolouring the status colours: red, amber and green must mean the same thing on every phone.
const tokens = readFileSync(new URL('../../design/tokens.css', import.meta.url), 'utf8')
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
describe('the colour scheme is declared as light', () => {
  it('tokens.css sets color-scheme: light on :root', () => {
    expect(/:root\s*\{[^}]*color-scheme:\s*light\b/.test(tokens)).toBe(true)
  })
  it('index.html says so before any style loads', () => {
    expect(/<meta\s+name="color-scheme"\s+content="light"\s*\/?>/.test(html)).toBe(true)
  })
})

describe('the tokens a component uses for text on a filled control exist', () => {
  for (const t of ['--on-accent', '--on-ink', '--border-soft', '--scrim', '--scrim-strong']) {
    it(`${t} is defined`, () => {
      expect(new RegExp(`${t}\\s*:`).test(tokens)).toBe(true)
    })
  }
})

// Seen on a real phone (8 Nov 2026): Chrome offered "Translate page? Tamil to English" on the supervisor's Today screen, because the
// phone's own language was English. Accepting it would machine-translate our Tamil (and the status words) into something nobody
// checked. The app has its own language switch, so the browser's offer is switched off.
describe('the browser is not offered a translation of the page', () => {
  it('index.html says notranslate', () => {
    expect(/<meta\s+name="google"\s+content="notranslate"\s*\/?>/.test(html)).toBe(true)
  })
})
