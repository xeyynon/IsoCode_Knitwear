import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// UI/UX 2.0 phase 8B, after the user's feedback: a tinted or coloured card "feels generated". A status is an icon and a word in its colour
// (the badge pill keeps its own tint); a tile, a stage card, a board row or any other card stays a plain neutral surface.
const FILES = ['../src/styles.css', '../src/pages/Board.css', '../src/ui/organisms/StatusTiles.css', '../src/ui/organisms/OrderBento.css', '../src/ui/organisms/KeyFacts.css']
const rules = FILES.flatMap((f) => {
  const css = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ file: f, selector: m[1]!.trim(), body: m[2]! }))
})
// Allowed to use a status colour as a fill or an edge: the small badge pill, and the field that did not pass its check.
const ALLOWED = /^(\.badge(--\w+)?( svg)?|\.input\[aria-invalid='true'\])$/

describe('no status tint on a card, a tile or a row', () => {
  it('only the badge pill takes a status tint as a background', () => {
    const offenders = rules.filter((r) => /(background|background-color)\s*:[^;]*--status-\w+-tint/.test(r.body)).filter((r) => !r.selector.split(',').every((s) => ALLOWED.test(s.trim())))
    expect(offenders.map((r) => `${r.file}: ${r.selector}`)).toEqual([])
  })
  it('only the badge pill and an invalid field take a status colour as a border or an outline', () => {
    const offenders = rules.filter((r) => /(border|outline)[\w-]*\s*:[^;]*--status-(red|amber|green|grey)(?![\w-])/.test(r.body)).filter((r) => !r.selector.split(',').every((s) => ALLOWED.test(s.trim())))
    expect(offenders.map((r) => `${r.file}: ${r.selector}`)).toEqual([])
  })
  it('a status tile, a stage card and a board row have no status rule of their own for a fill', () => {
    const named = rules.filter((r) => /\.statustile--(red|amber|green|grey)\s*$|\.stagecard--\w+\s*$|\.row--\w+( td)?(:hover td)?\s*$/.test(r.selector))
    for (const r of named) expect(r.body, `${r.selector} in ${r.file}`).not.toMatch(/background|border/)
  })
})
