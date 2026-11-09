import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Merge fix: the finished-area stage card was 9 px wider than its list in Tamil at 195 px (200% zoom). `npm run ux` measures it
// in a browser; this pins the three rules that fix it so a later restyle cannot quietly take them out.
const css = readFileSync(new URL('../src/ui/organisms/StageCard.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('the stage card fits a 195 px screen in Tamil', () => {
  it('its one column may shrink below the widest label', () => {
    expect(css).toMatch(/\.stage\.stagetile\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  })
  it('the Update button label may wrap, with a smaller side padding', () => {
    expect(css).toMatch(/\.stagetile \.stage__go\s*\{[^}]*white-space:\s*normal[^}]*padding-inline:\s*var\(--space-2\)/)
  })
  it('a long Tamil word on the contribution line may break instead of overflowing', () => {
    expect(css).toMatch(/\.stagetile__today,\s*\.stagetile__togo\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/)
  })
})
