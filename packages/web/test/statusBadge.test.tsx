// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { StatusBadge } from '../src/ui/StatusBadge'

// The first component test (UI/UX plan, slice 0.4). Rule 9: a status is an icon, a word and a colour, never colour alone;
// rule 3: grey ("no update") is never drawn as green. This renders the real component and reads what a person would see.
afterEach(cleanup)

const STATUSES = ['red', 'amber', 'green', 'grey'] as const
const markup = (status: (typeof STATUSES)[number]) => render(<StatusBadge status={status} />).container.querySelector('svg')!.innerHTML

describe('StatusBadge', () => {
  for (const status of STATUSES) {
    it(`${status}: draws an icon and a word together`, () => {
      const { container } = render(<StatusBadge status={status} />)
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg!.getAttribute('aria-hidden')).toBe('true')            // the word is the accessible name; the icon is not read twice
      expect(container.textContent!.trim().length).toBeGreaterThan(0)   // a word is always there
      expect(container.querySelector('.badge')!.className).toContain(`badge--${status}`)
    })
  }

  it('gives all four statuses a different shape, so they still differ in greyscale', () => {
    const shapes = STATUSES.map((s) => { const m = markup(s); cleanup(); return m })
    expect(new Set(shapes).size).toBe(4)
  })

  it('never draws grey (no update) as the green check', () => {
    const green = markup('green'); cleanup()
    const grey = markup('grey'); cleanup()
    expect(grey).not.toBe(green)
    expect(grey).not.toContain('m5.2 8.2')   // the check mark's path
  })
})
