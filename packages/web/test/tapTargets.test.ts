import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Rule 13: on a phone every control is at least 44 px high. Text links and summaries are
// controls too: the back link is the only way out of Update, the PO link the only way into an order.
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
type Rule = { selectors: string[]; body: string; coarse: boolean }
// Top-level rules and the rules inside @media (pointer: coarse), in source order.
const rules: Rule[] = []
const parse = (text: string, coarse: boolean) => {
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    const head = text.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim()
    let depth = 1, j = open + 1
    for (; j < text.length && depth; j++) depth += text[j] === '{' ? 1 : text[j] === '}' ? -1 : 0
    const body = text.slice(open + 1, j - 1)
    if (head.startsWith('@media')) { if (head === '@media (pointer: coarse)') parse(body, true) }
    else if (!head.startsWith('@')) rules.push({ selectors: head.split(',').map((s) => s.trim()), body, coarse })
    i = j
  }
}
parse(css, false)
const decl = (r: Rule, prop: string) => new RegExp(`(^|;)\\s*${prop}:\\s*([^;]+)`).exec(r.body)?.[2]!.trim()
// What a coarse pointer ends up with for this one selector: the last rule that sets the property.
const effective = (sel: string, prop: string) => rules.filter((r) => r.selectors.includes(sel) && decl(r, prop) !== undefined).map((r) => decl(r, prop)).at(-1)

// Decision D2 (UI/UX plan, 8 Nov 2026): a phone is a coarse pointer and gets Android's 48 px; a mouse keeps 44 px.
// The number lives in one place, the token, and the controls that used to hard-code 44 px read it.
const tokens = readFileSync(new URL('../../design/tokens.css', import.meta.url), 'utf8')
describe('the tap minimum is one token: 44 px, and 48 px on a coarse pointer', () => {
  it('defaults to 44 px', () => {
    expect(/:root\s*\{[^}]*--tap-min:\s*44px/.test(tokens)).toBe(true)
  })
  it('is raised to 48 px when the pointer is coarse', () => {
    expect(/@media \(pointer: coarse\)\s*\{\s*:root\s*\{\s*--tap-min:\s*48px/.test(tokens)).toBe(true)
  })
  for (const sel of ['.input', '.seg__btn', '.menu__item']) {
    it(`${sel} takes its minimum height from the token, not a fixed 44px`, () => {
      expect(effective(sel, 'min-height')).toBe('var(--tap-min)')
    })
  }
})

// Rule 13: Send and the sign-in button are 56 px, also on a phone. The coarse-pointer `.btn` rule below is later in the
// file and has the same specificity as a bare `.btn--block`, so on a real phone it used to win and drop Send to 44 px
// (measured with touch emulation by `npm run ux`; a mouse-driven browser cannot see it). Two classes beat one.
describe('the full-width primary button keeps its 56 px on a phone', () => {
  it('is set by a rule more specific than the coarse-pointer .btn rule', () => {
    expect(effective('.btn.btn--block', 'min-height')).toBe('var(--tap-primary)')
  })
  it('has no bare .btn--block rule left that sets a height the coarse rule would beat', () => {
    expect(effective('.btn--block', 'min-height')).toBeUndefined()
  })
})

describe('touch targets on a coarse pointer', () => {
  for (const sel of ['.btn', '.chip', '.btn--small', '.link', '.po-link', 'summary']) {
    it(`raises ${sel} to the tap minimum`, () => {
      expect(effective(sel, 'min-height')).toBe('var(--tap-min)')
    })
  }
  for (const sel of ['.link', '.po-link']) {
    it(`centres the text of ${sel} in its taller box`, () => {
      expect(effective(sel, 'display')).toBe('inline-flex')
    })
  }
})
