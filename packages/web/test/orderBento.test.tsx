// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { OrderBento } from '../src/ui/organisms/OrderBento'
import { KeyFacts } from '../src/ui/organisms/KeyFacts'

// UI/UX 2.0 phase 8B: the order page as a bento on a wide screen, one column on a phone.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = read('../src/ui/organisms/OrderBento.css').replace(/\/\*[\s\S]*?\*\//g, '')
const detail = read('../src/pages/OrderDetail.tsx')

describe('OrderBento', () => {
  it('places each part in its own area, in reading order', () => {
    const { container } = render(
      <OrderBento head={<i>h</i>} timeline={<i>t</i>} stages={<i>s</i>} actions={<i>a</i>} log={<i>l</i>} />,
    )
    const areas = [...container.querySelectorAll('.bento > [data-area]')].map((e) => e.getAttribute('data-area'))
    expect(areas).toEqual(['head', 'timeline', 'stages', 'actions', 'log'])
  })
  it('leaves out an area that has nothing in it', () => {
    const { container } = render(<OrderBento head={<i>h</i>} timeline={<i>t</i>} stages={null} actions={<i>a</i>} log={<i>l</i>} />)
    expect([...container.querySelectorAll('[data-area]')].map((e) => e.getAttribute('data-area'))).not.toContain('stages')
  })
})

describe('OrderBento.css', () => {
  it('is one column until there is room, then the timeline and the stage cards sit side by side', () => {
    expect(css).toMatch(/@media \(min-width: 1000px\)/)
    const wide = /@media \(min-width: 1000px\)\s*\{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? ''
    expect(wide).toMatch(/grid-template-areas:[^;]*"timeline stages"/)
  })
  it('lets the cards inside use the width of their area, and uses tokens only', () => {
    expect(css).toMatch(/\.bento \.card\s*\{[^}]*max-width:\s*none/)
    expect(css).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
  })
})

describe('the phone page keeps what phase 3 measured', () => {
  it('keeps the two action cards apart on a phone too (the grid\'s gap, not the margin the bento removed)', () => {
    expect(css).toMatch(/\.bento__actions,\s*\.bento__log\s*\{[^}]*display:\s*grid[^}]*gap:\s*var\(--space-4\)/)
  })
  it('shows the projected-finish tile on a wide screen only, so a phone keeps its one row of three tiles', () => {
    const kf = read('../src/ui/organisms/KeyFacts.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(kf).toMatch(/@media \(max-width: 999px\)\s*\{\s*\.keyfacts__tile--wide\s*\{\s*display:\s*none/)
    expect(detail).toMatch(/label: 'Projected finish'[^\n]*wideOnly: true/)
    const { container } = render(<KeyFacts facts={[{ label: 'A', value: '1' }, { label: 'B', value: '2', wideOnly: true }]} />)
    const tiles = [...container.querySelectorAll('.keyfacts__tile')]
    expect(tiles[0]!.className).not.toContain('keyfacts__tile--wide')
    expect(tiles[1]!.className).toContain('keyfacts__tile--wide')
  })
})

describe('OrderDetail.tsx', () => {
  it('is laid out by OrderBento, and the cards keep their headings inside the area they belong to', () => {
    expect(detail).toContain('<OrderBento')
    // Same promise through the template: the page asks MerchandiserShell for the `bento` frame (templates.test.tsx: `bento` draws `page--bento`).
    expect(detail).toMatch(/<MerchandiserShell [^>]*\bbento\b/)
  })
  it('adds a projected-finish tile only from a real projected date', () => {
    expect(detail).toMatch(/label: 'Projected finish'/)
    expect(detail).toMatch(/projectedEnd/)
  })
})
