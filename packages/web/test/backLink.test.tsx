// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { BackLink } from '../src/ui/molecules/BackLink'

// User feedback, 10 Nov 2026: "even the back button is not uniform". The Update screen drew a boxed arrow on a phone and an underlined text
// link on a wider screen, the order page and New order a text link, the status page a button. One component now draws them all.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = read('../src/ui/molecules/BackLink.css').replace(/\/\*[\s\S]*?\*\//g, '')

describe('BackLink', () => {
  it('is a real link with a bordered arrow box and the destination\'s name', () => {
    const { container } = render(<MemoryRouter><BackLink to="/board">Order board</BackLink></MemoryRouter>)
    const a = container.querySelector('a.backlink') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('/board')
    expect(a.querySelector('.backlink__box svg')).not.toBeNull()
    expect(a.querySelector('.backlink__box')!.getAttribute('aria-hidden')).toBe('true')
    expect(a.textContent).toBe('Order board')
  })
  it('compact keeps the name in the document (for a screen reader) and only hides it on a narrow screen', () => {
    const { container } = render(<MemoryRouter><BackLink to="/today" compact>My orders</BackLink></MemoryRouter>)
    expect(container.querySelector('a.backlink--compact .backlink__text')!.textContent).toBe('My orders')
    expect(css).toMatch(/@media \(max-width: 479px\)\s*\{\s*\.backlink--compact \.backlink__text\s*\{[^}]*clip:/)
  })
})

describe('the box is the same size and shape as the menu button, from the tokens', () => {
  it('uses the tap-size, border and radius tokens, never a one-off', () => {
    expect(css).toMatch(/\.backlink__box\s*\{[^}]*width:\s*var\(--tap-min\)[^}]*height:\s*var\(--tap-min\)/)
    expect(css).toMatch(/\.backlink__box\s*\{[^}]*border:\s*1px solid var\(--border\)[^}]*border-radius:\s*var\(--radius-m\)/)
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i)
  })
})

describe('every page uses it, and nobody draws their own', () => {
  const pages = ['pages/OrderDetail.tsx', 'pages/OrderSetup.tsx', 'pages/Status.tsx', 'pages/Update.tsx']
  it.each(pages)('%s', (file) => {
    const src = read(`../src/${file}`)
    expect(src).toContain('<BackLink')
    expect(src).not.toMatch(/className="back\b|←/)
  })
  it('the old back rules are gone from the main stylesheet', () => {
    expect(read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\.back(--arrow|__text|__arrow)?\s*[{,]/)
  })
})

describe('the back link is a tap target on every pointer', () => {
  it('is at least the tap minimum tall and centres its contents', () => {
    expect(css).toMatch(/\.backlink\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*min-height:\s*var\(--tap-min\)/)
  })
})
