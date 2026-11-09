// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// The top bar (the ORCA guide, adapted): three shapes, the same on every page and role. What each kind of person gets, one h1 per page, and the
// entrance playing once per visit (a replay on every page change would read as a wiggle). Each was shown to fail first.
const session = vi.hoisted(() => ({ role: 'merchandiser' as 'merchandiser' | 'supervisor' }))
vi.mock('../src/api/session', async (orig) => ({
  ...(await orig<typeof import('../src/api/session')>()),
  getClaims: () => ({ sub: 'u1', role: session.role }),
  apiFetch: () => Promise.resolve({}),
}))
import { AppBar } from '../src/ui/AppBar'

beforeEach(() => {
  delete document.documentElement.dataset.appbarIn
})
afterEach(cleanup)
const bar = (role: 'merchandiser' | 'supervisor', props: { title: string; plainTitle?: boolean; variant?: 'public' }, path = '/board') => {
  session.role = role
  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <AppBar {...props} />
    </MemoryRouter>,
  )
  return container.querySelector('header.appbar') as HTMLElement
}

describe('the three shapes', () => {
  it('a merchandiser: the brand capsule, the views in the centre, the menu capsule', () => {
    const h = bar('merchandiser', { title: 'Order board' })
    expect(h.querySelector('.appbar__cell--left a.appbar__left')).not.toBeNull()
    expect(h.querySelector('nav.appbar__center[aria-label="Main"]')).not.toBeNull()
    expect(h.querySelector('.appbar__cell--right .appbar__right .menu')).not.toBeNull()
  })
  it('a supervisor: the same three shapes, the page title in the centre tab (no views to switch between)', () => {
    const h = bar('supervisor', { title: 'My orders today' }, '/today')
    expect(h.querySelector('nav')).toBeNull()
    expect(h.querySelector('.appbar__center h1.appbar__title')!.textContent).toBe('My orders today')
    expect(h.querySelector('.appbar__right .menu')).not.toBeNull()
  })
  it('a public page (status, buyer): the brand capsule only, no controls and no centre tab', () => {
    const h = bar('merchandiser', { title: 'System status', variant: 'public' })
    expect(h.querySelector('a.appbar__left')).not.toBeNull()
    expect(h.querySelector('.menu')).toBeNull()
    expect(h.querySelector('nav')).toBeNull()
    expect(h.querySelector('.appbar__center')).toBeNull()
    expect(h.querySelectorAll('button').length).toBe(0)
  })
  it('the brand is a link home: the board for a merchandiser, Today for a supervisor, the front door for a visitor; its name stays for a screen reader', () => {
    expect(bar('merchandiser', { title: 'Order board' }).querySelector('a.appbar__left')!.getAttribute('href')).toBe('/board')
    cleanup()
    expect(bar('supervisor', { title: 'x' }, '/today').querySelector('a.appbar__left')!.getAttribute('href')).toBe('/today')
    cleanup()
    const pub = bar('supervisor', { title: 'x', variant: 'public' })
    expect(pub.querySelector('a.appbar__left')!.getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: /Order tracking|ஆர்டர் கண்காணிப்பு/ })).toBeTruthy()
    expect(pub.querySelector('img.appbar__mark')!.getAttribute('alt')).toBe('') // decorative: the words name the link
  })
  it('there is no search control: this app has no global search, and a dead button is worse than none', () => {
    const h = bar('merchandiser', { title: 'Order board' })
    expect(h.querySelector('[aria-label*="earch" i], .search-pop')).toBeNull()
  })
})

describe('one h1 per page', () => {
  it('a merchandiser tab page: one h1, visually hidden (the active tab already says where you are)', () => {
    const h = bar('merchandiser', { title: 'Order board' })
    expect(h.querySelectorAll('h1').length).toBe(1)
    expect(h.querySelector('h1')!.className).toContain('visually-hidden')
    expect(h.querySelector('h1')!.textContent).toBe('Order board')
  })
  it('a page with its own h1 (plainTitle) puts none in the bar', () => {
    expect(bar('merchandiser', { title: 'B-PO-1', plainTitle: true }, '/orders/1').querySelectorAll('h1').length).toBe(0)
  })
  it('a supervisor page: the centre tab is the h1; with plainTitle it is a paragraph', () => {
    expect(bar('supervisor', { title: 'Sewing', plainTitle: true }, '/today/o/sewing').querySelector('.appbar__center p.appbar__title')!.textContent).toBe('Sewing')
    cleanup()
    expect(bar('supervisor', { title: 'My orders today' }, '/today').querySelectorAll('h1').length).toBe(1)
  })
})

describe('the entrance plays once per visit', () => {
  it('the first bar slides in; the same bar mounted again for the next page does not (it would look like a wiggle)', () => {
    const first = bar('merchandiser', { title: 'Order board' })
    expect(first.className).toContain('appbar--enter')
    cleanup()
    const second = bar('merchandiser', { title: 'Review' }, '/review')
    expect(second.className).not.toContain('appbar--enter')
    cleanup()
    expect(bar('supervisor', { title: 'My orders today' }, '/today').className).not.toContain('appbar--enter')
  })
})
