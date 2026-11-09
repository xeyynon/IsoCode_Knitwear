// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { UpdateHero } from '../src/ui/organisms/UpdateHero'
import { StageCard } from '../src/ui/organisms/StageCard'
import { strings, translate, type Key } from '../src/i18n'

// Form review, "finished" area: completed production leads, today's contribution is one quiet line, what remains is secondary. Facts only:
// nothing measured or sent changes, and no state invents a number (no plan = no share, no "to go").
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const heroCss = strip(read('../src/ui/organisms/UpdateHero.css'))
const cardCss = strip(read('../src/ui/organisms/StageCard.css'))

const en = (k: Key, v?: Record<string, string | number>) => translate('en', k, v)
const heroLabels = {
  done: en('today.done'),
  addedToday: (n: string) => en('update.addedToday', { n }),
  nothingToday: en('update.nothingToday'),
  toGo: (n: string) => en('update.toGo', { n }),
  complete: en('update.stageComplete'),
  share: (pct: string) => en('update.shareDone', { pct }),
}
const hero = (p: { done: number; qty: number; todaySoFar: number; left: number }) =>
  render(<UpdateHero po="B-PO-88240" meta="tee · navy" {...p} labels={heroLabels} />).container
const cardLabels = { ...heroLabels, today: en('today.today'), due: en('today.due'), update: en('today.update') }
const card = (p: { done: number; qty: number; today: number }) =>
  render(<MemoryRouter><StageCard po="B-PO-88240" meta="tee · navy" stageName="Sewing" dueText="11 Nov" href="/u" labels={cardLabels} {...p} /></MemoryRouter>).container
const dash = (c: HTMLElement) => Number((c.querySelector('.ring__fill') as SVGCircleElement).getAttribute('stroke-dashoffset'))

describe('UpdateHero: the states', () => {
  it('nothing sent yet today: the work already made leads, today is neutral and plain, what remains is secondary', () => {
    const c = hero({ done: 1750, qty: 4550, todaySoFar: 0, left: 2800 })
    expect(c.querySelector('.updatehero__made b')!.textContent).toBe('1,750')
    expect(c.querySelector('.updatehero__made')!.textContent).toContain('/ 4,550')
    expect(c.querySelector('.updatehero__made')!.textContent).toContain('Done')
    expect(c.querySelector('.updatehero__today')!.textContent).toBe('Nothing sent yet today')
    expect(c.querySelector('.updatehero__today--added')).toBeNull()
    expect(c.querySelector('.updatehero__today svg')).toBeNull()
    expect(c.querySelector('.updatehero__togo')!.textContent).toBe('2,800 to go')
    expect(c.textContent).toContain('38%')
  })
  it('some sent today: the contribution gets a check in the action colour and says what it added', () => {
    const c = hero({ done: 1750, qty: 4550, todaySoFar: 350, left: 2800 })
    expect(c.querySelector('.updatehero__today--added')!.textContent).toBe('350 added today')
    expect(c.querySelector('.updatehero__today--added svg')!.getAttribute('aria-hidden')).toBe('true')
  })
  it('stage complete: says so instead of "to go", and the ring is full', () => {
    const c = hero({ done: 4550, qty: 4550, todaySoFar: 100, left: 0 })
    expect(c.querySelector('.updatehero__togo')!.textContent).toBe('Stage complete')
    expect(c.textContent).not.toContain('to go')
    expect(dash(c)).toBe(0)
    expect(c.textContent).toContain('100%')
  })
  it('over the plan: the true number is shown, only the ring stops at full', () => {
    const c = hero({ done: 5100, qty: 4550, todaySoFar: 0, left: 0 })
    expect(c.querySelector('.updatehero__made b')!.textContent).toBe('5,100')
    expect(c.querySelector('.updatehero__made')!.textContent).toContain('/ 4,550')
    expect(c.querySelector('.updatehero__togo')!.textContent).toBe('Stage complete')
    expect(dash(c)).toBe(0)
  })
  it('no plan (quantity 0): no share, no "to go", no "complete": nothing is invented', () => {
    const c = hero({ done: 0, qty: 0, todaySoFar: 0, left: 0 })
    expect(c.textContent).not.toContain('%')
    expect(c.querySelector('.updatehero__togo')).toBeNull()
    expect(c.textContent).not.toContain('Stage complete')
    expect(c.querySelector('.updatehero__made b')!.textContent).toBe('0')
  })
  it('writes every number the one way (1,25,000), and the share in words for a screen reader', () => {
    const c = hero({ done: 125000, qty: 400000, todaySoFar: 1000, left: 275000 })
    expect(c.querySelector('.updatehero__made b')!.textContent).toBe('1,25,000')
    expect(c.querySelector('.updatehero__togo')!.textContent).toBe('2,75,000 to go')
    expect(c.querySelector('.visually-hidden')!.textContent).toContain('31% done')
  })
  it('keeps the order number as the page heading', () => {
    expect(hero({ done: 1, qty: 2, todaySoFar: 0, left: 1 }).querySelector('h1')!.textContent).toBe('B-PO-88240')
  })
})

describe('StageCard: the same hierarchy on Today', () => {
  it('done is the big figure; the foot says what today added and what is to go', () => {
    const c = card({ done: 1750, qty: 4550, today: 350 })
    expect(c.querySelector('.stagetile__big')!.textContent).toBe('1,750')
    expect(c.querySelector('.stagetile__today--done')!.textContent).toBe('350 added today')
    expect(c.querySelector('.stagetile__today--done svg')).not.toBeNull()
    expect(c.querySelector('.stagetile__togo')!.textContent).toBe('2,800 to go')
    expect(c.textContent).toContain('38%')
  })
  it('nothing sent today: neutral words, no check, never a bare "Today 0"', () => {
    const c = card({ done: 0, qty: 3000, today: 0 })
    expect(c.querySelector('.stagetile__today')!.textContent).toBe('Nothing sent yet today')
    expect(c.querySelector('.stagetile__today--done')).toBeNull()
    expect(c.textContent).not.toContain('Today 0')
  })
  it('complete and over plan say "Stage complete" and keep the true number', () => {
    const c = card({ done: 5100, qty: 4550, today: 0 })
    expect(c.querySelector('.stagetile__big')!.textContent).toBe('5,100')
    expect(c.querySelector('.stagetile__togo')!.textContent).toBe('Stage complete')
  })
  it('no plan: no share, no "to go"', () => {
    const c = card({ done: 0, qty: 0, today: 0 })
    expect(c.querySelector('.stagetile__togo')).toBeNull()
    expect(c.querySelector('.stagetile__pct')).toBeNull()
  })
  it('keeps the hooks the other scripts use', () => {
    const c = card({ done: 1, qty: 2, today: 0 })
    expect(c.querySelector('li.stage')).not.toBeNull()
    expect((c.querySelector('a.stage__go') as HTMLAnchorElement).getAttribute('href')).toBe('/u')
  })
})

const rem = (css: string, selector: string): number => {
  const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
  return Number(/font-size:\s*([\d.]+)rem/.exec(rule)?.[1] ?? NaN)
}

describe('the hierarchy is in the CSS', () => {
  it('on the Update screen what is done is the largest type, above the order number, above today\'s line', () => {
    const made = rem(heroCss, '.updatehero__made b')
    const heading = rem(heroCss, '.updatehero .updatehero__who h1')
    const today = rem(heroCss, '.updatehero__today')
    expect(made).toBeGreaterThan(heading)
    expect(heading).toBeGreaterThan(today)
    expect(rem(heroCss, '.updatehero__togo')).toBeLessThanOrEqual(today)
  })
  it('on Today\'s card the done figure is the largest type', () => {
    expect(rem(cardCss, '.stagetile__big')).toBeGreaterThan(rem(cardCss, '.stagetile__po'))
  })
  it('a contribution is in the action colour with a check, never a status colour or a fill', () => {
    expect(heroCss).toMatch(/\.updatehero__today--added\s*\{[^}]*color:\s*var\(--accent\)/)
    expect(cardCss).toMatch(/\.stagetile__today--done\s*\{[^}]*color:\s*var\(--accent\)/)
    for (const css of [heroCss, cardCss]) {
      expect(css).not.toMatch(/--status-|tint|gradient|border-(left|right|inline-start)\s*:/)
      expect(css).not.toMatch(/background:\s*var\(--(accent|ink)\)/)
    }
  })
  it('no animation of its own (the ring\'s one-time fill is the only motion)', () => {
    expect(heroCss).not.toMatch(/@keyframes|animation:/)
    expect(cardCss).not.toMatch(/@keyframes|animation:/)
  })
})

describe('the words', () => {
  const NEW: Key[] = ['update.addedToday', 'update.nothingToday', 'update.toGo', 'update.stageComplete', 'update.shareDone']
  it('every new English key has a Tamil one', () => {
    for (const k of NEW) { expect(strings.en[k], k).toBeTruthy(); expect(strings.ta[k], k).toBeTruthy() }
  })
  it('Tamil shows no English letters and keeps the same placeholders', () => {
    for (const k of NEW) {
      expect(strings.ta[k]!.replace(/\{[a-z]+\}/g, ''), k).not.toMatch(/[A-Za-z]/)
      expect([...(strings.ta[k]!.match(/\{[a-z]+\}/g) ?? [])].sort(), k).toEqual([...(strings.en[k].match(/\{[a-z]+\}/g) ?? [])].sort())
    }
  })
  it('the English is plain: no exclamation mark, no emoji', () => {
    for (const k of NEW) { expect(strings.en[k], k).not.toMatch(/!/); expect(strings.en[k], k).not.toMatch(/\p{Extended_Pictographic}/u) }
  })
  it('the Tamil is marked as a draft in the source and listed for review', () => {
    const src = read('../src/i18n.ts')
    for (const k of NEW) expect(src, k).toMatch(new RegExp(`'${k.replace('.', '\\.')}':[^\\n]*// DRAFT, unreviewed`))
    const review = read('../../../audit/TAMIL-REVIEW.md')
    for (const k of NEW) expect(review, k).toContain('`' + k + '`')
  })
})

describe('the pages pass the words in', () => {
  it('Update gives the hero its labels from the language files; Today gives each card the same', () => {
    const update = read('../src/pages/Update.tsx')
    const today = read('../src/pages/Today.tsx')
    for (const k of ['update.addedToday', 'update.nothingToday', 'update.toGo', 'update.stageComplete', 'update.shareDone']) {
      expect(update, k).toContain(`'${k}'`)
      if (k !== 'update.shareDone') expect(today, k).toContain(`'${k}'`)
    }
  })
})
