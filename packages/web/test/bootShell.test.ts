import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// UI/UX plan, slice 4.5: measured on a slow connection (emulated Slow 3G, 4x slower processor) the first content came after 3.3 s,
// with a bare page until then. A word-free mark and ring in index.html fill that wait and the app replaces them when it mounts.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const html = read('../index.html').replace(/<!--[\s\S]*?-->/g, '')
const tokens = read('../../design/tokens.css')
// Two token sets: the default light one, and the dark one a person may choose (public/theme-init.js sets data-theme before the first paint).
const darkAt = tokens.indexOf(":root[data-theme='dark'] {")
const token = (name: string, set: 'light' | 'dark' = 'light') =>
  new RegExp(`${name}:[ ]*(#[0-9A-Fa-f]{6})`).exec(set === 'dark' ? tokens.slice(darkAt) : tokens.slice(0, darkAt))?.[1]?.toLowerCase()

describe('first-paint shell (index.html)', () => {
  const root = /<div id="root">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? ''
  it('sits inside the app root, so the app clears it when it mounts', () => {
    expect(root).toContain('id="boot"')
  })
  it('has no words (so no Tamil to guess)', () => {
    expect(root.replace(/<[^>]*>/g, '').trim()).toBe('')
  })
  it('stands still for a person who asked for less motion', () => {
    expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\)[^}]*\{[^}]*\.boot[^}]*animation:\s*none/)
  })
  it('is hidden from a screen reader (it says nothing a reader could use)', () => {
    expect(root).toContain('aria-hidden="true"')
  })
  it('uses the design tokens\' colours, written out because no stylesheet has loaded yet', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? ''
    const used = (style.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((c) => c.toLowerCase())
    expect(used.length).toBeGreaterThan(0)
    const allowed = ['--page', '--border', '--accent'].flatMap((n) => [token(n), token(n, 'dark')])
    for (const c of used) expect(allowed, c).toContain(c)
    expect(used).toContain(token('--page'))
    expect(used).toContain(token('--page', 'dark'))   // dark has its own page colour, so a person who chose dark sees no white flash
  })
})
