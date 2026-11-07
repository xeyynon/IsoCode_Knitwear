// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { KeyFacts } from '../src/ui/organisms/KeyFacts'

// UI/UX plan, slice 3.6 (audit 02 finding 7).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
const detail = read('../src/pages/OrderDetail.tsx')

describe('KeyFacts', () => {
  it('pairs each label with its value, and shows a hint only when there is one', () => {
    const { container } = render(<KeyFacts facts={[{ label: 'Quantity', value: '4,550' }, { label: 'Ex-factory', value: '12 Nov', hint: 'Thursday, 12 Nov 2026' }]} />)
    const tiles = [...container.querySelectorAll(".keyfacts__tile")] as HTMLElement[]
    expect(tiles).toHaveLength(2)
    expect(tiles[0]!.querySelector('dt')?.textContent).toBe('Quantity')
    expect(tiles[0]!.querySelector('dd.mono')?.textContent).toBe('4,550')
    expect(tiles[0]!.querySelector('.keyfacts__hint')).toBeNull()
    expect(tiles[1]!.querySelector('.keyfacts__hint')?.textContent).toBe('Thursday, 12 Nov 2026')
  })
  it('draws nothing for no facts', () => {
    expect(render(<KeyFacts facts={[]} />).container.innerHTML).toBe('')
  })
  it('does not colour a value (status is the badge alone)', () => {
    expect(read('../src/ui/organisms/KeyFacts.css')).not.toMatch(/status|--(red|amber|green)/)
  })
})

describe('Order detail', () => {
  it('opens with the tiles in place of the old inline numbers', () => {
    expect(detail).toContain('<KeyFacts')
    expect(detail).not.toContain('className="summary__nums')
  })
  it('keeps cards apart', () => {
    expect(css).toMatch(/\.card\s*\+\s*\.card\s*\{[^}]*margin-top:\s*var\(--space-4\)/)
  })
  it('changing the date is not a second filled primary button', () => {
    expect(detail).not.toMatch(/btn btn--primary" disabled=\{busy\}>\{busy \? 'Changing/)
    expect(detail).toMatch(/className="btn" disabled=\{busy\}>\{busy \? 'Changing/)
  })
})
