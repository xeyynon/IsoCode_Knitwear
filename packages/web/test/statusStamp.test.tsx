// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { StatusBadge } from '../src/ui/StatusBadge'

// The "stamp" look for a status (user request, 8 Nov 2026, approved on the order page and then made the only look): a ruled rectangle,
// at least 79 x 24 px, in capitals, not tilted.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = read('../src/ui/StatusStamp.css').replace(/\/\*[\s\S]*?\*\//g, '')
const detail = read('../src/pages/OrderDetail.tsx')

describe('StatusBadge is a stamp', () => {
  it('keeps the icon and the word, which a status always carries', () => {
    for (const s of ['red', 'amber', 'grey', 'green'] as const) {
      const { container, unmount } = render(<StatusBadge status={s} />)
      const el = container.querySelector('.badge') as HTMLElement
      expect(el.className).toContain('badge--stamp')
      expect(el.className).toContain(`badge--${s}`)
      expect(el.querySelector('svg')).not.toBeNull()
      expect(el.textContent!.trim().length).toBeGreaterThan(2)
      unmount()
    }
  })
  it('is the only look: the component takes no look option', () => {
    expect(read('../src/ui/StatusBadge.tsx')).not.toMatch(/stamp\??:\s*boolean|stamp = false/)
  })
})

describe('the stamp in CSS', () => {
  it('is at least 79 x 24 px, in capitals, ruled twice', () => {
    expect(css).toMatch(/\.badge--stamp\s*\{[^}]*min-width:\s*79px/)
    expect(css).toMatch(/\.badge--stamp\s*\{[^}]*min-height:\s*24px/)
    expect(css).toMatch(/\.badge--stamp\s*\{[^}]*text-transform:\s*uppercase/)
    expect(css).toMatch(/\.badge--stamp::after\s*\{[^}]*border:/)
  })
  it('is not tilted, and has no fill (the colour is on the rule, the icon and the word)', () => {
    expect(css).not.toMatch(/rotate|skew|(^|[;{\s])transform\s*:/) // text-transform (capitals) is fine; a tilt is not
    expect(css).toMatch(/\.badge--stamp\s*\{[^}]*background:\s*transparent/)
    expect(css).not.toMatch(/tint/)
  })
})

describe('everywhere', () => {
  it('no pill shape or status tint is left in the badge rules of the main stylesheet', () => {
    const styles = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const badgeRules = styles.split('\n').filter((l) => /^\.badge/.test(l)).join('\n')
    expect(badgeRules).not.toMatch(/border-radius|tint|background/)
  })
  it('the buyer page severity word is a stamp too', () => {
    expect(read('../src/pages/Buyer.tsx')).toContain('badge badge--neutral badge--stamp')
  })
  it('the order page header, the board and the stage cards all use the one component', () => {
    expect(detail).toContain('<StatusBadge status={d.order.status} />')
    expect(read('../src/pages/Board.tsx')).toContain('<StatusBadge status={r.status} />')
  })
})
