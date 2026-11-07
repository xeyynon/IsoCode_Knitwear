import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// UI/UX plan, slice 3.1 (audit 02, finding 1). Setup > People broke words in the middle at desktop width ("Merchandise" / "r",
// "Activ" / "e") and showed a bare dash for a missing name. Two causes: the shared small-table rule lets any word break anywhere
// (`.plan td { overflow-wrap: anywhere }`, also used by the buyer page and others), and the actions cell was itself a flex box,
// which stops a cell being a table cell. Source guards: the width behaviour is measured in a real browser by `npm run ux`.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const tab = read('../src/setup/PeopleTab.tsx')
const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')

describe('the People table markup', () => {
  it('keeps a word whole in the Role and State cells', () => {
    expect(tab).toMatch(/<td data-label="Role" className="people__nowrap">/)
    expect(tab).toMatch(/<td data-label="State" className="people__nowrap">/)
  })
  it('puts the action buttons in a box inside an ordinary table cell, not on the cell itself', () => {
    expect(tab).toMatch(/<td><div className="people__actions">/)
    expect(tab).not.toMatch(/<td className="people__actions">/)
  })
  it('says "(no name)" for an account with no name, not a bare dash', () => {
    expect(tab).toContain("a.label || '(no name)'")
  })
})

describe('the People table styles', () => {
  const at = (needle: string) => css.indexOf(needle)
  it('stop the shared rule that breaks anywhere from applying here, and come after it so they win', () => {
    expect(at('.people td, .people th')).toBeGreaterThan(at('.plan td {'))
    expect(css).toMatch(/\.people td, \.people th\s*\{[^}]*overflow-wrap:\s*normal/)
  })
  it('still let a long email address break, as emails must', () => {
    expect(css).toMatch(/\.people td\.mono\s*\{[^}]*overflow-wrap:\s*anywhere/)
  })
  it('never wrap the role and state words', () => {
    expect(css).toMatch(/\.people__nowrap\s*\{[^}]*white-space:\s*nowrap/)
  })
})

describe('the actions column on a wide screen', () => {
  it('has a fixed width so its buttons wrap inside it and the other columns keep room for their words (not on a phone, where each row is a card)', () => {
    expect(css).toMatch(/@media \(min-width: 721px\)\s*\{[^}]*\.people td:last-child\s*\{[^}]*width:\s*\d+px/)
  })
  it('keeps the unit name whole too', () => {
    expect(tab).toMatch(/<td data-label="Unit" className="people__nowrap">/)
  })
})
