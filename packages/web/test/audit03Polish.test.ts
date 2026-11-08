import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// AUDIT-03 (audit/AUDIT-03-ui-2-0.md): the findings that are not on the Board or on Review. One test group per finding.
const raw = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const read = (p: string) => raw(p).replace(/\/\*[\s\S]*?\*\//g, '')

describe('finding 13: the Tamil progress headline', () => {
  it('is set smaller in Tamil only, so it takes two lines like the English one takes one', () => {
    const css = read('../src/ui/organisms/TodayHero.css')
    expect(css).toMatch(/html\[lang='ta'\]\s+\.todayhero__headline\s*\{[^}]*font-size:\s*1\.0625rem/)
    expect(css).toMatch(/\.todayhero__headline\s*\{[^}]*font-size:\s*1\.25rem/)   // English keeps its size
  })
})

describe('finding 8: the Setup tabs', () => {
  const css = read('../src/styles.css')
  it('are one row of equal widths on a wide screen (not 120 to 149 px)', () => {
    expect(css).toMatch(/\.seg--tabs\s*\{[^}]*flex-wrap:\s*nowrap/)
    expect(css).toMatch(/\.seg--tabs \.seg__btn\s*\{[^}]*flex:\s*1 1 0/)
  })
  it('scroll sideways in one row on a phone, never wrap to three rows', () => {
    const phone = /@media \(max-width: 720px\)\s*\{\s*\.seg--tabs\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(phone).toMatch(/overflow-x:\s*auto/)
    expect(css).not.toMatch(/\.seg--tabs\s*\{[^}]*flex-wrap:\s*wrap/)
  })
  it('keeps every tab a button with aria-current, and brings the current one into view', () => {
    const setup = raw('../src/pages/Setup.tsx')
    expect(setup).toContain("aria-current={tab === id ? 'true' : undefined}")
    expect(setup).toMatch(/scrollIntoView\?\.\(\{ block: 'nearest', inline: 'nearest' \}\)/)
  })
})

describe('finding 18: the steps toggle', () => {
  const checklist = raw('../src/ui/organisms/SetupChecklist.tsx')
  it('is gone on a wide screen while steps are left (they are just shown)', () => {
    expect(checklist).toMatch(/\{!done && !narrow \? list : \(/)
    expect(checklist).not.toContain("'The steps'")
  })
  it('stays on a phone and when everything is done, as a disclosure with a plain label', () => {
    expect(checklist).toContain("done ? 'See what is set up' : 'Show the steps'")
  })
})

describe('finding 5: the buyer page Download button', () => {
  it('is 48 px with a touch screen (40 px only with a mouse, above the 24 px mouse floor): npm run ux now measures the buyer page under touch', () => {
    const ux = raw('../../../scripts/ux_metrics.ts')
    expect(ux).toContain("'Buyer page'")
    expect(ux).toContain('/api/buyer-links')
    expect(ux).toContain('/revoke')   // the link made for the audit is cancelled again
    expect(read('../src/styles.css')).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.btn, \.chip, \.btn--small\s*\{\s*min-height:\s*var\(--tap-min\)/)
  })
})

describe('finding 12: style and colour words on the Tamil screens', () => {
  it('come from the order (free text typed by a merchandiser), so they are shown as they are, never translated by the app', () => {
    // A guard against the app inventing Tamil for data: Today and Update print the order's own style and colour fields.
    expect(raw('../src/pages/Today.tsx')).toContain('meta={`${s.style} · ${s.colour}`}')
    expect(raw('../src/pages/Update.tsx')).toContain('${stage.style} · ${stage.colour}')
  })
})
