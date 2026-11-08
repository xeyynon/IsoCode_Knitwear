import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Final bug cycle (9 Nov 2026), supervisor hunter findings. Each test name starts with its id.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const actionbarCss = read('../src/ui/molecules/ActionBar.css').replace(/\/\*[\s\S]*?\*\//g, '')

describe('FE-S-03: a focused field is never left under the sticky app bar', () => {
  it('FE-S-03: the page keeps the app bar\'s own height free at the top, as it keeps room for the bar at the bottom', () => {
    expect(actionbarCss).toMatch(/html:has\(\.actionbar\)\s*\{[^}]*scroll-padding-top:\s*calc\(var\(--appbar-h,\s*56px\)\s*\+/)
    expect(actionbarCss).toMatch(/html:has\(\.actionbar\)\s*\{[^}]*scroll-padding-bottom:/)
  })
})

describe('FE-S-05: a bad file never leaves an earlier photo looking chosen', () => {
  const update = read('../src/pages/Update.tsx')
  it('FE-S-05: a failed pick drops the earlier photo, so the screen shows the error and no "Photo ready" together', () => {
    const catchLine = update.split('\n').find((l) => l.includes('catch (err) { retaking.current = false;'))
    expect(catchLine, 'the pick() catch line').toBeTruthy()
    expect(catchLine).toContain('setPhoto(null)')
    expect(catchLine).toContain('photoFocus.current = true') // focus goes to the Add button, not to <body>, when Retake disappears
  })
})

describe('FE-D-10: the Evaluator access buttons are a real tap size', () => {
  const css = read('../src/ui/organisms/EvaluatorAccess.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (sel: string) => { const i = css.indexOf(sel + ' {'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1) }
  it('FE-D-10: "Use these" is a full-width band at the touch size, in the flow, not a 28 px pill on the seam', () => {
    const use = rule('.evaluator__use')
    expect(use).toMatch(/min-height:\s*var\(--tap-min\)/)
    expect(use).not.toMatch(/position:\s*absolute|height:\s*28px/)
  })
  it('FE-D-10: the unit chips keep the touch size too', () => {
    expect(rule('.evaluator__chip')).toMatch(/min-height:\s*var\(--tap-min\)/)
  })
})
