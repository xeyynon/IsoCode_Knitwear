import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// UI/UX 2.0 phase 8B, after the user's feedback: a tinted or coloured card "feels generated". A status is an icon and a word in its colour
// (the badge pill keeps its own tint); a tile, a stage card, a board row or any other card stays a plain neutral surface.
// Theme sweep (8C): the guard now reads EVERY stylesheet under src, and red, amber and green are for order status only (frontendskill.md rule 10):
// a form error is ink with a "!" mark, not red.
const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const cssFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith('.css') ? [join(dir, e.name)] : []))
const rules = cssFiles(SRC).flatMap((f) => {
  const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const name = relative(SRC, f).replace(/\\/g, '/')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ file: name, selector: m[1]!.trim(), body: m[2]! }))
})
// Allowed to use a status colour: the small badge pill and its icon, and the status tiles' own icon and word.
const ALLOWED = /^(\.badge(--\w+)?( svg)?|\.statustile--(red|amber|green|grey) (\.statustile__head|svg))$/
const offends = (r: { selector: string }) => !r.selector.split(',').every((s) => ALLOWED.test(s.trim()))

describe('no status tint on a card, a tile or a row', () => {
  it('only the badge pill takes a status tint as a background', () => {
    const offenders = rules.filter((r) => /(background|background-color)\s*:[^;]*--status-\w+-tint/.test(r.body)).filter(offends)
    expect(offenders.map((r) => `${r.file}: ${r.selector}`)).toEqual([])
  })
  it('only the badge pill takes a status colour as a border or an outline (a field that did not pass its check is ink, not red)', () => {
    const offenders = rules.filter((r) => /(border|outline)[\w-]*\s*:[^;]*--status-(red|amber|green|grey)(?![\w-])/.test(r.body)).filter(offends)
    expect(offenders.map((r) => `${r.file}: ${r.selector}`)).toEqual([])
  })
  it('red, amber and green are not used as text colour outside a status badge or tile (form errors included)', () => {
    const offenders = rules.filter((r) => /(^|[;\s])color\s*:[^;]*--status-(red|amber|green)(-text)?(?![\w-])/.test(r.body)).filter(offends)
    expect(offenders.map((r) => `${r.file}: ${r.selector}`)).toEqual([])
  })
  it('a status tile, a stage card and a board row have no status rule of their own for a fill', () => {
    const named = rules.filter((r) => /\.statustile--(red|amber|green|grey)\s*$|\.stagecard--\w+\s*$|\.row--\w+( td)?(:hover td)?\s*$/.test(r.selector))
    for (const r of named) expect(r.body, `${r.selector} in ${r.file}`).not.toMatch(/background|border/)
  })
  it('the guard reads the stylesheets it should (a broken path would make it pass for nothing)', () => {
    const files = new Set(rules.map((r) => r.file))
    for (const f of ['styles.css', 'pages/Board.css', 'ui/organisms/StatusTiles.css', 'ui/organisms/StageCard.css', 'ui/molecules/ActionBar.css']) expect(files.has(f), f).toBe(true)
  })
})

describe('a form error is plain ink with a mark, so it still reads in greyscale and does not borrow the status colours', () => {
  const rule = (sel: string) => rules.find((r) => r.file === 'styles.css' && r.selector === sel)?.body ?? ''
  it('.error and .field__error are ink', () => {
    expect(rule('.error')).toMatch(/color:\s*var\(--ink\)/)
    expect(rule('.field__error')).toMatch(/color:\s*var\(--ink\)/)
  })
  it('both carry a "!" mark before the words', () => {
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
    expect(css).toMatch(/\.error::before,\s*\.field__error::before\s*\{[^}]*content:\s*'!'/)
  })
  it("an invalid field has a heavy ink border (the same look as the supervisor's 'asking' field)", () => {
    expect(rule(".input[aria-invalid='true']")).toMatch(/border-color:\s*var\(--ink\)/)
  })
})
