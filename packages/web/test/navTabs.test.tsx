// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NavTabs } from '../src/ui/molecules/NavTabs'

// UI/UX plan, slice 3.3: the merchandiser's tabs, rendered inside a router as a person would meet them.
afterEach(cleanup)
const at = (path: string, count: number | null) => render(<MemoryRouter initialEntries={[path]}><NavTabs reviewCount={count} /></MemoryRouter>)

describe('NavTabs', () => {
  it('is one labelled navigation with three links', () => {
    at('/board', null)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/board', '/review', '/setup'])
  })
  it('marks only the current place, with aria-current', () => {
    at('/orders/new', null)
    expect(screen.getByRole('link', { name: 'Board' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Review' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: 'Setup' }).getAttribute('aria-current')).toBeNull()
  })
  it('names the keyboard shortcut in each tooltip (recognition, not recall)', () => {
    at('/board', null)
    expect(screen.getByRole('link', { name: 'Review' }).getAttribute('title')).toBe('Review (G then R)')
  })
  it('says how many are waiting, in words for a screen reader and as a number to the eye', () => {
    const { container } = at('/board', 2)
    expect(screen.getByRole('link', { name: 'Review 2 waiting' })).toBeTruthy()
    const badge = container.querySelector('.count')!
    expect(badge.textContent).toBe('2')
    expect(badge.getAttribute('aria-hidden')).toBe('true')   // the number is not read twice
  })
  it('shows no number when nothing waits or the count is not known yet', () => {
    for (const n of [0, null]) {
      const { container, unmount } = at('/board', n)
      expect(container.querySelector('.count')).toBeNull()
      expect(screen.getByRole('link', { name: 'Review' })).toBeTruthy()
      unmount()
    }
  })
  it('never puts the count on Board or Setup', () => {
    const { container } = at('/setup', 5)
    expect(container.querySelectorAll('.count').length).toBe(1)
    expect(screen.getByRole('link', { name: 'Review 5 waiting' }).querySelector('.count')).not.toBeNull()
  })
})
