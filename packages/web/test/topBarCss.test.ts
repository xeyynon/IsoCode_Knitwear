import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// The top bar's stylesheets (the ORCA guide, adapted). What a unit test cannot show in a browser, it can pin in the text: the shapes, the tokens, the
// motion rules. `npm run ux` measures the rest in a real browser (scripts/topbar_metrics.ts).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const bar = strip(read('../src/ui/AppBar.css'))
const tabs = strip(read('../src/ui/molecules/NavTabs.css'))
const tokens = read('../../design/tokens.css')
const rule = (css: string, sel: string) => css.split('}').map((r) => r.trim()).find((r) => r.startsWith(`${sel} {`) || r.startsWith(`${sel}{`)) ?? ''

describe('three shapes on the page, not one strip', () => {
  it('the bar is a grid whose middle column is centred on the screen whatever the sides hold', () => {
    expect(rule(bar, '.appbar')).toMatch(/grid-template-columns:\s*1fr auto 1fr/)
  })
  it('the page shows between the shapes: the bar has the page colour, sticks to the top, and sits above the content', () => {
    const r = rule(bar, '.appbar')
    expect(r).toMatch(/background:\s*var\(--page\)/)
    expect(r).toMatch(/position:\s*sticky/)
    expect(r).toMatch(/top:\s*0/)
    expect(r).toMatch(/z-index:\s*1\d/)
  })
  it('the left capsule is flush with the left edge and rounded on the right; the right one the other way round', () => {
    expect(rule(bar, '.appbar__left')).toMatch(/border-left:\s*0/)
    expect(rule(bar, '.appbar__left')).toMatch(/border-radius:\s*0 var\(--radius-pill\) var\(--radius-pill\) 0/)
    expect(rule(bar, '.appbar__right')).toMatch(/border-right:\s*0/)
    expect(rule(bar, '.appbar__right')).toMatch(/border-radius:\s*var\(--radius-pill\) 0 0 var\(--radius-pill\)/)
  })
  it('the centre tab hangs from the top edge and is rounded at the bottom', () => {
    expect(rule(bar, '.appbar__center')).toMatch(/border-top:\s*0/)
    expect(rule(bar, '.appbar__center')).toMatch(/border-radius:\s*0 0 var\(--radius-xl\) var\(--radius-xl\)/)
  })
  it('the three share one surface and one hairline, from the tokens', () => {
    const shared = bar.split('}').find((r) => r.includes('.appbar__left') && r.includes('.appbar__right') && r.includes('.appbar__center')) ?? ''
    expect(shared).toMatch(/border:\s*1px solid var\(--border\)/)
    expect(shared).toMatch(/background:\s*var\(--surface\)/)
  })
  it('no accent bar down one edge of anything: the flush edges are a shape, not a stripe', () => {
    for (const css of [bar, tabs]) {
      expect(css).not.toMatch(/border-(left|right|inline-start|inline-end)\s*:\s*[2-9]px/)
      expect(css).not.toMatch(/border-(left|right)(-width)?\s*:\s*[2-9]px solid var\(--(accent|status)/)
    }
  })
})

describe('tokens only, light and dark', () => {
  it('no literal colour in the bar or the tabs', () => {
    for (const css of [bar, tabs]) expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })
  it('every token the bar uses exists in tokens.css (colours also in the dark block)', () => {
    const cut = tokens.indexOf("\n:root[data-theme='dark'] {")
    const light = tokens.slice(0, cut)
    const dark = tokens.slice(cut)
    const used = new Set([...(bar + tabs).matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]!))
    for (const name of used) {
      if (name === 'appbar-h') continue // set by the bar itself
      expect(light, `--${name} in the light set`).toMatch(new RegExp(`--${name}:`))
      const isColour = /^(page|surface|ink|muted|border|border-soft|accent|accent-soft|on-accent|on-ink|scrim)$/.test(name)
      if (isColour) expect(dark, `--${name} in the dark set`).toMatch(new RegExp(`--${name}:`))
    }
  })
})

describe('motion: a quiet entrance, once, and none when asked for less', () => {
  it('the entrance is transform and opacity only, 260 ms, and uses fill-mode backwards (a forwards fill leaves a transform that traps positioned children)', () => {
    expect(bar).toMatch(/\.appbar--enter \.appbar__left\s*\{[^}]*animation:\s*appbar-from-left 260ms[^}]*backwards/)
    expect(bar).toMatch(/\.appbar--enter \.appbar__right\s*\{[^}]*animation:\s*appbar-from-right 260ms[^}]*backwards/)
    expect(bar).toMatch(/\.appbar--enter \.appbar__center\s*\{[^}]*animation:\s*appbar-from-top 260ms[^}]*backwards/)
    for (const k of bar.matchAll(/@keyframes appbar-[a-z-]+\s*\{([\s\S]*?\})\s*\}/g)) expect(k[1]).not.toMatch(/(top|left|right|width|height|margin|box-shadow)\s*:/)
    expect(bar).not.toMatch(/animation[^;]*\bforwards\b|animation[^;]*\bboth\b/)
  })
  it('the entrance is off under prefers-reduced-motion', () => {
    expect(bar).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.appbar--enter[^}]*animation:\s*none/)
  })
  it('only the entrance moves: the bar has no other animation', () => {
    expect(bar.match(/animation\s*:/g)?.length ?? 0).toBe(4) // three entrances and the reduced-motion off switch
  })
})

describe('the views', () => {
  it('a view is at least the tap minimum high, and the current one has a 2 px underline and a heavier label', () => {
    expect(rule(tabs, '.navtab')).toMatch(/min-height:\s*var\(--tap-min\)/)
    expect(rule(tabs, ".navtab[aria-current='page']")).toMatch(/font-weight:\s*7\d\d/)
    expect(tabs).toMatch(/\.navtab::after\s*\{[^}]*height:\s*2px/)
  })
  it('below 1100 px the views are a full-width band that scrolls sideways, with natural-width tabs', () => {
    const narrow = tabs + bar
    expect(narrow).toMatch(/@media \(max-width: 1100px\)/)
    expect(narrow).toMatch(/overflow-x:\s*auto/)
    expect(narrow).toMatch(/\.navtab\s*\{[^}]*flex:\s*none/)
  })
})

describe('the menu button inside its capsule', () => {
  it('has no outline or fill of its own (a box inside a capsule read as clutter), and a neutral wash on hover', () => {
    expect(rule(bar, '.appbar__right .btn')).toMatch(/border-color:\s*transparent/)
    expect(rule(bar, '.appbar__right .btn')).toMatch(/background:\s*transparent/)
    expect(rule(bar, '.appbar__right .btn:hover')).toMatch(/background:\s*var\(--page\)/)
  })
})

describe('the side capsules are tap targets', () => {
  it('the brand link and the menu capsule are as tall as the tap size (44 px with a mouse, 48 px on a phone), not a fixed 44 (npm run ux found 44 on touch)', () => {
    expect(rule(bar, '.appbar__left')).toMatch(/height:\s*var\(--tap-min\)/)
    expect(rule(bar, '.appbar__right')).toMatch(/height:\s*var\(--tap-min\)/)
  })
})
