// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { Skeleton } from '../src/ui/atoms/Skeleton'

// UI/UX plan, slice 4.2: skeletons only where the wait was measured over 1 s (Today's list after sign-in: 2.0 s on emulated Slow 3G).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const today = read('../src/pages/Today.tsx')
const css = read('../src/ui/atoms/Skeleton.css').replace(/\/\*[\s\S]*?\*\//g, '')

describe('Skeleton', () => {
  it('is an empty, hidden block of the size asked for', () => {
    const el = render(<Skeleton width="40%" height={24} />).container.querySelector('.skeleton') as HTMLElement
    expect(el.textContent).toBe('')
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.style.width).toBe('40%')
    expect(el.style.height).toBe('24px')
  })
  it('is neutral grey from the tokens, still under reduced motion', () => {
    expect(css).toContain('background: var(--border-soft)')
    expect(css).not.toMatch(/status|--(red|amber|green)/)
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.skeleton\s*\{\s*animation:\s*none/)
  })
})

describe('Today while the list loads', () => {
  it('shows stage-shaped blocks inside a region that says "loading" in the supervisor\'s language', () => {
    expect(today).toContain('<Skeleton')
    expect(today).toMatch(/role="status" aria-label=\{t\('today\.loading'\)\}/)
  })
  it('keeps the error and the empty states as they were', () => {
    expect(today).toContain('st.stages === null && st.error')
    expect(today).toContain("t('today.nothing')")
  })
})
