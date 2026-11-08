import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// AUDIT-03, finding 1 (S2): at 195 px wide (a 390 px phone at 200% zoom, or the largest phone font) the supervisor's hero cards pushed
// the order number and the "Left" figure out of the card, in Tamil by 24 px, and the page did not scroll sideways, so nothing saw it.
// The layout answer is one set of rules for "very narrow" (260 px and less), each beside its component; `npm run ux` now measures
// content past its own box at 195 px for Today and Update in both languages (section 6 of scripts/ux_metrics.ts).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const narrow = (css: string) => /@media \(max-width: 260px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

describe('very narrow screens (260 px and less)', () => {
  it('Today hero: the ring sits above the words instead of beside them', () => {
    expect(narrow(read('../src/ui/organisms/TodayHero.css'))).toMatch(/\.todayhero__main\s*\{[^}]*flex-direction:\s*column/)
  })
  it('Update hero: the ring sits above the order number, the figures stack, the order number can shrink', () => {
    const css = narrow(read('../src/ui/organisms/UpdateHero.css'))
    expect(css).toMatch(/\.updatehero__top\s*\{[^}]*flex-direction:\s*column/)
    expect(css).toMatch(/\.updatehero__nums\s*\{[^}]*grid-template-columns:\s*1fr\s*;/)
    expect(css).toMatch(/h1\s*\{[^}]*font-size:\s*clamp\(/)
  })
  it('Update screen: a button label may wrap rather than push past the card', () => {
    expect(narrow(read('../src/ui/organisms/UpdateHero.css'))).toMatch(/\.update \.btn\s*\{[^}]*white-space:\s*normal/)
  })
  it('Update screen: the reasons fieldset may shrink (a fieldset is as wide as its widest content by default) and its pills wrap', () => {
    const css = narrow(read('../src/ui/organisms/UpdateHero.css'))
    expect(css).toMatch(/\.update \.reasons\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.update \.reason__pill\s*\{[^}]*white-space:\s*normal/)
  })
  it('app bar: the brand line is dropped and the title wraps', () => {
    const css = narrow(read('../src/ui/AppBar.css'))
    expect(css).toMatch(/\.appbar__brand\s*\{[^}]*display:\s*none/)
    expect(css).toMatch(/\.appbar__title\s*\{[^}]*overflow-wrap:\s*anywhere/)
  })
  it('sync chip: the words may wrap (a long Tamil "all sent" was wider than the screen)', () => {
    expect(narrow(read('../src/ui/SyncChip.css'))).toMatch(/\.sync\s*\{[^}]*white-space:\s*normal/)
  })
})

describe('npm run ux can see this class of bug', () => {
  const ux = readFileSync(new URL('../../../scripts/ux_metrics.ts', import.meta.url), 'utf8')
  it('measures content past its own box at 195 px for Today and Update in English and Tamil', () => {
    expect(ux).toContain('width: 195')
    expect(ux).toContain('Content past its own box at 195 px')
    expect(ux).toMatch(/scrollWidth - el\.clientWidth/)
    expect(ux).toMatch(/for \(const lang of \['en', 'ta'\] as const\)[\s\S]{0,400}width: 195/)
  })
})
