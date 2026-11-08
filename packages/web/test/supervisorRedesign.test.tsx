// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { ProgressRing } from '../src/ui/atoms/ProgressRing'
import { PieceBar } from '../src/ui/atoms/PieceBar'
import { StageCard } from '../src/ui/organisms/StageCard'
import { TodayHero } from '../src/ui/organisms/TodayHero'
import { UpdateHero } from '../src/ui/organisms/UpdateHero'

// UI/UX plan, phase 8A: Today and Update as a bolder, simpler phone flow.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const today = read('../src/pages/Today.tsx')
const update = read('../src/pages/Update.tsx')
const css = (p: string) => strip(read(p))

describe('ProgressRing', () => {
  it('draws the fraction as an arc and puts its content in the middle', () => {
    const { container } = render(<ProgressRing fraction={0.25} size={100}>1</ProgressRing>)
    const fill = container.querySelector('.ring__fill') as SVGCircleElement
    const c = Number(fill.getAttribute('stroke-dasharray'))
    expect(c).toBeGreaterThan(0)
    expect(Number(fill.getAttribute('stroke-dashoffset'))).toBeCloseTo(c * 0.75, 3)
    expect(container.querySelector('.ring__center')?.textContent).toBe('1')
  })
  it('is empty at 0, full at 1, and clamps a wrong number', () => {
    const off = (f: number) => Number(render(<ProgressRing fraction={f} />).container.querySelector('.ring__fill')!.getAttribute('stroke-dashoffset'))
    const c = Number(render(<ProgressRing fraction={0} />).container.querySelector('.ring__fill')!.getAttribute('stroke-dasharray'))
    expect(off(0)).toBeCloseTo(c, 3)
    expect(off(1)).toBeCloseTo(0, 3)
    expect(off(7)).toBeCloseTo(0, 3)
    expect(off(Number.NaN)).toBeCloseTo(c, 3)
  })
  it('is hidden from a screen reader: the words beside it say the same thing', () => {
    expect(render(<ProgressRing fraction={0.5} />).container.querySelector('.ring')?.getAttribute('aria-hidden')).toBe('true')
  })
  it('never uses a status colour and stands still under reduced motion', () => {
    const c = css('../src/ui/atoms/ProgressRing.css')
    expect(c).not.toMatch(/status|--(red|amber|green)/)
    expect(c).toMatch(/prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.ring__fill\s*\{\s*transition:\s*none/)
  })
})

describe('PieceBar', () => {
  it('is as wide as the pieces done, capped at full', () => {
    const w = (done: number, qty: number) => (render(<PieceBar done={done} qty={qty} />).container.querySelector('.piecebar > span') as HTMLElement).style.width
    expect(w(1750, 3500)).toBe('50%')
    expect(w(9000, 3500)).toBe('100%')
    expect(w(0, 0)).toBe('0%')
  })
  it('is neutral (ink on grey), never a status colour', () => {
    expect(css('../src/ui/atoms/PieceBar.css')).not.toMatch(/status|--(red|amber|green)/)
  })
})

const labels = { today: 'Today', done: 'Done', due: 'Due', update: 'Update' }
describe('StageCard', () => {
  const card = () => render(
    <MemoryRouter>
      <StageCard po="B-PO-88240" meta="tee · navy" stageName="Sewing" done={1750} qty={4550} today={120} dueText="11 Nov" href="/update/x/sewing" labels={labels} />
    </MemoryRouter>).container
  it('keeps the hooks the other scripts use: .stage, a.stage__go and a full-width primary button', () => {
    const c = card()
    expect(c.querySelector('li.stage')).not.toBeNull()
    const go = c.querySelector('a.stage__go') as HTMLAnchorElement
    expect(go.getAttribute('href')).toBe('/update/x/sewing')
    expect(go.className).toContain('btn--primary')
    expect(go.className).toContain('btn--block')
    expect(go.textContent).toBe('Update')
  })
  it('shows the real numbers, grouped, with the share beside them', () => {
    const t = card().textContent!
    expect(t).toContain('B-PO-88240')
    expect(t).toContain('Sewing')
    expect(t).toContain('1,750')
    expect(t).toContain('4,550')
    expect(t).toContain('38%')
    expect(t).toContain('11 Nov')
  })
  it('marks a stage that has an update today with a tick, and one without as 0', () => {
    expect(card().querySelector('.stagetile__today--done')).not.toBeNull()
    const none = render(<MemoryRouter><StageCard po="P" meta="m" stageName="Sewing" done={0} qty={10} today={0} dueText="1 Nov" href="/u" labels={labels} /></MemoryRouter>).container
    expect(none.querySelector('.stagetile__today--done')).toBeNull()
    expect(none.textContent).toContain('Today')
  })
})

describe('TodayHero', () => {
  it('shows the ring, the sentence and the date line, and holds the sync chip', () => {
    const { container } = render(<TodayHero updated={1} total={3} headline="1 of 3 updated today" dateLine="Counts go to 4 Nov"><span className="sync">All sent</span></TodayHero>)
    expect(container.querySelector('.ring__center')?.textContent).toContain('1')
    expect(container.querySelector('.ring__center')?.textContent).toContain('3')
    expect(container.textContent).toContain('1 of 3 updated today')
    expect(container.textContent).toContain('Counts go to 4 Nov')
    expect(container.querySelector('.sync')).not.toBeNull()
  })
})

describe('UpdateHero', () => {
  it('names the order and the stage, and shows today so far and what is left in big plain numbers', () => {
    const { container } = render(<UpdateHero po="B-PO-88240" meta="tee · navy · due 11 Nov" done={1750} qty={4550} todaySoFar={0} left={2800} labels={{ todaySoFar: 'Today so far', left: 'Left' }} />)
    expect(container.querySelector('h1')?.textContent).toBe('B-PO-88240')
    expect(container.textContent).toContain('Today so far')
    expect(container.textContent).toContain('2,800')
    expect(container.textContent).toContain('38%')
  })
})

describe('the two pages use them', () => {
  it('Today: a hero, then one card per stage; the empty, error, refused and skeleton states stay', () => {
    expect(today).toContain('<TodayHero')
    expect(today).toContain('<StageCard')
    expect(today).toContain("t('today.nothing')")
    expect(today).toContain('st.stages === null && st.error')
    expect(today).toContain('<Skeleton')
    expect(today).toContain("t('sync.notAccepted')")
  })
  it('Today: the sync chip sits in the hero when there is a day to show, and still shows when there is none', () => {
    expect(today).toMatch(/<TodayHero[\s\S]*?<SyncChip/)
  })
  it('Update: the way back and the sync chip share one row (a second row pushed the number field behind the bar with the keyboard up)', () => {
    expect(update).toMatch(/<div className="update__bar">\s*<TextLink className="back back--arrow"[\s\S]*?<\/TextLink>\s*\{queue && state && <SyncChip/)
    expect(read('../src/styles.css')).toMatch(/\.update__bar\s*\{[^}]*flex-wrap:\s*wrap/)
  })
  it('Update: the bottom bar stays inside the card (it takes its padding and edges from the card\'s --card-pad; outside a card it lost both and Send touched the screen edge)', () => {
    expect(update).toMatch(/<Card as="div" className="update__body">[\s\S]*<ActionBar>[\s\S]*<\/ActionBar>\s*<\/Card>\s*<\/form>/)
  })
  it('Update: opens with the hero; the bar at the bottom, the focus effects and the one-at-a-time save are untouched', () => {
    expect(update).toContain('<UpdateHero')
    expect(update).toContain('<ActionBar>')
    expect(update).toContain('useEffect(() => { if (hasStage) input.current?.focus() }, [hasStage])')
    expect(update).toContain('oneAtATime(saving')
    expect(update).toContain("aria-describedby={confirming ? 'hint toomany' : 'hint'}")
  })
})

describe('the look', () => {
  it('the typed number is bigger and bolder, and still at least 56 px high', () => {
    const c = css('../src/styles.css')
    const rule = /\.input--big\s*\{[^}]*\}/.exec(c)?.[0] ?? ''
    expect(rule).toMatch(/min-height:\s*var\(--tap-primary\)/)
    expect(Number(/font-size:\s*(\d+)px/.exec(rule)?.[1])).toBeGreaterThanOrEqual(36)
  })
  // The user's rule: tinted or coloured cards "feel so much of AI generation". Surfaces are neutral (white, the page colour or the ink
  // of the hero), borders are the neutral border tokens, and a status colour lives ONLY on the small icon and the word (StatusBadge).
  // No card, tile, row or header takes a status background, a coloured border or a stripe down one edge.
  describe('neutral surfaces: a stage card is never tinted by status', () => {
    // The theme's own colours are allowed (a soft violet wash, the action colour for a progress fill or a pill); a STATUS colour or tint never is (checked just above).
    const NEUTRAL_BG = /^(var\(--(surface|page|ink|accent|accent-soft|border-soft)\)|transparent|none)$/
    const sheets = ['organisms/StageCard', 'organisms/TodayHero', 'organisms/UpdateHero', 'atoms/ProgressRing', 'atoms/PieceBar', 'atoms/Skeleton']
    const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }))
    // the stage rules in the shared stylesheet that Today's card still leans on
    const stageRules = rules(css('../src/styles.css')).filter((r) => /^\.stage(s|__go|--skeleton)?\b/.test(r.selector) && !r.selector.startsWith('.stagecard') && !r.selector.startsWith('.stagelist'))
    const all = [...sheets.flatMap((f) => rules(css(`../src/ui/${f}.css`)).map((r) => ({ ...r, file: f }))), ...stageRules.map((r) => ({ ...r, file: 'styles.css' }))]

    it('has the rules to look at', () => expect(all.length).toBeGreaterThan(15))
    it('no status colour or tint anywhere in them', () => {
      for (const r of all) expect(r.body, `${r.file} ${r.selector}`).not.toMatch(/status|tint/)
    })
    it('every background is a neutral (white, the page colour, ink, or the grey of an empty bar)', () => {
      for (const r of all) for (const m of r.body.matchAll(/background(?:-color)?:\s*([^;]+);?/g)) expect(m[1]!.trim(), `${r.file} ${r.selector}`).toMatch(NEUTRAL_BG)
    })
    it('no coloured border and no stripe down one edge', () => {
      for (const r of all) {
        expect(r.body, `${r.file} ${r.selector}`).not.toMatch(/border-(left|right|inline-start|inline-end)\s*:/)
        for (const m of r.body.matchAll(/border(?:-color)?:[^;]*?(var\(--[a-z-]+\))/g)) expect(m[1], `${r.file} ${r.selector}`).toMatch(/--(border|border-soft|ink|muted)\)/)
      }
    })
    it("the card's markup carries no status class either", () => {
      const tsx = read('../src/ui/organisms/StageCard.tsx')
      expect(tsx).not.toMatch(/status|stage--(red|amber|green|grey)/i)
      expect(today).not.toMatch(/stage--(red|amber|green|grey)|\.status/)
    })
  })
  it('every new stylesheet uses tokens and no status colour', () => {
    for (const f of ['organisms/StageCard', 'organisms/TodayHero', 'organisms/UpdateHero']) {
      const c = css(`../src/ui/${f}.css`)
      expect(c, f).not.toMatch(/--status-|#[0-9a-fA-F]{3,8}\b/)
    }
  })
})
