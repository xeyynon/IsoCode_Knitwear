// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import type { ReactElement } from 'react'
import { SupervisorShell } from '../src/ui/templates/SupervisorShell'
import { MerchandiserShell } from '../src/ui/templates/MerchandiserShell'
import { AuthShell } from '../src/ui/templates/AuthShell'
import { PublicShell } from '../src/ui/templates/PublicShell'

// UI/UX plan, phase 6: the page templates draw EXACTLY the frame the pages wrote by hand (the app bar, then `main` with the same classes), so a page that moves
// to one changes nothing on screen or in the accessibility tree. The `main` classes on the right are the old hand-written ones.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const mount = (el: ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>).container

describe('SupervisorShell', () => {
  it('the app bar, then one narrow column', () => {
    const c = mount(<SupervisorShell title="My orders today">x</SupervisorShell>)
    expect(c.querySelector('header.appbar')).not.toBeNull()
    expect(c.querySelector('main')!.className).toBe('page page--narrow')
    expect(c.querySelector('main')!.textContent).toBe('x')
  })
  it('hands a tabIndex (and a ref) to main, as Today does for its focus effect', () => {
    const c = mount(<SupervisorShell title="T" tabIndex={-1}>x</SupervisorShell>)
    expect(c.querySelector('main')!.getAttribute('tabindex')).toBe('-1')
  })
  it('passes plainTitle to the bar (a page with its own h1 keeps one h1)', () => {
    const c = mount(<SupervisorShell title="Sewing" plainTitle>x</SupervisorShell>)
    expect(c.querySelector('h1')).toBeNull()
    expect(c.querySelector('p.appbar__title')!.textContent).toBe('Sewing')
  })
})

describe('MerchandiserShell', () => {
  it('the wide column by default; form and bento add their classes in the old order', () => {
    expect(mount(<MerchandiserShell title="Order board">x</MerchandiserShell>).querySelector('main')!.className).toBe('page')
    expect(mount(<MerchandiserShell title="Review" form>x</MerchandiserShell>).querySelector('main')!.className).toBe('page page--form')
    expect(mount(<MerchandiserShell title="Order" form bento>x</MerchandiserShell>).querySelector('main')!.className).toBe('page page--form page--bento')
  })
  it('has the app bar', () => {
    expect(mount(<MerchandiserShell title="Setup" form>x</MerchandiserShell>).querySelector('header.appbar h1')!.textContent).toBe('Setup')
  })
})

describe('AuthShell and PublicShell', () => {
  it('the sign-in frame: a centred main, no app bar', () => {
    const c = mount(<AuthShell>x</AuthShell>)
    // the skip link comes first (AUDIT-03 finding 17), then the same main as before (now the skip link's target)
    expect(c.querySelector('header')).toBeNull()
    expect(c.querySelector('a.skiplink')).not.toBeNull()
    expect(c.querySelector('main')!.outerHTML).toBe('<main id="main" tabindex="-1" class="login">x</main>')
  })
  it('the public frame: the top bar\'s brand capsule ALONE (no views, no menu, no control), narrow or form width, with a page class beside it', () => {
    // (through the three-shape top bar: a visitor gets the same look as everyone, but no internal screen and nothing to press: topBar.test.tsx)
    const mainOf = (el: ReactElement) => {
      const c = mount(el)
      const h = c.querySelector('header.appbar')!
      expect(h.querySelector('a.appbar__left')).not.toBeNull()
      expect(h.querySelector('nav, .menu, button, .appbar__center')).toBeNull()
      return c.querySelector('main')!.outerHTML
    }
    expect(mainOf(<PublicShell narrow>x</PublicShell>)).toBe('<main id="main" tabindex="-1" class="page page--narrow">x</main>')
    expect(mainOf(<PublicShell className="buyer">x</PublicShell>)).toBe('<main id="main" tabindex="-1" class="page page--form buyer">x</main>')
  })
})

describe('the pages use them (and write no frame of their own)', () => {
  it.each([
    ['pages/Today.tsx', '<SupervisorShell'],
    ['pages/Update.tsx', '<SupervisorShell'],
    ['pages/Board.tsx', '<MerchandiserShell'],
    ['pages/OrderDetail.tsx', '<MerchandiserShell'],
    ['pages/Review.tsx', '<MerchandiserShell'],
    ['pages/Setup.tsx', '<MerchandiserShell'],
    ['pages/OrderSetup.tsx', '<MerchandiserShell'],
    ['pages/Login.tsx', '<AuthShell'],
    ['pages/Buyer.tsx', '<PublicShell'],
    ['pages/Status.tsx', '<PublicShell'],
  ])('%s', (file, shell) => {
    const src = read(`../src/${file}`)
    expect(src).toContain(shell)
    expect(src).not.toMatch(/<main\b/)
    expect(src).not.toMatch(/<AppBar\b/)
  })
})
