import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Final cycle W-5: the evaluator panel on a phone (320 to 360 px wide). "Use these" overlapped the wrapped email, and the chips, the button and the buyer
// links were under the 44 px tap minimum. Static checks on the stylesheet: the layout itself was checked in a browser.
const css = readFileSync(new URL('../src/ui/organisms/EvaluatorAccess.css', import.meta.url), 'utf8')
const lines = css.split('\n')
const rule = (sel: string): string => {
  const at = lines.findIndex((l) => l.startsWith(`${sel} {`))
  expect(at, `a rule for ${sel}`).toBeGreaterThanOrEqual(0)
  return lines[at]!
}

describe('W-5: the evaluator panel on a phone', () => {
  it('W-5: "Use these" is in the normal flow, never laid over the rows', () => {
    const use = rule('.evaluator__use')
    expect(use).not.toMatch(/position:\s*absolute/)
    expect(use).not.toMatch(/transform/)
  })
  it.each(['.evaluator__use', '.evaluator__chip', '.evaluator__buyers a'])('W-5: %s is at least the tap minimum high', (sel) => {
    expect(rule(sel)).toMatch(/min-height:\s*var\(--tap-min\)/)
  })
  it('W-5: a value stays on one line (an ellipsis if it cannot fit) instead of wrapping into its neighbours', () => {
    const v = rule('.evaluator__value')
    expect(v).toMatch(/white-space:\s*nowrap/)
    expect(v).toMatch(/text-overflow:\s*ellipsis/)
    expect(v).not.toMatch(/overflow-wrap:\s*anywhere/)
  })
  it('W-5: the sign-in card may shrink below its content, so a long value cannot widen the page past a 320 px phone', () => {
    const base = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(/\.login__card \{[^}]*min-width:\s*0/.test(base)).toBe(true)
  })
  it('W-5: no coloured stripe down one edge', () => {
    expect(css).not.toMatch(/border-(left|right)(-color)?:\s*[^;]*(accent|red|amber|green)/)
  })
})
