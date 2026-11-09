import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { NAV, activeNav, badgeText, reviewCountFrom, showNav } from '../src/ui/navRules'

// UI/UX plan, slice 3.3 (decision D5): the merchandiser's three places, Board, Review and Setup, are tabs in the app bar on every
// merchandiser screen, with the number of items waiting for review always in view. (The ORCA top bar pattern, adapted.)
describe('the tabs', () => {
  it('are Board, Review and Setup, in that order, each with the shortcut that already goes there', () => {
    expect(NAV.map((t) => [t.key, t.to, t.label, t.keys])).toEqual([
      ['board', '/board', 'Board', 'G then B'],
      ['review', '/review', 'Review', 'G then R'],
      ['setup', '/setup', 'Setup', 'G then S'],
    ])
  })
  it('mark the place you are in: orders belong to the board', () => {
    expect(activeNav('/board')).toBe('board')
    expect(activeNav('/orders/new')).toBe('board')
    expect(activeNav('/orders/00000000-0000-0000-0000-0000000000d1')).toBe('board')
    expect(activeNav('/review')).toBe('review')
    expect(activeNav('/setup')).toBe('setup')
  })
  it('mark nothing on a screen that is not one of the three', () => {
    for (const p of ['/', '/login', '/status', '/buyer', '/today', '/today/x/sewing', '/boardwalk', '/reviewer']) expect(activeNav(p)).toBeNull()
  })
  it('are for a merchandiser only (a supervisor has one flow, a buyer has no navigation)', () => {
    expect(showNav('merchandiser')).toBe(true)
    for (const r of ['supervisor', 'buyer', undefined]) expect(showNav(r)).toBe(false)
  })
})

describe('the count of items waiting for review', () => {
  it('shows nothing when nothing waits, and when it is not known yet (never a placeholder zero)', () => {
    for (const n of [0, null, undefined, -3, NaN]) expect(badgeText(n)).toBeNull()
  })
  it('shows the number, capped so the tab never grows without limit', () => {
    expect(badgeText(2)).toBe('2')
    expect(badgeText(99)).toBe('99')
    expect(badgeText(100)).toBe('99+')
  })
  it('is read from the review answer, and is unknown when the answer is not what was expected', () => {
    expect(reviewCountFrom({ needsReview: [{}, {}, {}], confirmed: [] })).toBe(3)
    expect(reviewCountFrom({ needsReview: [] })).toBe(0)
    for (const bad of [null, undefined, {}, { needsReview: 'x' }, 5, []]) expect(reviewCountFrom(bad)).toBeNull()
  })
})

// What a unit test cannot show: where the tabs live and what moved out of the way. Each was shown to fail before the change.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const appbar = read('../src/ui/AppBar.tsx')
const board = read('../src/pages/Board.tsx')
const review = read('../src/pages/Review.tsx')
const setup = read('../src/pages/Setup.tsx')
const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
const navCss = read('../src/ui/molecules/NavTabs.css').replace(/\/\*[\s\S]*?\*\//g, '')

describe('the app bar', () => {
  it('shows the tabs for a merchandiser only, and owns the review count', () => {
    expect(appbar).toMatch(/<NavTabs\b/)
    expect(appbar).toMatch(/merchandiser && <NavTabs/)
    expect(appbar).toMatch(/useReviewCount\(merchandiser\)/)
  })
  it('measures its own height, because a second row on a phone makes it taller than the old fixed 56 px', () => {
    expect(appbar).toContain("'--appbar-h'")
    expect(css).toMatch(/\.rvbar\s*\{[^}]*top:\s*var\(--appbar-h/)
    expect(css).toMatch(/scroll-margin-top:\s*calc\(var\(--appbar-h/)
  })
})

describe('what the tabs replace', () => {
  it('the board toolbar no longer holds Setup and review links, nor fetches the review count (the bar does)', () => {
    expect(board).not.toMatch(/to="\/setup"/)
    expect(board).not.toMatch(/to="\/review"/)
    expect(board).not.toContain('/api/review')
    // New order stays, as the one primary action (through the atom: `variant="primary" size="small"` draws `btn btn--primary btn--small`, atoms.test.tsx)
    expect(board).toMatch(/<ButtonLink variant="primary" size="small" to="\/orders\/new"/)
  })
  it('Review and Setup have no "back to the board" link of their own: the Board tab is always there', () => {
    expect(review).not.toMatch(/Back to board|← Order board/)
    expect(setup).not.toMatch(/Back to board|← Order board/)
  })
  it('acting on the Review page refreshes the count in the bar', () => {
    expect(review).toContain('notifyReviewChanged(')
  })
})

describe('the tabs look', () => {
  it('are at least the tap minimum high', () => {
    expect(navCss).toMatch(/\.navtab\s*\{[^}]*min-height:\s*var\(--tap-min\)/)
  })
  it('mark the current place by weight and an underline as well as colour', () => {
    // (through the three-shape top bar: a heavier label, and a 2 px underline that is drawn only for the current place)
    const current = /\.navtab\[aria-current='page'\]\s*\{([^}]*)\}/.exec(navCss)?.[1] ?? ''
    expect(current).toMatch(/font-weight/)
    expect(navCss).toMatch(/\.navtab::after\s*\{[^}]*height:\s*2px[^}]*transform:\s*scaleX\(0\)/)
    expect(navCss).toMatch(/\.navtab\[aria-current='page'\]::after\s*\{[^}]*scaleX\(1\)/)
  })
  it('on a narrow screen take a band of their own under the capsules, which scrolls sideways', () => {
    const bar = read('../src/ui/AppBar.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(bar).toMatch(/@media \(max-width: 1100px\)\s*\{[\s\S]*?\.appbar--views\s*\{[^}]*grid-template-areas:\s*"left right" "center center"/)
    expect(bar).toMatch(/\.appbar--views \.appbar__center\s*\{[^}]*overflow-x:\s*auto/)
  })
})

// A link drawn as a button ("New order", the supervisor's "Update") must not keep the browser's underline, and its label sits in the
// middle of the button: audit 02 finding 3 ("New order is the primary button but is underlined like a link").
describe('a link drawn as a button', () => {
  const linkButton = /(?:^|\})\s*a\.btn\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  it('has no underline and centres its label', () => {
    expect(linkButton).toMatch(/text-decoration:\s*none/)
    expect(linkButton).toMatch(/display:\s*inline-flex/)
    expect(linkButton).toMatch(/align-items:\s*center/)
    expect(linkButton).toMatch(/justify-content:\s*center/)
  })
})

describe('a link drawn as a button: a label that wraps stays centred', () => {
  it('has text-align: center (a Tamil label wraps to two lines on a phone)', () => {
    expect(/(?:^|\})\s*a\.btn\s*\{([^}]*)\}/.exec(css)?.[1] ?? '').toMatch(/text-align:\s*center/)
  })
})
