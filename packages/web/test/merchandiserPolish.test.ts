import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { reviewSummary } from '../src/review/reviewLogic'
import { checkedText } from '../src/statusRules'

// UI/UX plan, slices 3.7 to 3.10 (audit 02: findings 8, 11 and 12, and the accent-stripe rule). Small, visible, and each shown to fail first.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const review = read('../src/pages/Review.tsx')
const status = read('../src/pages/Status.tsx')
const setup = read('../src/pages/OrderSetup.tsx')
const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')

describe('3.7 Review: two sections, two names', () => {
  it('the photos and the warnings that buyers can see no longer share a near-identical heading', () => {
    expect(review).toContain("sectionTitle('Photos visible to buyers now'")
    expect(review).toContain("sectionTitle('Warnings visible to buyers now'")
    expect(review).not.toContain("sectionTitle('Visible to buyers now'")
  })
  it('the summary chip says what its number adds up (photos and warnings)', () => {
    const chip = reviewSummary({ warnings: 0, notes: 0, photos: 0, approved: 2, confirmed: 1, activeLinks: 0 }).find((i) => i.key === 'visible')!
    expect(chip.fullLabel).toBe('Photos and warnings visible to buyers now')
    expect(chip.count).toBe(3)
  })
})

describe('3.8 the status page', () => {
  it('says when it checked with the day and the time zone, not a bare clock time', () => {
    const text = checkedText('2026-11-04T04:30:00Z', 'Asia/Kolkata')
    expect(text).toContain('Checked')
    expect(text).toContain('4 Nov')
    expect(text).toContain('10:00')
    expect(text).toMatch(/IST|GMT\+5:30/)
  })
  it('says nothing for a date it cannot read', () => {
    expect(checkedText('not a date')).toBe('')
  })
  it('has a way back to the app, so it is not a dead end', () => {
    // A button, not a bare text link: a 22 px line of text is under the tap size (npm run ux caught the first version).
    // (through the shared BackLink: a boxed arrow at the tap size, backLink.test.tsx)
    expect(status).toMatch(/<BackLink to="\/">/)
  })
  it('uses the same sentence for the time on the page', () => {
    expect(status).toContain('checkedText(body.checkedAt)')
  })
})

describe('3.9 New order: no placeholder zero', () => {
  it('shows a dash until a size has a number, not "Total 0 pieces"', () => {
    expect(setup).toMatch(/sizes\.total > 0 \?/)
    expect(setup).not.toMatch(/Total <b>\{sizes\.total\.toLocaleString\('en-IN'\)\}<\/b> pieces<\/span>/)
  })
})

describe('3.10 no accent stripe', () => {
  // A coloured or grey bar down one edge of a card is banned in any colour (a design rule). These rules draw a
  // line or a shape, not a stripe on a card: the timeline's spine and the triangles and dashed line of the horizontal timeline.
  const ALLOWED = new Set(['.timeline__item', '.timeline__item:last-child', '.tlc__exline', '.tlc__pin--plan', '.tlc__swatch--plan', '.tlc__swatch--ex'])
  it('only the timeline draws a left border', () => {
    const offenders: string[] = []
    for (const line of css.split('\n')) {
      if (!/border-(left|inline-start)\b/.test(line)) continue
      const brace = line.indexOf('{')
      const selectors = brace < 0 ? ['(a multi-line rule)'] : line.slice(0, brace).split(',').map((s) => s.trim())
      for (const s of selectors) if (!ALLOWED.has(s)) offenders.push(s)
    }
    expect(offenders).toEqual([])
  })
  it('the date-change history cards are plain cards', () => {
    expect(/\.historyitem\s*\{[^}]*\}/.exec(css)?.[0] ?? '').not.toMatch(/border-left/)
  })
})
